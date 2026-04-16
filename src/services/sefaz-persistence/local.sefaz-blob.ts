import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { AppError } from '../../utils/errors.js';
import type { ISefazBlobStore } from './blob-store.types.js';

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

export class LocalSefazBlobStore implements ISefazBlobStore {
  constructor(private readonly baseDir: string) {}

  private fullPath(key: string): string {
    assertSafeLogicalKey(key);
    return resolve(this.baseDir, key);
  }

  async putUtf8(key: string, content: string): Promise<void> {
    const fp = this.fullPath(key);
    await mkdir(join(fp, '..'), { recursive: true, mode: 0o700 });
    await writeFile(fp, content, { encoding: 'utf8', mode: 0o600 });
  }

  async getUtf8(key: string): Promise<string | null> {
    try {
      const fp = this.fullPath(key);
      return await readFile(fp, 'utf8');
    } catch {
      return null;
    }
  }

  async putBuffer(key: string, body: Buffer, _contentType?: string): Promise<void> {
    const fp = this.fullPath(key);
    await mkdir(join(fp, '..'), { recursive: true, mode: 0o700 });
    await writeFile(fp, body, { mode: 0o600 });
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.fullPath(key));
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.fullPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    assertSafeLogicalKey(prefix);
    const root = resolve(this.baseDir, prefix);
    const baseResolved = resolve(this.baseDir);
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        const abs = join(dir, name);
        const st = await stat(abs);
        if (st.isDirectory()) {
          await walk(abs);
        } else if (st.isFile()) {
          const rel = relative(baseResolved, abs).split('\\').join('/');
          if (!rel.startsWith('..')) out.push(rel);
        }
      }
    }
    await walk(root);
    out.sort();
    return out;
  }
}
