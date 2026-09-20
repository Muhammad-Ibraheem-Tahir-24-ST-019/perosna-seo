import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
// Type-only import: erased at runtime, so the SDK is still loaded lazily below.
import type { S3Client } from '@aws-sdk/client-s3';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import {
  healthy,
  unhealthy,
  type HealthResult,
  type StorageProvider,
  type StoredObject,
} from '../types.js';

/** Filesystem storage for local development. Keys are sandboxed to `baseDir`. */
export class LocalStorageProvider implements StorageProvider {
  readonly key = 'local';
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  private resolveKey(key: string): string {
    const target = resolve(join(this.baseDir, normalize(key)));
    if (target !== this.baseDir && !target.startsWith(this.baseDir + sep)) {
      throw new Error('Storage key escapes the storage directory.');
    }
    return target;
  }

  async put(key: string, body: Buffer | string, _contentType: string): Promise<StoredObject> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    await writeFile(target, buffer);
    return { key, size: buffer.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  /** Local files are streamed by the API, so there is no direct browser URL. */
  async getDownloadUrl(): Promise<string | null> {
    return null;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      await mkdir(this.baseDir, { recursive: true });
      return healthy(`Local storage at ${this.baseDir}`);
    } catch (error) {
      return unhealthy(`Local storage unavailable: ${(error as Error).message}`);
    }
  }
}

export interface S3Settings {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * S3-compatible storage (AWS S3, MinIO, R2...).
 *
 * The AWS SDK is imported lazily so a deployment using local storage does not
 * pay for loading it.
 */
export class S3StorageProvider implements StorageProvider {
  readonly key = 's3';
  private readonly settings: S3Settings;
  private client: unknown;

  constructor(settings: S3Settings) {
    this.settings = settings;
  }

  private async getClient() {
    if (!this.client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.client = new S3Client({
        region: this.settings.region,
        ...(this.settings.endpoint ? { endpoint: this.settings.endpoint } : {}),
        forcePathStyle: this.settings.forcePathStyle,
        credentials: {
          accessKeyId: this.settings.accessKeyId,
          secretAccessKey: this.settings.secretAccessKey,
        },
      });
    }
    return this.client as S3Client;
  }

  async put(key: string, body: Buffer | string, contentType: string): Promise<StoredObject> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    await client.send(
      new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return { key, size: buffer.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    const response = await client.send(
      new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async getDownloadUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);
    const client = await this.getClient();
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const client = await this.getClient();
      await client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
      return healthy(`Bucket ${this.settings.bucket} reachable.`);
    } catch (error) {
      return unhealthy(`S3 storage unavailable: ${(error as Error).message}`);
    }
  }
}
