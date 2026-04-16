import { normalizeCnpjDigits } from './sefaz-persistence/fiscal-paths.js';

/**
 * Fila por chave fiscal (empresa + ambiente + CNPJ): execuções concorrentes serializam.
 * Válido apenas no processo atual (sem lock distribuído).
 */
export class FiscalSyncKeyLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(companyId: string, tpAmb: string, cnpj: string, fn: () => Promise<T>): Promise<T> {
    const key = `${String(companyId)}|${String(tpAmb).trim()}|${normalizeCnpjDigits(cnpj)}`;
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() => fn()) as Promise<T>;
    this.tails.set(key, next.then(() => undefined, () => undefined));
    return next;
  }
}

export const fiscalSyncKeyLock = new FiscalSyncKeyLock();
