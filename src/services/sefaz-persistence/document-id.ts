import type { CompanyId } from '../../types/index.js';
import { normalizeCnpjDigits } from './fiscal-paths.js';

export function buildDocumentApiId(companyId: CompanyId, tpAmb: string, cnpj: string, nsu: string): string {
  const payload = `${String(companyId)}|${String(tpAmb).trim()}|${normalizeCnpjDigits(cnpj)}|${String(nsu).trim()}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function parseDocumentApiId(id: string): { companyId: CompanyId; tpAmb: string; cnpj: string; nsu: string } | null {
  try {
    const s = Buffer.from(id, 'base64url').toString('utf8');
    const parts = s.split('|');
    if (parts.length !== 4) return null;
    return { companyId: parts[0], tpAmb: parts[1], cnpj: parts[2], nsu: parts[3] };
  } catch {
    return null;
  }
}
