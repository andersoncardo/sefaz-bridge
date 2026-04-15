import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompanyCertificateMeta } from '../types/index.js';
import type { CompanyId } from '../types/index.js';

export interface CertificateStoragePayload {
  pfxBuffer: Buffer;
  passphrase: string;
  meta: CompanyCertificateMeta;
}

/**
 * Abstração de armazenamento para permitir troca futura por S3/Spaces
 * sem alterar regras de negócio.
 */
export interface IStorageService {
  saveCompanyCertificate(companyId: CompanyId, payload: CertificateStoragePayload): Promise<void>;
  readCompanyPfx(companyId: CompanyId): Promise<Buffer>;
  readCompanyPassphrase(companyId: CompanyId): Promise<string>;
  readCompanyMeta(companyId: CompanyId): Promise<CompanyCertificateMeta | null>;
  deleteCompanyCertificate(companyId: CompanyId): Promise<void>;
}

function baseDir(): string {
  return process.env.CERT_STORAGE_PATH ?? './storage/certificates';
}

export class FilesystemStorageService implements IStorageService {
  private companyDir(companyId: CompanyId): string {
    return join(baseDir(), `company-${companyId}`);
  }

  private paths(companyId: CompanyId) {
    const dir = this.companyDir(companyId);
    return {
      dir,
      pfx: join(dir, 'certificate.pfx'),
      pass: join(dir, 'passphrase.txt'),
      meta: join(dir, 'meta.json'),
    };
  }

  async saveCompanyCertificate(companyId: CompanyId, payload: CertificateStoragePayload): Promise<void> {
    const p = this.paths(companyId);
    await mkdir(p.dir, { recursive: true, mode: 0o700 });
    await writeFile(p.pfx, payload.pfxBuffer, { mode: 0o600 });
    await writeFile(p.pass, payload.passphrase, { encoding: 'utf8', mode: 0o600 });
    await writeFile(p.meta, JSON.stringify(payload.meta, null, 0), { encoding: 'utf8', mode: 0o600 });
  }

  async readCompanyPfx(companyId: CompanyId): Promise<Buffer> {
    const p = this.paths(companyId);
    return readFile(p.pfx);
  }

  async readCompanyPassphrase(companyId: CompanyId): Promise<string> {
    const p = this.paths(companyId);
    return readFile(p.pass, 'utf8');
  }

  async readCompanyMeta(companyId: CompanyId): Promise<CompanyCertificateMeta | null> {
    const p = this.paths(companyId);
    try {
      const raw = await readFile(p.meta, 'utf8');
      return JSON.parse(raw) as CompanyCertificateMeta;
    } catch {
      return null;
    }
  }

  async deleteCompanyCertificate(companyId: CompanyId): Promise<void> {
    const p = this.paths(companyId);
    for (const f of [p.pfx, p.pass, p.meta]) {
      try {
        await unlink(f);
      } catch {
        /* ignore */
      }
    }
  }
}

let singleton: IStorageService | null = null;

export function getStorageService(): IStorageService {
  singleton ??= new FilesystemStorageService();
  return singleton;
}
