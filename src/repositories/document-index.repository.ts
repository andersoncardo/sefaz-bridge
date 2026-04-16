import type { CompanyId } from '../types/index.js';
import type { DocumentListQuery, DocumentListResult, IndexedDocumentRecord } from '../types/sefaz-v1.js';
import type { ISefazBlobStore } from '../services/sefaz-persistence/blob-store.types.js';
import { buildDocumentApiId, parseDocumentApiId } from '../services/sefaz-persistence/document-id.js';
import { documentIndexKey, indexPrefix } from '../services/sefaz-persistence/fiscal-paths.js';

export interface IDocumentIndexRepository {
  upsert(record: IndexedDocumentRecord): Promise<void>;
  getById(id: string): Promise<IndexedDocumentRecord | null>;
  getByNsu(companyId: CompanyId, tpAmb: string, cnpj: string, nsu: string): Promise<IndexedDocumentRecord | null>;
  list(query: DocumentListQuery): Promise<DocumentListResult>;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const j = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: number };
    return Number.isFinite(j.o) && j.o! >= 0 ? j.o! : 0;
  } catch {
    return 0;
  }
}

function parseIso(s: string | null | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export class FilePerNsuDocumentIndexRepository implements IDocumentIndexRepository {
  constructor(private readonly blob: ISefazBlobStore) {}

  async upsert(record: IndexedDocumentRecord): Promise<void> {
    const key = documentIndexKey(record.company_id, record.tp_amb, record.cnpj, record.nsu);
    await this.blob.putUtf8(key, JSON.stringify(record, null, 0));
  }

  async getByNsu(companyId: CompanyId, tpAmb: string, cnpj: string, nsu: string): Promise<IndexedDocumentRecord | null> {
    const raw = await this.blob.getUtf8(documentIndexKey(companyId, tpAmb, cnpj, nsu));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as IndexedDocumentRecord;
    } catch {
      return null;
    }
  }

  async getById(id: string): Promise<IndexedDocumentRecord | null> {
    const p = parseDocumentApiId(id);
    if (!p) return null;
    return this.getByNsu(p.companyId, p.tpAmb, p.cnpj, p.nsu);
  }

  async list(query: DocumentListQuery): Promise<DocumentListResult> {
    const prefix = indexPrefix(query.companyId, query.tpAmb, query.cnpj);
    const keys = await this.blob.listKeys(prefix);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = decodeCursor(query.cursor);
    const sort = query.sort ?? 'createdAt';
    const sortDir = query.sortDir ?? 'desc';

    const items: IndexedDocumentRecord[] = [];
    for (const k of keys) {
      if (!k.endsWith('.json')) continue;
      const raw = await this.blob.getUtf8(k);
      if (!raw) continue;
      let rec: IndexedDocumentRecord;
      try {
        rec = JSON.parse(raw) as IndexedDocumentRecord;
      } catch {
        continue;
      }
      if (query.schema && rec.schema !== query.schema) continue;
      if (query.tipoDocumento && rec.tipo_documento !== query.tipoDocumento) continue;
      if (query.chaveNFe && (rec.chave_nfe ?? '') !== query.chaveNFe) continue;
      if (query.from) {
        const de = rec.data_emissao ?? rec.created_at;
        if (!de || de < query.from) continue;
      }
      if (query.to) {
        const de = rec.data_emissao ?? rec.created_at;
        if (!de || de > query.to) continue;
      }
      items.push(rec);
    }

    items.sort((a, b) => {
      const av = sort === 'dataEmissao' ? parseIso(a.data_emissao) : parseIso(a.created_at);
      const bv = sort === 'dataEmissao' ? parseIso(b.data_emissao) : parseIso(b.created_at);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    const page = items.slice(offset, offset + limit);
    const hasMore = offset + limit < items.length;
    const nextCursor = hasMore ? encodeCursor(offset + limit) : null;

    return { items: page, nextCursor, hasMore };
  }
}

/** Preenche `id` estável a partir dos campos fiscais (para uso no sync). */
export function withDocumentApiId(
  partial: Omit<IndexedDocumentRecord, 'id'> & { id?: string }
): IndexedDocumentRecord {
  const id = partial.id ?? buildDocumentApiId(partial.company_id, partial.tp_amb, partial.cnpj, partial.nsu);
  return { ...partial, id } as IndexedDocumentRecord;
}
