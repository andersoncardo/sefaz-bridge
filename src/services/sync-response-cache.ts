import { createHash } from 'node:crypto';
import { stableStringify } from '../utils/stable-json.js';

export interface CachedSyncPayload {
  response: unknown;
  storedAtMs: number;
}

export class SyncResponseCache {
  private readonly map = new Map<string, CachedSyncPayload>();

  constructor(private readonly ttlMs: number) {}

  buildRequestKey(parts: Record<string, unknown>): string {
    return createHash('sha256').update(stableStringify(parts)).digest('hex');
  }

  get(requestKey: string): unknown | null {
    const hit = this.map.get(requestKey);
    if (!hit) return null;
    if (Date.now() > hit.storedAtMs + this.ttlMs) {
      this.map.delete(requestKey);
      return null;
    }
    return hit.response;
  }

  set(requestKey: string, response: unknown): void {
    this.map.set(requestKey, { response, storedAtMs: Date.now() });
  }

  invalidate(requestKey: string): void {
    this.map.delete(requestKey);
  }
}

let singleton: SyncResponseCache | null = null;

export function getSyncResponseCache(): SyncResponseCache {
  if (!singleton) {
    const sec = Number(process.env.SYNC_CACHE_TTL_SEC ?? '300');
    const ttlMs = (Number.isFinite(sec) && sec > 0 ? sec : 300) * 1000;
    singleton = new SyncResponseCache(ttlMs);
  }
  return singleton;
}

export function resetSyncResponseCache(): void {
  singleton = null;
}
