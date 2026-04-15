import { join } from 'node:path';
import { AppError } from '../../utils/errors.js';
import { LocalStorageService } from './local.storage.js';
import { SpacesStorageService } from './spaces.storage.js';
import type { IStorageService } from './types.js';

function normalizePrefix(p: string): string {
  const t = p.trim();
  if (!t) return '';
  return t.endsWith('/') ? t : `${t}/`;
}

export function createStorageService(): IStorageService {
  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  const appEnv = (process.env.APP_ENV ?? 'development').toLowerCase();
  const requiresRemoteStorage = appEnv === 'production' || appEnv === 'staging';

  if (requiresRemoteStorage && driver === 'local') {
    throw new AppError('STORAGE_DRIVER=local não é permitido neste ambiente (App Platform sem volume)', {
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
    return new SpacesStorageService(bucket, prefix);
  }

  if (driver === 'local') {
    const baseDir = process.env.CERT_STORAGE_PATH ?? join(process.cwd(), 'storage', 'certificates');
    return new LocalStorageService(baseDir);
  }

  throw new AppError(`STORAGE_DRIVER inválido: ${driver}`, {
    statusCode: 500,
    code: 'BAD_STORAGE_DRIVER',
    expose: false,
    category: 'internal',
  });
}

let singleton: IStorageService | null = null;

export function getStorageService(): IStorageService {
  singleton ??= createStorageService();
  return singleton;
}

/** Testes ou reload */
export function resetStorageService(): void {
  singleton = null;
}
