import type { CompanyId } from '../../types/index.js';

export function normalizeCnpjDigits(cnpj: string): string {
  return String(cnpj ?? '').replace(/\D/g, '');
}

export function assertCnpjPathSegment(cnpj: string): string {
  const d = normalizeCnpjDigits(cnpj);
  if (!/^\d{14}$/.test(d)) {
    throw new Error('cnpj inválido para path');
  }
  return d;
}

export function fiscalArtifactRoot(companyId: CompanyId, tpAmb: string, cnpj: string): string {
  const c = assertCnpjPathSegment(cnpj);
  const t = String(tpAmb).trim();
  return `sefaz/${String(companyId)}/${t}/${c}`;
}

export function syncStateKey(companyId: CompanyId, tpAmb: string, cnpj: string): string {
  return `${fiscalArtifactRoot(companyId, tpAmb, cnpj)}/sync-state.json`;
}

export function documentIndexKey(companyId: CompanyId, tpAmb: string, cnpj: string, nsu: string): string {
  return `${fiscalArtifactRoot(companyId, tpAmb, cnpj)}/index/${nsu}.json`;
}

export function documentXmlKey(companyId: CompanyId, tpAmb: string, cnpj: string, nsu: string): string {
  return `${fiscalArtifactRoot(companyId, tpAmb, cnpj)}/xml/raw/${nsu}.xml`;
}

export function documentJsonKey(companyId: CompanyId, tpAmb: string, cnpj: string, nsu: string): string {
  return `${fiscalArtifactRoot(companyId, tpAmb, cnpj)}/json/${nsu}.json`;
}

export function indexPrefix(companyId: CompanyId, tpAmb: string, cnpj: string): string {
  return `${fiscalArtifactRoot(companyId, tpAmb, cnpj)}/index/`;
}
