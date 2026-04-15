import axios, { type AxiosError } from 'axios';
import type { FastifyBaseLogger } from 'fastify';
import https from 'node:https';
import { AppError } from '../utils/errors.js';
import { shouldLogSoapDebug } from '../utils/runtime-flags.js';
import type { TlsIdentity } from './certificate.service.js';

const SOAP_CONTENT_TYPE = 'application/soap+xml; charset=utf-8';

export interface SoapPostResult {
  statusCode: number;
  body: string;
  durationMs: number;
  attempts: number;
}

function createMtlsAgent(tls: TlsIdentity): https.Agent {
  return new https.Agent({
    cert: tls.cert,
    key: tls.key,
    passphrase: tls.passphrase,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    rejectUnauthorized: true,
  });
}

function readTimeoutMs(): number {
  const n = Number(process.env.SEFAZ_HTTP_TIMEOUT_MS ?? '90000');
  return Number.isFinite(n) && n > 0 ? n : 90000;
}

function readMaxRetries(): number {
  const n = Number(process.env.SEFAZ_HTTP_MAX_RETRIES ?? '2');
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5) : 2;
}

function isTransientNetworkError(err: unknown): boolean {
  const ax = err as AxiosError;
  const code = ax.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'EPIPE') {
    return true;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true;
  const status = ax.response?.status;
  if (status === 502 || status === 503 || status === 504) return true;
  const msg = (ax.message ?? '').toLowerCase();
  if (msg.includes('socket hang up')) return true;
  return false;
}

function isTlsLikelyError(err: unknown): boolean {
  const ax = err as AxiosError;
  const code = ax.code;
  if (code === 'EPROTO' || code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return true;
  }
  const msg = (ax.message ?? '').toLowerCase();
  return msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate');
}

export async function postSoap12(params: {
  url: string;
  soapBody: string;
  tls: TlsIdentity;
  logger: FastifyBaseLogger;
}): Promise<SoapPostResult> {
  const { url, soapBody, tls, logger } = params;
  const timeoutMs = readTimeoutMs();
  const maxRetries = readMaxRetries();
  const agent = createMtlsAgent(tls);
  const debugSoap = shouldLogSoapDebug();

  if (debugSoap) {
    logger.debug({ soapRequestBytes: soapBody.length, soapRequest: soapBody }, 'SOAP request (debug)');
  }

  const started = Date.now();
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    try {
      const res = await axios.post<string>(url, soapBody, {
        headers: {
          'Content-Type': SOAP_CONTENT_TYPE,
          Accept: 'application/soap+xml, text/xml, application/xml',
          'User-Agent': 'sefaz-bridge/1.0',
        },
        httpsAgent: agent,
        responseType: 'text',
        transitional: { forcedJSONParsing: false },
        validateStatus: () => true,
        maxBodyLength: Infinity,
        timeout: timeoutMs,
        maxRedirects: 0,
      });

      const durationMs = Date.now() - started;
      const body = typeof res.data === 'string' ? res.data : String(res.data);

      if (debugSoap) {
        logger.debug(
          { status: res.status, soapResponseBytes: body.length, soapResponse: body },
          'SOAP response (debug)'
        );
      }

      return { statusCode: res.status, body, durationMs, attempts };
    } catch (err) {
      const ax = err as AxiosError;
      const transient = isTransientNetworkError(err);
      if (attempt < maxRetries && transient) {
        const delay = 400 * (attempt + 1);
        logger.warn(
          { attempt: attempts, code: ax.code, delayMs: delay, stage: 'soap_transport' },
          'retry após falha transitória na SEFAZ'
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      const durationMs = Date.now() - started;
      if (isTlsLikelyError(err)) {
        logger.error(
          { err: ax.message, code: ax.code, durationMs, attempts, stage: 'tls' },
          'falha TLS na chamada SEFAZ'
        );
        throw new AppError(`Falha TLS ao contatar SEFAZ: ${ax.message ?? 'erro desconhecido'}`, {
          statusCode: 502,
          code: 'SEFAZ_TLS_ERROR',
          expose: false,
          category: 'tls',
          cause: err,
        });
      }

      logger.error(
        { err: ax.message, code: ax.code, durationMs, attempts, stage: 'soap_transport' },
        'falha na chamada SOAP/HTTP'
      );
      throw new AppError(`Falha de rede ao contatar SEFAZ: ${ax.message ?? 'erro desconhecido'}`, {
        statusCode: 502,
        code: 'SEFAZ_NETWORK_ERROR',
        expose: false,
        category: 'soap',
        cause: err,
      });
    }
  }

  throw new AppError('Falha inesperada na camada SOAP', {
    statusCode: 500,
    code: 'SOAP_UNEXPECTED',
    expose: false,
    category: 'soap',
  });
}
