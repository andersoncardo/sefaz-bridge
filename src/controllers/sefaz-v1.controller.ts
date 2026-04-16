import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CompanyId } from '../types/index.js';
import type { IndexedDocumentRecord, SefazSyncRequestBody } from '../types/sefaz-v1.js';
import { FilePerNsuDocumentIndexRepository } from '../repositories/document-index.repository.js';
import { getSefazBlobStore } from '../services/sefaz-persistence/factory.js';
import { normalizeCnpjDigits } from '../services/sefaz-persistence/fiscal-paths.js';
import { readSyncStatePublic, runSefazSync } from '../services/sefaz-sync.service.js';
import { AppError } from '../utils/errors.js';

function assertSefazSyncBody(body: unknown): SefazSyncRequestBody {
  if (!body || typeof body !== 'object') {
    throw new AppError('JSON inválido', {
      statusCode: 400,
      code: 'INVALID_JSON',
      expose: true,
      category: 'parse',
    });
  }
  const b = body as Record<string, unknown>;
  const companyId = b.companyId;
  if (companyId == null || (typeof companyId !== 'string' && typeof companyId !== 'number')) {
    throw new AppError('companyId obrigatório', {
      statusCode: 400,
      code: 'MISSING_COMPANY_ID',
      expose: true,
      category: 'parse',
    });
  }
  const cnpj = String(b.cnpj ?? '').replace(/\D/g, '');
  if (!/^\d{14}$/.test(cnpj)) {
    throw new AppError('cnpj inválido (14 dígitos)', {
      statusCode: 400,
      code: 'INVALID_CNPJ',
      expose: true,
      category: 'parse',
    });
  }
  const cUF = String(b.cUF ?? '').trim();
  if (!/^\d{2}$/.test(cUF)) {
    throw new AppError('cUF inválido (2 dígitos)', {
      statusCode: 400,
      code: 'INVALID_CUF',
      expose: true,
      category: 'parse',
    });
  }
  const tpAmb = String(b.tpAmb ?? '').trim();
  if (!/^[12]$/.test(tpAmb)) {
    throw new AppError('tpAmb inválido (1 ou 2)', {
      statusCode: 400,
      code: 'INVALID_TPAMB',
      expose: true,
      category: 'parse',
    });
  }
  const force = b.force === true;
  return { companyId, cnpj, cUF, tpAmb, force };
}

function parseTpAmbCnpjQuery(q: Record<string, unknown>): { tpAmb: string; cnpj: string } {
  const tpAmb = String(q.tpAmb ?? '').trim();
  if (!/^[12]$/.test(tpAmb)) {
    throw new AppError('Query tpAmb obrigatório (1 ou 2)', {
      statusCode: 400,
      code: 'MISSING_TPAMB',
      expose: true,
      category: 'parse',
    });
  }
  const cnpj = normalizeCnpjDigits(String(q.cnpj ?? ''));
  if (!/^\d{14}$/.test(cnpj)) {
    throw new AppError('Query cnpj obrigatório (14 dígitos)', {
      statusCode: 400,
      code: 'MISSING_CNPJ',
      expose: true,
      category: 'parse',
    });
  }
  return { tpAmb, cnpj };
}

function mapDocumentPublic(rec: IndexedDocumentRecord) {
  return {
    id: rec.id,
    companyId: rec.company_id,
    tpAmb: rec.tp_amb,
    cnpj: rec.cnpj,
    nsu: rec.nsu,
    schema: rec.schema,
    tipoDocumento: rec.tipo_documento,
    chaveNFe: rec.chave_nfe,
    dataEmissao: rec.data_emissao,
    emitenteCnpj: rec.emitente_cnpj,
    destinatarioCnpj: rec.destinatario_cnpj,
    xmlStorageKey: rec.xml_storage_key,
    jsonStorageKey: rec.json_storage_key,
    rootTag: rec.root_tag,
    hash: rec.hash,
    createdAt: rec.created_at,
    updatedAt: rec.updated_at,
    lastSeenAt: rec.last_seen_at,
  };
}

export async function postSefazSync(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = assertSefazSyncBody(request.body);
  const result = await runSefazSync({
    body,
    logger: request.log,
    requestId: request.id,
  });
  await reply.send(result);
}

export async function getSefazSyncState(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const companyId = String((request.params as { companyId: string }).companyId) as CompanyId;
  const { tpAmb, cnpj } = parseTpAmbCnpjQuery(request.query as Record<string, unknown>);
  const payload = await readSyncStatePublic({ companyId, tpAmb, cnpj });
  await reply.send(payload);
}

