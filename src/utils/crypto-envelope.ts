import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 1 + IV_LEN + TAG_LEN;

/** Remove BOM, quebras de linha e espaços (comum ao colar secret na DigitalOcean). */
function normalizeKeyString(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, '')
    .trim();
}

function tryDecodeBase64Padded(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4;
  return Buffer.from(s + '='.repeat(pad), 'base64');
}

/** Base64 “url-safe” (- _) → padrão (+ /) + padding. */
function tryDecodeBase64Url(s: string): Buffer {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  return tryDecodeBase64Padded(std);
}

function parseMasterKey(raw: string | undefined): Buffer {
  if (!raw?.trim()) {
    throw new AppError('CERT_ENCRYPTION_KEY não configurada', {
      statusCode: 500,
      code: 'MISSING_CERT_ENCRYPTION_KEY',
      expose: false,
      category: 'internal',
    });
  }

  let t = normalizeKeyString(raw);
  if (!t) {
    throw new AppError('CERT_ENCRYPTION_KEY vazia (apenas espaços?)', {
      statusCode: 500,
      code: 'MISSING_CERT_ENCRYPTION_KEY',
      expose: false,
      category: 'internal',
    });
  }
  if (t.startsWith('0x') && /^0x[0-9a-fA-F]{64}$/.test(t)) {
    t = t.slice(2);
  }

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(t)) {
    key = Buffer.from(t, 'hex');
  } else {
    key = Buffer.from(t, 'base64');
    if (key.length !== 32) {
      key = tryDecodeBase64Padded(t);
    }
    if (key.length !== 32) {
      key = tryDecodeBase64Url(t);
    }
  }

  if (key.length !== 32) {
    throw new AppError(
      `CERT_ENCRYPTION_KEY inválida: decodificou para ${key.length} bytes; são necessários exatamente 32 bytes (AES-256). ` +
        `Gere localmente: openssl rand -base64 32  OU  openssl rand -hex 32. ` +
        `Na DigitalOcean (Environment Variables), cole o valor em UMA linha, tipo SECRET, sem aspas nem espaços extras.`,
      {
        statusCode: 500,
        code: 'INVALID_CERT_ENCRYPTION_KEY',
        expose: false,
        category: 'internal',
      }
    );
  }
  return key;
}

let cachedKey: Buffer | null = null;

export function getCertEncryptionKey(): Buffer {
  cachedKey ??= parseMasterKey(process.env.CERT_ENCRYPTION_KEY);
  return cachedKey;
}

/** Apenas para testes ou reload explícito */
export function resetCertEncryptionKeyCache(): void {
  cachedKey = null;
}

export function encryptEnvelope(plaintext: Buffer, aad: string): Buffer {
  const key = getCertEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
}

export function decryptEnvelope(blob: Buffer, aad: string): Buffer {
  const key = getCertEncryptionKey();
  if (blob.length < HEADER_LEN || blob[0] !== VERSION) {
    throw new AppError('Blob cifrado inválido', {
      statusCode: 500,
      code: 'INVALID_CIPHER_BLOB',
      expose: false,
      category: 'storage',
    });
  }
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(HEADER_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
