import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CompanyCertificateMeta, CompanyId } from '../../types/index.js';
import { decryptEnvelope, encryptEnvelope } from '../../utils/crypto-envelope.js';
import { AppError } from '../../utils/errors.js';
import type { CertificateStoragePayload, IStorageService, StorageHealthResult } from './types.js';

/**
 * Armazenamento local para desenvolvimento: arquivos cifrados no disco.
 * Não usar como persistência definitiva em produção na App Platform.
 */
export class LocalStorageService implements IStorageService {
  constructor(private readonly baseDir: string) {}

  private companyDir(companyId: CompanyId): string {
    return join(this.baseDir, `company-${companyId}`);
  }

  private paths(companyId: CompanyId) {
    const dir = this.companyDir(companyId);
    return {
      dir,
      pfxEnc: join(dir, 'certificate.pfx.enc'),
      meta: join(dir, 'meta.json'),
    };
  }

  private aadPfx(companyId: CompanyId): string {
    return `sefaz-bridge:local:${companyId}:pfx`;
  }

  private aadPass(companyId: CompanyId): string {
    return `sefaz-bridge:local:${companyId}:pass`;
  }

  async saveCompanyCertificate(companyId: CompanyId, payload: CertificateStoragePayload): Promise<void> {
    await this.deleteCompanyCertificate(companyId);
    const p = this.paths(companyId);
    await mkdir(p.dir, { recursive: true, mode: 0o700 });

    const pfxEnc = encryptEnvelope(payload.pfxBuffer, this.aadPfx(companyId));
    const passEnc = encryptEnvelope(Buffer.from(payload.passphrase, 'utf8'), this.aadPass(companyId));

    await writeFile(p.pfxEnc, Buffer.concat([passEnc, Buffer.from([0x0a]), pfxEnc]), { mode: 0o600 });
    await writeFile(p.meta, JSON.stringify(payload.meta, null, 0), { encoding: 'utf8', mode: 0o600 });
  }

  async readCompanyPfx(companyId: CompanyId): Promise<Buffer> {
    const combined = await this.readCombinedEncrypted(companyId);
    return decryptEnvelope(combined.pfxEnc, this.aadPfx(companyId));
  }

  async readCompanyPassphrase(companyId: CompanyId): Promise<string> {
    const combined = await this.readCombinedEncrypted(companyId);
    const passBuf = decryptEnvelope(combined.passEnc, this.aadPass(companyId));
    return passBuf.toString('utf8');
  }

  private async readCombinedEncrypted(companyId: CompanyId): Promise<{ passEnc: Buffer; pfxEnc: Buffer }> {
    const p = this.paths(companyId);
    let raw: Buffer;
    try {
      raw = await readFile(p.pfxEnc);
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
      throw new AppError('Arquivo de certificado corrompido', {
        statusCode: 500,
        code: 'STORAGE_CORRUPT',
        expose: false,
        category: 'storage',
      });
    }
    return { passEnc: raw.subarray(0, sep), pfxEnc: raw.subarray(sep + 1) };
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
    for (const f of [p.pfxEnc, p.meta]) {
      try {
        await unlink(f);
      } catch {
        /* ignore */
      }
    }
  }

  async healthCheck(): Promise<StorageHealthResult> {
    try {
      const probe = join(this.baseDir, '.write_probe');
      await mkdir(this.baseDir, { recursive: true, mode: 0o700 });
      await writeFile(probe, `${Date.now()}`, { encoding: 'utf8', mode: 0o600 });
      await unlink(probe);
      return { ok: true, driver: 'local' };
    } catch (e) {
      return {
        ok: false,
        driver: 'local',
        message: e instanceof Error ? e.message : 'falha no probe de escrita',
      };
    }
  }
}

/** Diretório temporário apenas para processamento (não usado como store definitivo). */
export function tempProcessingDir(): string {
  return join(tmpdir(), 'sefaz-bridge-work');
}
