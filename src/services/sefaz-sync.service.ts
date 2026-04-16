import type { FastifyBaseLogger } from 'fastify';
import type { CompanyId } from '../types/index.js';
import type { SefazSyncRequestBody, SefazSyncResponse, SefazSyncDocumentSummary, SyncStateRecord } from '../types/sefaz-v1.js';
import { FilePerNsuDocumentIndexRepository, withDocumentApiId } from '../repositories/document-index.repository.js';
import { JsonBlobSyncStateRepository, defaultSyncState } from '../repositories/sync-state.repository.js';
import { consultarDistribuicao } from './sefaz-distribuicao.service.js';
import { fiscalSyncKeyLock } from './fiscal-sync-lock.js';
import { normalizeDistribuicaoXml, hashXmlSha256 } from './normalization/nfe-xml-normalizer.js';
import { getSefazBlobStore } from './sefaz-persistence/factory.js';
import { documentJsonKey, documentXmlKey, normalizeCnpjDigits } from './sefaz-persistence/fiscal-paths.js';
import { getSyncResponseCache } from './sync-response-cache.js';
import { maskCnpj } from '../utils/masking.js';

function padNsu15(s: string): string {
  const d = String(s ?? '').replace(/\D/g, '');
  if (!d) return ''.padStart(15, '0');
  return d.padStart(15, '0').slice(-15);
}

function computeHasMore(ultNSU: string, maxNSU: string): boolean {
  return padNsu15(ultNSU) < padNsu15(maxNSU);
}

