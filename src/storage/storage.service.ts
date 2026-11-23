import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Cloudflare R2 through its S3-compatible API. */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket = process.env.CLOUDFLARE_BUCKET_NAME;
  private readonly publicUrl = (
    process.env.CLOUDFLARE_PUBLIC_URL ?? ''
  ).replace(/\/$/, '');

  constructor() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = process.env.CLOUDFLARE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;

    if (
      !accountId ||
      !accessKeyId ||
      !secretAccessKey ||
      !this.bucket ||
      !this.publicUrl
    ) {
      this.logger.warn(
        'Cloudflare R2 is not fully configured — uploads are disabled.',
      );
      this.client = null;
      return;
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async uploadImage(file: UploadedImage | undefined, folder: string) {
    if (!file) throw new BadRequestException('No file was uploaded');

    const ext = ALLOWED[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        'Only JPG, PNG, WebP, AVIF, GIF, SVG or ICO images are allowed',
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('Images must be 8MB or smaller');
    }
    if (!this.client) {
      throw new ServiceUnavailableException('Image storage is not configured');
    }

    const safeFolder = folder.replace(/[^a-z0-9-]/gi, '') || 'uploads';
    const key = `${safeFolder}/${randomUUID()}.${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        // Keys are unique per upload, so the object never changes.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return { url: `${this.publicUrl}/${key}`, key };
  }
}