export async function listSefazDocuments(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const q = request.query as Record<string, unknown>;
  const companyId = String(q.companyId ?? '') as CompanyId;
  if (!companyId) {
    throw new AppError('companyId obrigatório', {
      statusCode: 400,
      code: 'MISSING_COMPANY_ID',
      expose: true,
      category: 'parse',
    });
  }
  const { tpAmb, cnpj } = parseTpAmbCnpjQuery(q);
  const blob = getSefazBlobStore();
  const repo = new FilePerNsuDocumentIndexRepository(blob);
  const limit = q.limit != null ? Number(q.limit) : 50;
  const sort = q.sort === 'dataEmissao' || q.sort === 'createdAt' ? q.sort : 'createdAt';
  const sortDir = q.sortDir === 'asc' || q.sortDir === 'desc' ? q.sortDir : 'desc';
  const res = await repo.list({
    companyId,
    tpAmb,
    cnpj,
    from: q.from != null ? String(q.from) : undefined,
    to: q.to != null ? String(q.to) : undefined,
    schema: q.schema != null ? String(q.schema) : undefined,
    tipoDocumento: q.tipoDocumento != null ? String(q.tipoDocumento) : undefined,
    chaveNFe: q.chaveNFe != null ? String(q.chaveNFe) : undefined,
    cursor: q.cursor != null ? String(q.cursor) : undefined,
    limit: Number.isFinite(limit) ? limit : 50,
    sort,
    sortDir,
  });
  await reply.send({
    items: res.items.map(mapDocumentPublic),
    nextCursor: res.nextCursor,
    hasMore: res.hasMore,
  });
}

export async function getSefazDocument(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = String((request.params as { id: string }).id);
  const blob = getSefazBlobStore();
  const repo = new FilePerNsuDocumentIndexRepository(blob);
  const rec = await repo.getById(id);
  if (!rec) {
    throw new AppError('Documento não encontrado', {
      statusCode: 404,
      code: 'DOCUMENT_NOT_FOUND',
      expose: true,
      category: 'storage',
    });
  }
  await reply.send(mapDocumentPublic(rec));
}

export async function getSefazDocumentXml(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = String((request.params as { id: string }).id);
  const blob = getSefazBlobStore();
  const repo = new FilePerNsuDocumentIndexRepository(blob);
  const rec = await repo.getById(id);
  if (!rec) {
    throw new AppError('Documento não encontrado', {
      statusCode: 404,
      code: 'DOCUMENT_NOT_FOUND',
      expose: true,
      category: 'storage',
    });
  }
  const xml = await blob.getUtf8(rec.xml_storage_key);
  if (!xml) {
    throw new AppError('XML não encontrado no storage', {
      statusCode: 404,
      code: 'XML_NOT_FOUND',
      expose: true,
      category: 'storage',
    });
  }
  await reply.header('Content-Type', 'application/xml; charset=utf-8').send(xml);
}

export async function getSefazDocumentJson(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = String((request.params as { id: string }).id);
  const blob = getSefazBlobStore();
  const repo = new FilePerNsuDocumentIndexRepository(blob);
  const rec = await repo.getById(id);
  if (!rec) {
    throw new AppError('Documento não encontrado', {
      statusCode: 404,
      code: 'DOCUMENT_NOT_FOUND',
      expose: true,
      category: 'storage',
    });
  }
  const raw = await blob.getUtf8(rec.json_storage_key);
  if (!raw) {
    throw new AppError('JSON não encontrado no storage', {
      statusCode: 404,
      code: 'JSON_NOT_FOUND',
      expose: true,
      category: 'storage',
    });
  }
  try {
    await reply.send(JSON.parse(raw) as unknown);
  } catch {
    throw new AppError('JSON corrompido no storage', {
      statusCode: 500,
      code: 'JSON_CORRUPT',
      expose: false,
      category: 'storage',
    });
  }
}

export async function getSefazDocumentContent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const format = String((request.query as { format?: string }).format ?? '').toLowerCase();
  if (format === 'xml') {
    await getSefazDocumentXml(request, reply);
    return;
  }
  if (format === 'json') {
    await getSefazDocumentJson(request, reply);
    return;
  }
  throw new AppError('Query format obrigatório: xml ou json', {
    statusCode: 400,
    code: 'MISSING_FORMAT',
    expose: true,
    category: 'parse',
  });
}
