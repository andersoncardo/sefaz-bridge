import type { CompanyCertificateMeta } from '../../types/index.js';
import type { CompanyId } from '../../types/index.js';

export interface CertificateStoragePayload {
  pfxBuffer: Buffer;
  passphrase: string;
  meta: CompanyCertificateMeta;
}

export interface StorageHealthResult {
  ok: boolean;
  driver: string;
  message?: string;
}

export interface IStorageService {
  saveCompanyCertificate(companyId: CompanyId, payload: CertificateStoragePayload): Promise<void>;
  readCompanyPfx(companyId: CompanyId): Promise<Buffer>;
  readCompanyPassphrase(companyId: CompanyId): Promise<string>;
  readCompanyMeta(companyId: CompanyId): Promise<CompanyCertificateMeta | null>;
  deleteCompanyCertificate(companyId: CompanyId): Promise<void>;
  healthCheck(): Promise<StorageHealthResult>;
}
