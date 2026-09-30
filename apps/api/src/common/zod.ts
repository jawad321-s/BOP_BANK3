import { applyDecorators, ArgumentMetadata, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import type { ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AppError } from './errors';

export class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown, _meta: ArgumentMetadata): z.infer<T> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new AppError('VALIDATION_FAILED', {
        fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}

function jsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const s = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/** Validated + documented request body. */
export const ZBody = (schema: ZodTypeAny) => Body(new ZodPipe(schema));
export const ZQuery = (schema: ZodTypeAny) => Query(new ZodPipe(schema));

/** Method decorator documenting the body schema in OpenAPI. */
export const DocBody = (schema: ZodTypeAny) => applyDecorators(ApiBody({ schema: jsonSchema(schema) as never }));

export const DocQuery = (schema: ZodTypeAny) => {
  const js = jsonSchema(schema) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  const decorators = Object.entries(js.properties ?? {}).map(([name, prop]) =>
    ApiQuery({ name, required: (js.required ?? []).includes(name) && prop.default === undefined, schema: prop as never }),
  );
  return applyDecorators(...decorators);
};
