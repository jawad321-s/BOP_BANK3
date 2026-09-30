import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL not set by global-setup');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.MAIL_TRANSPORT = 'memory';
process.env.PUSH_PROVIDER = 'log';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = mkdtempSync(join(tmpdir(), 'bitaqati-test-'));
delete process.env.REDIS_URL;
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.DEFAULT_TIMEZONE = 'Asia/Hebron';
