import type { CompanyId } from './index.js';

export type SyncLastSource = 'sefaz' | 'cache';

export interface SyncStateRecord {
  company_id: CompanyId;
  tp_amb: string;
  cnpj: string;
  ult_nsu: string;
  max_nsu: string;
  last_sync_at: string | null;
  last_cstat: string | null;
  last_xmotivo: string | null;
  cache_until: string | null;
  last_source: SyncLastSource | null;
  last_request_key: string | null;
  updated_at: string;
}

export interface IndexedDocumentRecord {
  id: string;
  company_id: CompanyId;
  tp_amb: string;
  cnpj: string;
  nsu: string;
  schema: string;
  tipo_documento: string;
  chave_nfe: string | null;
  data_emissao: string | null;
  emitente_cnpj: string | null;
  destinatario_cnpj: string | null;
  xml_storage_key: string;
  json_storage_key: string;
  root_tag: string | null;
  hash: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface SefazSyncRequestBody {
  companyId: number | string;
  cnpj: string;
  cUF: string;
  tpAmb: string;
  force?: boolean;
}

export interface SefazSyncDocumentSummary {
  nsu: string;
  schema: string;
  tipoDocumento: string;
  chaveNFe: string | null;
  dataEmissao: string | null;
  emitenteCnpj: string | null;
  destinatarioCnpj: string | null;
  xmlStorageKey: string;
  jsonStorageKey: string;
}

export interface SefazSyncResponse {
  success: true;
  /** Origem da última resposta materializada neste request (`cache` quando atendeu TTL sem SOAP). */
  source: 'sefaz' | 'cache';
  cached: boolean;
  companyId: CompanyId;
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  documentsCount: number;
  documents: SefazSyncDocumentSummary[];
  hasMore: boolean;
  nextUltNSU: string;
}

export interface DocumentListQuery {
  companyId: CompanyId;
  tpAmb: string;
  cnpj: string;
  from?: string;
  to?: string;
  schema?: string;
  tipoDocumento?: string;
  chaveNFe?: string;
  cursor?: string | null;
  limit?: number;
  sort?: 'dataEmissao' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

export interface DocumentListResult {
  items: IndexedDocumentRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}
