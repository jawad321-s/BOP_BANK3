import pino from 'pino';

/**
 * Structured JSON logger. Sensitive fields are redacted so tokens, passwords, QR payloads
 * and authorization headers never reach log storage.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'bitaqati-api', env: process.env.APP_ENV ?? 'development' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.refreshToken',
      '*.accessToken',
      '*.token',
      '*.qrPayload',
      '*.challengeToken',
      '*.code',
      '*.secret',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
