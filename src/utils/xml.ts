const WSDL_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';

/** Apenas dígitos — evita injeção no envelope SOAP */
function assertDigits(value: string, field: string, maxLen: number): string {
  const v = value.trim();
  if (!/^\d+$/.test(v) || v.length > maxLen) {
    throw new Error(`Campo inválido: ${field}`);
  }
  return v;
}

export function buildDistribuicaoSoapEnvelope(params: {
  cUF: string;
  tpAmb: string;
  cnpj: string;
  ultNSU: string;
}): string {
  const cUF = assertDigits(params.cUF, 'cUF', 2);
  const tpAmb = assertDigits(params.tpAmb, 'tpAmb', 1);
  const cnpj = assertDigits(params.cnpj, 'cnpj', 14);
  const ultNSU = assertDigits(params.ultNSU, 'ultNSU', 15);

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header>
    <nfeCabecMsg xmlns="${WSDL_NS}">
      <cUF>${cUF}</cUF>
      <versaoDados>1.01</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="${WSDL_NS}">
      <nfeDadosMsg>
        <distDFeInt xmlns="${NFE_NS}" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUF}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${ultNSU}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}
