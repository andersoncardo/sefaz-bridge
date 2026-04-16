import { join } from 'node:path';
import { AppError } from '../../utils/errors.js';
import type { ISefazBlobStore } from './blob-store.types.js';
import { LocalSefazBlobStore } from './local.sefaz-blob.js';
import { SpacesSefazBlobStore } from './spaces.sefaz-blob.js';

function normalizePrefix(p: string): string {
  const t = p.trim();
  if (!t) return '';
  return t.endsWith('/') ? t : `${t}/`;
}

export function createSefazBlobStore(): ISefazBlobStore {
  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  const appEnv = (process.env.APP_ENV ?? 'development').toLowerCase();
  const requiresRemoteStorage = appEnv === 'production' || appEnv === 'staging';

  if (requiresRemoteStorage && driver === 'local') {
    throw new AppError('STORAGE_DRIVER=local não é permitido neste ambiente', {
      statusCode: 500,
      code: 'INVALID_STORAGE_IN_PRODUCTION',
      expose: false,
      category: 'internal',
    });
  }

  if (driver === 'spaces') {
    const bucket = process.env.SPACES_BUCKET?.trim();
    if (!bucket) {
      throw new AppError('SPACES_BUCKET obrigatório para STORAGE_DRIVER=spaces', {
        statusCode: 500,
        code: 'MISSING_SPACES_BUCKET',
        expose: false,
        category: 'internal',
      });
    }
    const prefix = normalizePrefix(process.env.SPACES_PREFIX ?? 'sefaz-bridge/production/');
    return new SpacesSefazBlobStore(bucket, prefix);
  }

  if (driver === 'local') {
    const baseDir = process.env.SEFAZ_BLOB_LOCAL_PATH ?? join(process.cwd(), 'storage', 'sefaz-blobs');
    return new LocalSefazBlobStore(baseDir);
  }

  throw new AppError(`STORAGE_DRIVER inválido: ${driver}`, {
    statusCode: 500,
    code: 'BAD_STORAGE_DRIVER',
    expose: false,
    category: 'internal',
  });
}

let singleton: ISefazBlobStore | null = null;

export function getSefazBlobStore(): ISefazBlobStore {
  singleton ??= createSefazBlobStore();
  return singleton;
}

export function resetSefazBlobStore(): void {
  singleton = null;
}
