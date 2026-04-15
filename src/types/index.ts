export type CompanyId = string;

export interface CompanyCertificateMeta {
  companyId: CompanyId;
  /** Metadados opcionais informados no upload */
  cnpj?: string;
  uf?: string;
  tpAmb?: string;
  /** Extraídos do certificado */
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  /** Indica se foi necessário normalizar PFX via node-forge */
  normalizedFromLegacyPfx?: boolean;
  storedAt: string;
}

export interface DistribuicaoRequestBody {
  companyId: number | string;
  cnpj: string;
  cUF: string;
  tpAmb: string;
  ultNSU: string;
}

export interface DistribuicaoDocument {
  nsu: string;
  schema: string;
  xml: string;
}

export interface DistribuicaoResponsePayload {
  success: true;
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  documents: DistribuicaoDocument[];
}

export interface CertificateUploadResult {
  success: true;
  companyId: CompanyId;
  certificateStored: true;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
}
