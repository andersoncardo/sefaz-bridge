import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { CompanyCertificateMeta, CompanyId } from '../../types/index.js';
import { decryptEnvelope, encryptEnvelope } from '../../utils/crypto-envelope.js';
import { AppError } from '../../utils/errors.js';
import type { CertificateStoragePayload, IStorageService, StorageHealthResult } from './types.js';

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

export class SpacesStorageService implements IStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    bucket: string,
    private readonly prefix: string
  ) {
    this.bucket = bucket;
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
    // DigitalOcean Spaces costuma exigir path-style (https://REGION.digitaloceanspaces.com/BUCKET/...)
    const forcePathStyle = process.env.SPACES_FORCE_PATH_STYLE !== 'false';

    this.client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId: key, secretAccessKey: secret },
      forcePathStyle,
    });
  }

  private materialKey(companyId: CompanyId): string {
    return `${this.prefix}companies/${companyId}/material.blob`;
  }

  private metaKey(companyId: CompanyId): string {
    return `${this.prefix}companies/${companyId}/meta.json`;
  }

  private listPrefix(companyId: CompanyId): string {
    return `${this.prefix}companies/${companyId}/`;
  }

  private aadPfx(companyId: CompanyId): string {
    return `sefaz-bridge:spaces:${this.bucket}:${companyId}:pfx`;
  }

  private aadPass(companyId: CompanyId): string {
    return `sefaz-bridge:spaces:${this.bucket}:${companyId}:pass`;
  }

  async saveCompanyCertificate(companyId: CompanyId, payload: CertificateStoragePayload): Promise<void> {
    await this.deleteCompanyCertificate(companyId);

    const pfxEnc = encryptEnvelope(payload.pfxBuffer, this.aadPfx(companyId));
    const passEnc = encryptEnvelope(Buffer.from(payload.passphrase, 'utf8'), this.aadPass(companyId));
    const material = Buffer.concat([passEnc, Buffer.from([0x0a]), pfxEnc]);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.materialKey(companyId),
        Body: material,
        ContentType: 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      })
    );

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.metaKey(companyId),
        Body: JSON.stringify(payload.meta),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      })
    );
  }

  private async readMaterial(companyId: CompanyId): Promise<{ passEnc: Buffer; pfxEnc: Buffer }> {
    let raw: Buffer;
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.materialKey(companyId) })
      );
      raw = await bodyToBuffer(res.Body);
    } catch {
      throw new AppError('Certificado não encontrado', {
        statusCode: 404,
        code: 'CERT_NOT_FOUND',
        expose: true,
        category: 'storage',
      });
    }
    const sep = raw.indexOf(0x0a);
    if (sep < 0) {
      throw new AppError('Material de certificado corrompido no storage', {
        statusCode: 500,
        code: 'STORAGE_CORRUPT',
        expose: false,
        category: 'storage',
      });
    }
    return { passEnc: raw.subarray(0, sep), pfxEnc: raw.subarray(sep + 1) };
  }

  async readCompanyPfx(companyId: CompanyId): Promise<Buffer> {
    const m = await this.readMaterial(companyId);
    return decryptEnvelope(m.pfxEnc, this.aadPfx(companyId));
  }

  async readCompanyPassphrase(companyId: CompanyId): Promise<string> {
    const m = await this.readMaterial(companyId);
    const buf = decryptEnvelope(m.passEnc, this.aadPass(companyId));
    return buf.toString('utf8');
  }

  async readCompanyMeta(companyId: CompanyId): Promise<CompanyCertificateMeta | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.metaKey(companyId) })
      );
      const raw = (await bodyToBuffer(res.Body)).toString('utf8');
      return JSON.parse(raw) as CompanyCertificateMeta;
    } catch {
      return null;
    }
  }

  async deleteCompanyCertificate(companyId: CompanyId): Promise<void> {
    const prefix = this.listPrefix(companyId);
    let token: string | undefined;
    const keys: { Key: string }[] = [];
    while (true) {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token })
      );
      for (const o of listed.Contents ?? []) {
        if (o.Key) keys.push({ Key: o.Key });
      }
      if (!listed.IsTruncated) break;
      token = listed.NextContinuationToken;
      if (!token) break;
    }

    if (!keys.length) return;

    const chunkSize = 1000;
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk, Quiet: true },
        })
      );
    }
  }

  async healthCheck(): Promise<StorageHealthResult> {
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1, Prefix: this.prefix })
      );
      return { ok: true, driver: 'spaces' };
    } catch (e) {
      const err = e as Error & { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
      const hint = [err.name, err.Code, err.message].filter(Boolean).join(' — ');
      return {
        ok: false,
        driver: 'spaces',
        message: hint || 'ListObjects no bucket falhou (credenciais, região ou nome do bucket?)',
      };
    }
  }
}
