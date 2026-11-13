import { createHmac, timingSafeEqual } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PresignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the app must send with the upload, exactly as given. */
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * Private file storage: receipts, item photos, drop-off photos and chat photos. The apps upload
 * straight to the store with a short-lived signed link, and read through short-lived signed links;
 * the bucket itself is never public. S3 at launch; any S3-compatible store works.
 */
export interface StorageAdapter {
  readonly name: string;
  /** The size is signed into the link, so the store refuses any other size. */
  presignUpload(input: {
    key: string;
    contentType: string;
    size: number;
    ttlSeconds: number;
  }): Promise<PresignedUpload>;
  presignDownload(key: string, ttlSeconds: number): Promise<string>;
  /** Size and type of a stored file, or null if nothing was uploaded under the key. */
  head(key: string): Promise<{ size: number; contentType: string } | null>;
}

export const STORAGE = Symbol('STORAGE');

export class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3';
  private readonly s3: S3Client;

  /** Without credentials, the AWS SDK's usual chain is used (environment, instance role). */
  constructor(
    private readonly bucket: string,
    region: string,
    endpoint?: string,
    credentials?: { accessKeyId: string; secretAccessKey: string },
  ) {
    this.s3 = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(credentials ? { credentials } : {}),
    });
  }

  /** For the panel's Test button: the bucket exists and these keys can reach it. */
  async check() {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return `Connected to the bucket ${this.bucket}`;
  }

  async presignUpload(input: { key: string; contentType: string; size: number; ttlSeconds: number }) {
    const signed = new Set(['content-type', 'content-length']);
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.size,
      }),
      { expiresIn: input.ttlSeconds, signableHeaders: signed, unhoistableHeaders: signed },
    );
    return {
      url,
      method: 'PUT' as const,
      headers: { 'content-type': input.contentType, 'content-length': String(input.size) },
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    };
  }

  presignDownload(key: string, ttlSeconds: number) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }

  async head(key: string) {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || status === 403) return null;
      throw error;
    }
  }
}

/**
 * Development and tests: files kept in memory and served by the API itself under /v1/dev-files, with
 * signed, expiring links like S3's. Never for production.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly name = 'memory';
  readonly files = new Map<string, { bytes: Buffer; contentType: string }>();

  constructor(
    private readonly publicUrl: string,
    private readonly secret: string,
  ) {}

  private sign(method: string, key: string, exp: number, size: number) {
    return createHmac('sha256', this.secret).update(`${method}:${key}:${exp}:${size}`).digest('hex');
  }

  private link(method: 'GET' | 'PUT', key: string, ttlSeconds: number, size = 0) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(method, key, exp, size);
    return `${this.publicUrl}/v1/dev-files/${encodeURIComponent(key)}?m=${method}&exp=${exp}&size=${size}&sig=${sig}`;
  }

  /** Checks a link the dev-files route received. Uploads are signed for one exact size, as with S3. */
  verify(method: 'GET' | 'PUT', key: string, exp: number, size: number, sig: string) {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    const expected = Buffer.from(this.sign(method, key, exp, size));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async presignUpload(input: { key: string; contentType: string; size: number; ttlSeconds: number }) {
    return {
      url: this.link('PUT', input.key, input.ttlSeconds, input.size),
      method: 'PUT' as const,
      headers: { 'content-type': input.contentType, 'content-length': String(input.size) },
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    };
  }

  async presignDownload(key: string, ttlSeconds: number) {
    return this.link('GET', key, ttlSeconds);
  }

  async head(key: string) {
    const file = this.files.get(key);
    return file ? { size: file.bytes.length, contentType: file.contentType } : null;
  }
}
