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
  /** SHA-256 do certificado (hex com `:` removido pelo Node — fingerprint256) */
  fingerprintSha256?: string;
  /** CNPJ extraído do certificado (14 dígitos), quando identificado */
  certCnpj?: string;
  /** Indica se foi necessário tratar PFX como legado (Node não abriu nativamente) */
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
  /** Metadados leves do documento decodificado */
  xmlCharLength?: number;
  rootTag?: string;
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
  fingerprintSha256: string;
  certCnpj?: string;
}
