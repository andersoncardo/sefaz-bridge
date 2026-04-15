import { AppError } from '../utils/errors.js';
import { getCertEncryptionKey, resetCertEncryptionKeyCache } from '../utils/crypto-envelope.js';

export function validateBootstrap(): void {
  resetCertEncryptionKeyCache();

  const appEnv = (process.env.APP_ENV ?? 'development').toLowerCase();
  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  const requiresRemoteStorage = appEnv === 'production' || appEnv === 'staging';

  if (requiresRemoteStorage) {
    const s = process.env.SEFAZ_BRIDGE_SECRET;
    if (!s || s === 'change-me') {
      throw new AppError('SEFAZ_BRIDGE_SECRET inválido neste ambiente', {
        statusCode: 500,
        code: 'MISSING_BRIDGE_SECRET',
        category: 'internal',
      });
    }
    if (driver !== 'spaces') {
      throw new AppError('Use STORAGE_DRIVER=spaces (App Platform sem volume persistente)', {
        statusCode: 500,
        code: 'STORAGE_DRIVER_REQUIRED',
        category: 'internal',
      });
    }
    const requiredSpaces = ['SPACES_BUCKET', 'SPACES_REGION', 'SPACES_ENDPOINT', 'SPACES_KEY', 'SPACES_SECRET'] as const;
    for (const k of requiredSpaces) {
      if (!process.env[k]?.trim()) {
        throw new AppError(`Variável obrigatória ausente: ${k}`, {
          statusCode: 500,
          code: 'MISSING_SPACES_ENV',
          category: 'internal',
        });
      }
    }
  }

  try {
    getCertEncryptionKey();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('CERT_ENCRYPTION_KEY inválida', {
      statusCode: 500,
      code: 'BAD_CERT_ENCRYPTION_KEY',
      category: 'internal',
      cause: e,
    });
  }
}
