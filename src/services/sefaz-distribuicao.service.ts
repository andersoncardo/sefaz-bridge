import type { FastifyBaseLogger } from 'fastify';
import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import type { DistribuicaoDocument, DistribuicaoRequestBody, DistribuicaoResponsePayload } from '../types/index.js';
import { AppError } from '../utils/errors.js';
import { maskCnpj } from '../utils/masking.js';
import { appEnvironmentLabel } from '../utils/runtime-flags.js';
import { buildDistribuicaoSoapEnvelope } from '../utils/xml.js';
import { analyzeAndMaterializeTlsIdentity } from './certificate.service.js';
import { postSoap12 } from './soap.service.js';
import { getStorageService } from './storage.service.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
});

function defaultDistribuicaoUrl(tpAmb: string): string {
  const fromEnv = process.env.SEFAZ_DISTRIBUICAO_URL;
  if (fromEnv) return fromEnv;
  return tpAmb === '2'
    ? 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
    : 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
}

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

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function readDocZipPayload(node: Record<string, unknown>): string {
  const textKeys = ['#text', '__text', '#content'];
  for (const k of textKeys) {
    const v = node[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  const vals = Object.values(node).filter((x) => typeof x === 'string') as string[];
  const longest = vals.sort((a, b) => b.length - a.length)[0];
  return longest ?? '';
}

function decodeDocZipBase64Gzip(base64: string): string {
  const raw = Buffer.from(base64, 'base64');
  try {
    return gunzipSync(raw).toString('utf8');
  } catch {
    return raw.toString('utf8');
  }
}

function sniffRootTag(xml: string): string | undefined {
  const m = xml.match(/<([A-Za-z0-9_.:-]+)(\s|\/?>)/);
  return m?.[1];
}

function extractSoapFault(xml: string): string | null {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const fault = getDeep(doc, ['Envelope', 'Body', 'Fault']);
  const fr = asRecord(fault);
  if (!fr) return null;
  const reason = fr.Reason ?? fr.faultstring ?? fr.detail;
  if (typeof reason === 'string') return reason;
  const rr = asRecord(reason);
  const text = rr ? rr.Text : undefined;
  return typeof text === 'string' ? text : JSON.stringify(reason);
}

function looksLikeRet(r: Record<string, unknown> | null): r is Record<string, unknown> {
  if (!r) return false;
  return 'cStat' in r || 'loteDistDFeInt' in r || 'xMotivo' in r || 'ultNSU' in r || 'maxNSU' in r;
}

/** Quando `nfeDistDFeInteresseResult` vem como string XML ou como objeto com `retDistDFeInt` aninhado. */
function parseInteresseResultNode(result: unknown): Record<string, unknown> | null {
  if (result == null) return null;
  if (typeof result === 'string') {
    const t = result.trim();
    if (!t) return null;
    try {
      const inner = parser.parse(t) as Record<string, unknown>;
      const direct = asRecord(inner.retDistDFeInt);
      if (looksLikeRet(direct)) return direct;
      const nested = asRecord(getDeep(inner, ['nfeDistDFeInteresseResult', 'retDistDFeInt']));
      if (looksLikeRet(nested)) return nested;
      if (looksLikeRet(inner)) return inner;
    } catch {
      return null;
    }
    return null;
  }
  const rec = asRecord(result);
  if (!rec) return null;
  const innerRet = asRecord(rec.retDistDFeInt);
  if (looksLikeRet(innerRet)) return innerRet;
  if (looksLikeRet(rec)) return rec;
  return null;
}

function extractRet(xml: string): Record<string, unknown> {
  const doc = parser.parse(xml) as Record<string, unknown>;

  const rawResult = getDeep(doc, ['Envelope', 'Body', 'nfeDistDFeInteresseResponse', 'nfeDistDFeInteresseResult']);
  const fromResult = parseInteresseResultNode(rawResult);
  if (fromResult) return fromResult;

  const candidates = [
    ['Envelope', 'Body', 'nfeDistDFeInteresseResponse', 'nfeDistDFeInteresseResult', 'retDistDFeInt'],
    ['Envelope', 'Body', 'nfeDistDFeInteresseResponse', 'retDistDFeInt'],
    ['Envelope', 'Body', 'nfeDistDFeInteresseResponse', 'nfeDistDFeInteresseResult', 'nfeDistDFeInteresseResult'],
  ];

  for (const path of candidates) {
    const node = getDeep(doc, path);
    const r = asRecord(node);
    if (looksLikeRet(r)) return r;
  }

  const fault = extractSoapFault(xml);
  if (fault) {
    throw new AppError(`SOAP Fault: ${fault}`, {
      statusCode: 502,
      code: 'SOAP_FAULT',
      expose: true,
      category: 'soap',
    });
  }

  throw new AppError('Resposta SOAP sem retDistDFeInt reconhecido', {
    statusCode: 502,
    code: 'SOAP_PARSE_ERROR',
    expose: true,
    category: 'parse',
  });
}

function extractDocuments(ret: Record<string, unknown>): DistribuicaoDocument[] {
  const lote = ret.loteDistDFeInt;
  const lr = asRecord(lote);
  if (!lr) return [];

  const docZipRaw = lr.docZip;
  const nodes = toArray(docZipRaw).map((x) => asRecord(x)).filter(Boolean) as Record<string, unknown>[];

  const out: DistribuicaoDocument[] = [];
  for (const n of nodes) {
    const nsu = String(n['@_NSU'] ?? n['@_nsu'] ?? '');
    const schema = String(n['@_schema'] ?? n['@_Schema'] ?? '');
    const b64 = readDocZipPayload(n);
    if (!b64) continue;
    const xml = decodeDocZipBase64Gzip(b64);
    out.push({
      nsu,
      schema,
      xml,
      xmlCharLength: xml.length,
      rootTag: sniffRootTag(xml),
    });
  }
  return out;
}

export async function consultarDistribuicao(params: {
  body: DistribuicaoRequestBody;
  logger: FastifyBaseLogger;
  requestId?: string;
}): Promise<DistribuicaoResponsePayload> {
  const { body, logger, requestId } = params;
  const companyId = String(body.companyId);
  const storage = getStorageService();
  const sefazUrl = defaultDistribuicaoUrl(body.tpAmb);
  const started = Date.now();

  const pfx = await storage.readCompanyPfx(companyId).catch(() => null);
  if (!pfx) {
    throw new AppError('Certificado não encontrado para a empresa', {
      statusCode: 404,
      code: 'CERT_NOT_FOUND',
      expose: true,
      category: 'storage',
    });
  }

  const passphrase = await storage.readCompanyPassphrase(companyId).catch(() => null);
  if (!passphrase) {
    throw new AppError('Credenciais do certificado incompletas', {
      statusCode: 404,
      code: 'CERT_PASSPHRASE_MISSING',
      expose: true,
      category: 'storage',
    });
  }

  const meta = await storage.readCompanyMeta(companyId);
  const { tls, meta: tlsMeta } = analyzeAndMaterializeTlsIdentity(pfx, passphrase.trimEnd());

  logger.info(
    {
      requestId,
      companyId,
      endpoint: '/api/sefaz/distribuicao',
      sefazUrl,
      tlsSource: tls.source,
      legacyPfx: tlsMeta.normalizedFromLegacyPfx,
      fingerprintSha256: meta?.fingerprintSha256,
      cnpjMasked: maskCnpj(body.cnpj),
      appEnv: appEnvironmentLabel(),
    },
    'material TLS preparado para consulta SEFAZ'
  );

  const soap = buildDistribuicaoSoapEnvelope({
    cUF: body.cUF,
    tpAmb: body.tpAmb,
    cnpj: body.cnpj,
    ultNSU: body.ultNSU,
  });

  const res = await postSoap12({
    url: sefazUrl,
    soapBody: soap,
    tls,
    logger,
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    logger.error(
      {
        companyId,
        sefazUrl,
        statusCode: res.statusCode,
        durationMs: res.durationMs,
        attempts: res.attempts,
        stage: 'sefaz_http',
      },
      'HTTP inesperado na SEFAZ'
    );
    throw new AppError(`SEFAZ retornou HTTP ${res.statusCode}`, {
      statusCode: 502,
      code: 'SEFAZ_HTTP_ERROR',
      expose: true,
      category: 'soap',
    });
  }

  const ret = extractRet(res.body);
  const cStat = String(ret.cStat ?? '');
  const xMotivo = String(ret.xMotivo ?? '');
  const ultNSU = String(ret.ultNSU ?? body.ultNSU);
  const maxNSU = String(ret.maxNSU ?? ultNSU);

  const documents = extractDocuments(ret);
  const totalMs = Date.now() - started;

  logger.info(
    {
      requestId,
      companyId,
      endpoint: '/api/sefaz/distribuicao',
      sefazUrl,
      cStat,
      xMotivo,
      ultNSU,
      maxNSU,
      docZipCount: documents.length,
      durationMs: totalMs,
      soapDurationMs: res.durationMs,
      soapAttempts: res.attempts,
      fingerprintSha256: meta?.fingerprintSha256,
      cnpjMasked: maskCnpj(body.cnpj),
      appEnv: appEnvironmentLabel(),
    },
    'consulta distribuição concluída'
  );

  return {
    success: true,
    cStat,
    xMotivo,
    ultNSU,
    maxNSU,
    documents,
  };
}
