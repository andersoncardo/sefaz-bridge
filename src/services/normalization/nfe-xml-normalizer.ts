import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
});

const SCHEMA_TO_TIPO: Record<string, string> = {
  'procNFe_v4.00.xsd': 'nfe_proc',
  'procNFe_v3.10.xsd': 'nfe_proc',
  'resNFe_v1.01.xsd': 'nfe_resumo',
  'resEvento_v1.01.xsd': 'evento_resumo',
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function getDeep(obj: unknown, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    const r = asRecord(cur);
    if (!r) return undefined;
    cur = r[k];
  }
  return cur;
}

function sniffRootTag(xml: string): string | undefined {
  const m = xml.match(/<([A-Za-z0-9_.:-]+)(\s|\/?>)/);
  return m?.[1];
}

function onlyDigits(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

function stripNfePrefix(id: string): string {
  return id.replace(/^NFe/i, '');
}

export interface TechnicalNormalizedDocument {
  kind: 'sefaz_bridge_technical_v1';
  nsu: string;
  schema: string;
  tipoDocumento: string;
  rootTag: string | null;
  chaveNFe: string | null;
  dataEmissao: string | null;
  emitenteCnpj: string | null;
  destinatarioCnpj: string | null;
  hashSha256: string;
  normalizedAt: string;
}

export function hashXmlSha256(xml: string): string {
  return createHash('sha256').update(xml, 'utf8').digest('hex');
}

function inferTipoFromRoot(root: string | undefined, schema: string): string {
  const fromSchema = SCHEMA_TO_TIPO[schema];
  if (fromSchema) return fromSchema;
  const r = (root ?? '').toLowerCase();
  if (r.includes('procnfe') || r === 'nfeproc') return 'nfe_proc';
  if (r.includes('resnfe')) return 'nfe_resumo';
  if (r.includes('resevento') || r.includes('evento')) return 'evento_resumo';
  return 'desconhecido';
}

/**
 * JSON **técnico** para persistência no blob — não é contrato de negócio do app principal.
 */
export function normalizeDistribuicaoXml(params: {
  xml: string;
  nsu: string;
  schema: string;
  rootTagHint?: string;
}): TechnicalNormalizedDocument {
  const { xml, nsu, schema } = params;
  const rootTag = params.rootTagHint ?? sniffRootTag(xml) ?? null;
  const tipoDocumento = inferTipoFromRoot(rootTag ?? undefined, schema);
  const hashSha256 = hashXmlSha256(xml);
  const now = new Date().toISOString();

  let chaveNFe: string | null = null;
  let dataEmissao: string | null = null;
  let emitenteCnpj: string | null = null;
  let destinatarioCnpj: string | null = null;

  try {
    const doc = parser.parse(xml) as Record<string, unknown>;
    const root = asRecord(doc[Object.keys(doc)[0] ?? '']) ?? doc;

    const nfe = asRecord(getDeep(root, ['NFe', 'infNFe'])) ?? asRecord(getDeep(root, ['nfe', 'infNFe']));
    const infNFe = asRecord(getDeep(root, ['infNFe'])) ?? nfe;
    if (infNFe) {
      const idRaw = String(infNFe['@_Id'] ?? infNFe.Id ?? '');
      if (idRaw) chaveNFe = stripNfePrefix(idRaw);
      const ide = asRecord(infNFe.ide);
      if (ide) {
        dataEmissao = (String(ide.dhEmi ?? ide.dEmi ?? '') || null) as string | null;
      }
      const emit = asRecord(infNFe.emit);
      if (emit) {
        emitenteCnpj = onlyDigits(String(emit.CNPJ ?? emit.CPF ?? '')) || null;
      }
      const dest = asRecord(infNFe.dest);
      if (dest) {
        destinatarioCnpj = onlyDigits(String(dest.CNPJ ?? dest.CPF ?? '')) || null;
      }
    }

    const resNFe = asRecord(root['resNFe']) ?? asRecord(doc['resNFe']);
    if (resNFe && !chaveNFe) {
      const chNFe = String(resNFe.chNFe ?? '');
      if (chNFe) chaveNFe = chNFe;
      dataEmissao = (String(resNFe.dhEmi ?? resNFe.dEmi ?? '') || null) as string | null;
      const emit = asRecord(resNFe.emit);
      if (emit) emitenteCnpj = onlyDigits(String(emit.CNPJ ?? emit.CPF ?? '')) || null;
    }

    const resEvento = asRecord(root['resEvento']) ?? asRecord(doc['resEvento']);
    if (resEvento && !chaveNFe) {
      const inf = asRecord(resEvento.infEvento);
      if (inf) {
        chaveNFe = String(inf.chNFe ?? '') || null;
        dataEmissao = (String(inf.dhEvento ?? '') || null) as string | null;
      }
    }
  } catch {
    // mantém campos mínimos com rootTag/schema
  }

  return {
    kind: 'sefaz_bridge_technical_v1',
    nsu,
    schema,
    tipoDocumento,
    rootTag,
    chaveNFe,
    dataEmissao,
    emitenteCnpj,
    destinatarioCnpj,
    hashSha256,
    normalizedAt: now,
  };
}
