import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AppError } from '../../utils/errors.js';
import type { ISefazBlobStore } from './blob-store.types.js';

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body || typeof (body as NodeJS.ReadableStream).pipe !== 'function') {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function assertSafeLogicalKey(key: string): void {
  if (!key.startsWith('sefaz/') || key.includes('..')) {
    throw new AppError('Chave de blob inválida', {
      statusCode: 500,
      code: 'INVALID_BLOB_KEY',
      expose: false,
      category: 'internal',
    });
  }
}

export class SpacesSefazBlobStore implements ISefazBlobStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(bucket: string, prefix: string) {
    this.bucket = bucket;
    this.prefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const region = process.env.SPACES_REGION;
    const endpoint = process.env.SPACES_ENDPOINT;
    const key = process.env.SPACES_KEY;
    const secret = process.env.SPACES_SECRET;
    if (!region || !endpoint || !key || !secret) {
      throw new AppError('Variáveis SPACES_* incompletas', {
        statusCode: 500,
        code: 'MISSING_SPACES_CONFIG',
        expose: false,
        category: 'internal',
      });
    }
    const forcePathStyle = process.env.SPACES_FORCE_PATH_STYLE !== 'false';
    this.client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId: key, secretAccessKey: secret },
      forcePathStyle,
    });
  }

  private objectKey(logicalKey: string): string {
    assertSafeLogicalKey(logicalKey);
    return `${this.prefix}${logicalKey}`;
  }

  async putUtf8(key: string, content: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: content,
        ContentType: 'application/json; charset=utf-8',
        ServerSideEncryption: 'AES256',
      })
    );
  }

  async getUtf8(key: string): Promise<string | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
      );
      return (await bodyToBuffer(res.Body)).toString('utf8');
    } catch {
      return null;
    }
  }

  async putBuffer(key: string, body: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: body,
        ContentType: contentType ?? 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      })
    );
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
      );
      return await bodyToBuffer(res.Body);
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
      );
      return true;
    } catch {
      return false;
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    assertSafeLogicalKey(prefix);
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const p = this.objectKey(normalizedPrefix);
    const out: string[] = [];
    let token: string | undefined;
    const strip = this.prefix;
    while (true) {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: p, ContinuationToken: token })
      );
      for (const o of listed.Contents ?? []) {
        if (!o.Key) continue;
        if (!o.Key.startsWith(strip)) continue;
        out.push(o.Key.slice(strip.length));
      }
      if (!listed.IsTruncated) break;
      token = listed.NextContinuationToken;
      if (!token) break;
    }
    out.sort();
    return out;
  }
}
