import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, NestMiddleware } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { errorMessage, type ApiErrorBody, type ErrorCode } from '@bitaqati/shared';
import { AppError } from './errors';
import { logger } from './logger';
import { requestLocale, type AppRequest } from './request-context';
import { isUniqueViolation } from './prisma.service';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: AppRequest, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    req.requestId = typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    req.locale = requestLocale(req);
    res.setHeader('X-Request-Id', req.requestId);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      // Only method + route path are logged: never query strings (may contain search terms) or bodies.
      logger.info(
        { requestId: req.requestId, method: req.method, path: req.route?.path ?? req.path.split('?')[0], status: res.statusCode, ms: Math.round(ms), userId: req.auth?.userId },
        'request',
      );
    });
    next();
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<AppRequest>();
    const res = ctx.getResponse<Response>();
    const locale = req.locale ?? 'ar';
    let code: ErrorCode = 'INTERNAL_ERROR';
    let status = 500;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppError) {
      code = exception.code;
      status = exception.status;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 404 ? 'NOT_FOUND' : status === 413 ? 'UPLOAD_INVALID' : status === 429 ? 'RATE_LIMITED' : status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR';
    } else if (isUniqueViolation(exception)) {
      code = 'CONFLICT';
      status = 409;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && ['P2024', 'P2028', 'P2034'].includes(exception.code)) {
      // Pool exhaustion / transaction timeout / write conflict: safe for the client to retry with the same Idempotency-Key.
      code = 'SERVICE_UNAVAILABLE';
      status = 503;
      logger.warn({ requestId: req.requestId, prismaCode: exception.code }, 'retryable database contention');
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      code = 'NOT_FOUND';
      status = 404;
    } else if (exception instanceof SyntaxError && (exception as { type?: string }).type === 'entity.parse.failed') {
      code = 'VALIDATION_FAILED';
      status = 400;
    }
    if (status >= 500) {
      logger.error({ requestId: req.requestId, err: exception instanceof Error ? { name: exception.name, message: exception.message, stack: exception.stack } : String(exception) }, 'unhandled error');
    }
    if (code === 'RATE_LIMITED' && details?.retryAfterSeconds) res.setHeader('Retry-After', String(details.retryAfterSeconds));
    const body: ApiErrorBody = { error: { code, message: errorMessage(code, locale), requestId: req.requestId, ...(details ? { details } : {}) } };
    res.status(status).json(body);
  }
}
