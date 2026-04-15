import axios, { type AxiosError } from 'axios';
import type { FastifyBaseLogger } from 'fastify';
import https from 'node:https';
import type { TlsIdentity } from './certificate.service.js';

const SOAP_CONTENT_TYPE = 'application/soap+xml; charset=utf-8';

export interface SoapPostResult {
  statusCode: number;
  body: string;
  durationMs: number;
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

export async function postSoap12(params: {
  url: string;
  soapBody: string;
  tls: TlsIdentity;
  logger: FastifyBaseLogger;
  debugSoap: boolean;
}): Promise<SoapPostResult> {
  const { url, soapBody, tls, logger, debugSoap } = params;
  const started = Date.now();
  const agent = createMtlsAgent(tls);

  if (debugSoap) {
    logger.debug({ soapRequestBytes: soapBody.length, soapRequest: soapBody }, 'SOAP request (debug)');
  }

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
    });

    const durationMs = Date.now() - started;
    const body = typeof res.data === 'string' ? res.data : String(res.data);

    if (debugSoap) {
      logger.debug(
        { status: res.status, soapResponseBytes: body.length, soapResponse: body },
        'SOAP response (debug)'
      );
    }

    return { statusCode: res.status, body, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const ax = err as AxiosError;
    const tlsHint =
      ax.code === 'EPROTO' || ax.code === 'ECONNRESET' || ax.message?.toLowerCase().includes('ssl');
    logger.error(
      {
        err: ax.message,
        code: ax.code,
        tlsHint,
        durationMs,
      },
      'Falha na chamada SOAP/HTTP'
    );
    throw err;
  }
}
