import type { FastifyBaseLogger } from 'fastify';
import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import type { DistribuicaoDocument, DistribuicaoRequestBody, DistribuicaoResponsePayload } from '../types/index.js';
import { AppError } from '../utils/errors.js';
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

function extractRet(xml: string): Record<string, unknown> {
  const doc = parser.parse(xml) as Record<string, unknown>;

  const candidates = [
    ['Envelope', 'Body', 'nfeDistDFeInteresseResponse', 'nfeDistDFeInteresseResult', 'retDistDFeInt'],
    ['Envelope', 'Body', 'nfeDistDFeInteresseResponse', 'retDistDFeInt'],
  ];

  for (const path of candidates) {
    const node = getDeep(doc, path);
    const r = asRecord(node);
    if (r) return r;
  }

  const fault = extractSoapFault(xml);
  if (fault) {
    throw new AppError(`SOAP Fault: ${fault}`, { statusCode: 502, code: 'SOAP_FAULT', expose: true });
  }

  throw new AppError('Resposta SOAP sem retDistDFeInt reconhecido', {
    statusCode: 502,
    code: 'SOAP_PARSE_ERROR',
    expose: true,
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
    out.push({ nsu, schema, xml });
  }
  return out;
}

export async function consultarDistribuicao(params: {
  body: DistribuicaoRequestBody;
  logger: FastifyBaseLogger;
}): Promise<DistribuicaoResponsePayload> {
  const { body, logger } = params;
  const companyId = String(body.companyId);
  const storage = getStorageService();

  const pfx = await storage.readCompanyPfx(companyId).catch(() => null);
  if (!pfx) {
    throw new AppError('Certificado não encontrado para a empresa', {
      statusCode: 404,
      code: 'CERT_NOT_FOUND',
      expose: true,
    });
  }

  const passphrase = await storage.readCompanyPassphrase(companyId).catch(() => null);
  if (!passphrase) {
    throw new AppError('Credenciais do certificado incompletas', {
      statusCode: 404,
      code: 'CERT_PASSPHRASE_MISSING',
      expose: true,
    });
  }

  const { tls, meta } = analyzeAndMaterializeTlsIdentity(pfx, passphrase.trimEnd());

  logger.info(
    {
      companyId,
      tlsSource: tls.source,
      legacyPfx: meta.normalizedFromLegacyPfx,
      subject: meta.subject,
    },
    'Material TLS preparado para consulta SEFAZ'
  );

  const soap = buildDistribuicaoSoapEnvelope({
    cUF: body.cUF,
    tpAmb: body.tpAmb,
    cnpj: body.cnpj,
    ultNSU: body.ultNSU,
  });

  const url = defaultDistribuicaoUrl(body.tpAmb);
  const debugSoap = (process.env.LOG_LEVEL ?? '').toLowerCase() === 'debug';

  const res = await postSoap12({
    url,
    soapBody: soap,
    tls,
    logger,
    debugSoap,
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    logger.error({ statusCode: res.statusCode, durationMs: res.durationMs }, 'HTTP inesperado na SEFAZ');
    throw new AppError(`SEFAZ retornou HTTP ${res.statusCode}`, {
      statusCode: 502,
      code: 'SEFAZ_HTTP_ERROR',
      expose: true,
    });
  }

  const ret = extractRet(res.body);
  const cStat = String(ret.cStat ?? '');
  const xMotivo = String(ret.xMotivo ?? '');
  const ultNSU = String(ret.ultNSU ?? body.ultNSU);
  const maxNSU = String(ret.maxNSU ?? ultNSU);

  logger.info(
    { companyId, cStat, xMotivo, durationMs: res.durationMs, ultNSU, maxNSU },
    'Consulta distribuição concluída'
  );

  const documents = extractDocuments(ret);

  return {
    success: true,
    cStat,
    xMotivo,
    ultNSU,
    maxNSU,
    documents,
  };
}