export async function runSefazSync(params: {
  body: SefazSyncRequestBody;
  logger: FastifyBaseLogger;
  requestId: string;
}): Promise<SefazSyncResponse> {
  const { body, logger, requestId } = params;
  const companyId = String(body.companyId) as CompanyId;
  const tpAmb = String(body.tpAmb).trim();
  const cnpj = normalizeCnpjDigits(body.cnpj);
  const cUF = String(body.cUF).trim();

  const cache = getSyncResponseCache();
  const blob = getSefazBlobStore();
  const stateRepo = new JsonBlobSyncStateRepository(blob);
  const docRepo = new FilePerNsuDocumentIndexRepository(blob);

  return fiscalSyncKeyLock.run(companyId, tpAmb, cnpj, async () => {
    let state = (await stateRepo.get(companyId, tpAmb, cnpj)) ?? defaultSyncState(companyId, tpAmb, cnpj);
    state = { ...state, cnpj };

    const ultNSUForKey = state.ult_nsu;
    const requestKey = cache.buildRequestKey({
      companyId,
      cnpj,
      cUF,
      tpAmb,
      ultNSU: ultNSUForKey,
    });

    if (body.force) {
      cache.invalidate(requestKey);
    }

    if (!body.force) {
      const cached = cache.get(requestKey);
      if (cached) {
        const base = cached as SefazSyncResponse;
        const ttlSec = Number(process.env.SYNC_CACHE_TTL_SEC ?? '300');
        const ttlMs = (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 300) * 1000;
        const cacheUntil = new Date(Date.now() + ttlMs).toISOString();
        const nextState: SyncStateRecord = {
          ...state,
          last_source: 'cache',
          last_request_key: requestKey,
          cache_until: cacheUntil,
          updated_at: new Date().toISOString(),
        };
        await stateRepo.save(nextState);
        logger.info(
          { requestId, companyId, tpAmb, cnpjMasked: maskCnpj(cnpj), cacheHit: true, requestKey },
          'sync: resposta de cache'
        );
        return {
          ...base,
          source: 'cache',
          cached: true,
          companyId,
        };
      }
    }

    const started = Date.now();
    const dist = await consultarDistribuicao({
      body: {
        companyId,
        cnpj,
        cUF,
        tpAmb,
        ultNSU: state.ult_nsu,
      },
      logger,
      requestId,
    });

    const nowIso = new Date().toISOString();
    const summaries: SefazSyncDocumentSummary[] = [];

    for (const d of dist.documents) {
      const xmlKey = documentXmlKey(companyId, tpAmb, cnpj, d.nsu);
      const jsonKey = documentJsonKey(companyId, tpAmb, cnpj, d.nsu);
      const xmlHash = hashXmlSha256(d.xml);
      const existing = await docRepo.getByNsu(companyId, tpAmb, cnpj, d.nsu);

      if (
        existing &&
        existing.hash === xmlHash &&
        (await blob.exists(existing.xml_storage_key)) &&
        (await blob.exists(existing.json_storage_key))
      ) {
        const seen = nowIso;
        await docRepo.upsert({
          ...existing,
          last_seen_at: seen,
          updated_at: seen,
        });
        summaries.push({
          nsu: d.nsu,
          schema: d.schema,
          tipoDocumento: existing.tipo_documento,
          chaveNFe: existing.chave_nfe,
          dataEmissao: existing.data_emissao,
          emitenteCnpj: existing.emitente_cnpj,
          destinatarioCnpj: existing.destinatario_cnpj,
          xmlStorageKey: existing.xml_storage_key,
          jsonStorageKey: existing.json_storage_key,
        });
        continue;
      }

      const norm = normalizeDistribuicaoXml({
        xml: d.xml,
        nsu: d.nsu,
        schema: d.schema,
        rootTagHint: d.rootTag,
      });

      await blob.putBuffer(xmlKey, Buffer.from(d.xml, 'utf8'), 'application/xml');
      await blob.putUtf8(jsonKey, JSON.stringify(norm, null, 0));

      const createdAt = existing?.created_at ?? nowIso;
      const record = withDocumentApiId({
        company_id: companyId,
        tp_amb: tpAmb,
        cnpj,
        nsu: d.nsu,
        schema: d.schema,
        tipo_documento: norm.tipoDocumento,
        chave_nfe: norm.chaveNFe,
        data_emissao: norm.dataEmissao,
        emitente_cnpj: norm.emitenteCnpj,
        destinatario_cnpj: norm.destinatarioCnpj,
        xml_storage_key: xmlKey,
        json_storage_key: jsonKey,
        root_tag: norm.rootTag,
        hash: xmlHash,
        created_at: createdAt,
        updated_at: nowIso,
        last_seen_at: nowIso,
      });
      await docRepo.upsert(record);

      summaries.push({
        nsu: d.nsu,
        schema: d.schema,
        tipoDocumento: norm.tipoDocumento,
        chaveNFe: norm.chaveNFe,
        dataEmissao: norm.dataEmissao,
        emitenteCnpj: norm.emitenteCnpj,
        destinatarioCnpj: norm.destinatarioCnpj,
        xmlStorageKey: xmlKey,
        jsonStorageKey: jsonKey,
      });
    }

    const hasMore = computeHasMore(dist.ultNSU, dist.maxNSU);
    const response: SefazSyncResponse = {
      success: true,
      source: 'sefaz',
      cached: false,
      companyId,
      cStat: dist.cStat,
      xMotivo: dist.xMotivo,
      ultNSU: dist.ultNSU,
      maxNSU: dist.maxNSU,
      documentsCount: summaries.length,
      documents: summaries,
      hasMore,
      nextUltNSU: dist.ultNSU,
    };

    const ttlSec = Number(process.env.SYNC_CACHE_TTL_SEC ?? '300');
    const ttlMs = (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 300) * 1000;
    const cacheUntil = new Date(Date.now() + ttlMs).toISOString();

    const newState: SyncStateRecord = {
      ...state,
      ult_nsu: dist.ultNSU,
      max_nsu: dist.maxNSU,
      last_sync_at: nowIso,
      last_cstat: dist.cStat,
      last_xmotivo: dist.xMotivo,
      cache_until: cacheUntil,
      last_source: 'sefaz',
      last_request_key: requestKey,
      updated_at: nowIso,
    };
    await stateRepo.save(newState);

    cache.set(requestKey, response);

    logger.info(
      {
        requestId,
        companyId,
        tpAmb,
        cnpjMasked: maskCnpj(cnpj),
        cacheHit: false,
        cStat: dist.cStat,
        xMotivo: dist.xMotivo,
        documentsCount: summaries.length,
        hasMore,
        durationMs: Date.now() - started,
      },
      'sync: consulta SEFAZ concluída'
    );

    return response;
  });
}

export async function readSyncStatePublic(params: {
  companyId: CompanyId;
  tpAmb: string;
  cnpj: string;
}): Promise<Record<string, unknown>> {
  const blob = getSefazBlobStore();
  const repo = new JsonBlobSyncStateRepository(blob);
  const cnpj = normalizeCnpjDigits(params.cnpj);
  const row = (await repo.get(params.companyId, params.tpAmb, cnpj)) ?? defaultSyncState(params.companyId, params.tpAmb, cnpj);
  return {
    companyId: row.company_id,
    ultNSU: row.ult_nsu,
    maxNSU: row.max_nsu,
    lastSyncAt: row.last_sync_at,
    lastCStat: row.last_cstat,
    lastXMotivo: row.last_xmotivo,
    cacheUntil: row.cache_until,
    lastSource: row.last_source,
    lastRequestKey: row.last_request_key,
    updatedAt: row.updated_at,
    tpAmb: row.tp_amb,
    cnpj: row.cnpj,
  };
}
