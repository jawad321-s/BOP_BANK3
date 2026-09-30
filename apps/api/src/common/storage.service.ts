import { Injectable } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config';

/**
 * Private object storage. Profile photos are never public: they are streamed through the API after an
 * authorization check. S3-compatible storage is required in production; `local` is for development only.
 */
@Injectable()
export class StorageService {
  private s3: S3Client | null = null;

  private client(): S3Client {
    if (!this.s3) {
      const c = config();
      this.s3 = new S3Client({
        region: c.S3_REGION,
        endpoint: c.S3_ENDPOINT || undefined,
        forcePathStyle: c.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: c.S3_ACCESS_KEY_ID!, secretAccessKey: c.S3_SECRET_ACCESS_KEY! },
      });
    }
    return this.s3;
  }

  private localPath(key: string): string {
    if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes('..')) throw new Error('invalid storage key');
    return join(resolve(config().STORAGE_LOCAL_DIR), key);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const c = config();
    if (c.STORAGE_DRIVER === 's3') {
      await this.client().send(new PutObjectCommand({ Bucket: c.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: c.S3_ENDPOINT ? undefined : 'AES256' }));
      return;
    }
    const p = this.localPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(key: string): Promise<Buffer | null> {
    const c = config();
    try {
      if (c.STORAGE_DRIVER === 's3') {
        const out = await this.client().send(new GetObjectCommand({ Bucket: c.S3_BUCKET, Key: key }));
        return Buffer.from(await out.Body!.transformToByteArray());
      }
      return await readFile(this.localPath(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const c = config();
    if (c.STORAGE_DRIVER === 's3') {
      await this.client().send(new DeleteObjectCommand({ Bucket: c.S3_BUCKET, Key: key }));
      return;
    }
    await rm(this.localPath(key), { force: true });
  }
}
