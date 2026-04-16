import type { CompanyId } from '../types/index.js';
import type { SyncStateRecord } from '../types/sefaz-v1.js';
import type { ISefazBlobStore } from '../services/sefaz-persistence/blob-store.types.js';
import { syncStateKey } from '../services/sefaz-persistence/fiscal-paths.js';

const DEFAULT_ULT = '000000000000000';

export interface ISyncStateRepository {
  get(companyId: CompanyId, tpAmb: string, cnpj: string): Promise<SyncStateRecord | null>;
  save(state: SyncStateRecord): Promise<void>;
}

export function defaultSyncState(companyId: CompanyId, tpAmb: string, cnpj: string): SyncStateRecord {
  const now = new Date().toISOString();
  return {
    company_id: companyId,
    tp_amb: String(tpAmb).trim(),
    cnpj,
    ult_nsu: DEFAULT_ULT,
    max_nsu: DEFAULT_ULT,
    last_sync_at: null,
    last_cstat: null,
    last_xmotivo: null,
    cache_until: null,
    last_source: null,
    last_request_key: null,
    updated_at: now,
  };
}

export class JsonBlobSyncStateRepository implements ISyncStateRepository {
  constructor(private readonly blob: ISefazBlobStore) {}

  async get(companyId: CompanyId, tpAmb: string, cnpj: string): Promise<SyncStateRecord | null> {
    const raw = await this.blob.getUtf8(syncStateKey(companyId, tpAmb, cnpj));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SyncStateRecord;
    } catch {
      return null;
    }
  }

  async save(state: SyncStateRecord): Promise<void> {
    const key = syncStateKey(state.company_id, state.tp_amb, state.cnpj);
    await this.blob.putUtf8(key, JSON.stringify(state, null, 0));
  }
}
