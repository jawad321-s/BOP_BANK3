import sharp from 'sharp';
import { AppError } from './errors';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Validates an uploaded image by decoding it (not by trusting the extension or MIME header),
 * then re-encodes to JPEG. Re-encoding drops EXIF/GPS and any embedded payloads.
 */
export async function sanitizeImage(buf: Buffer | undefined, maxSide = 1024): Promise<Buffer> {
  if (!buf || buf.length === 0 || buf.length > MAX_UPLOAD_BYTES) throw new AppError('UPLOAD_INVALID');
  try {
    const img = sharp(buf, { failOn: 'error', limitInputPixels: 40_000_000 });
    const meta = await img.metadata();
    if (!meta.format || !['jpeg', 'png', 'webp', 'heif'].includes(meta.format)) throw new Error('format');
    if (!meta.width || !meta.height || meta.width < 200 || meta.height < 200) throw new Error('too small');
    return await img.rotate().resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  } catch {
    throw new AppError('UPLOAD_INVALID');
  }
}
