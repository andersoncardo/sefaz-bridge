# sefaz-bridge

Microserviço **Node.js + TypeScript** para integração técnica com a **SEFAZ** (SOAP 1.2 + **mTLS**), pensado para rodar na **DigitalOcean App Platform** separado do app principal (ex.: Lovable).

## O que este projeto faz

- Recebe e armazena **certificado digital (.pfx)** por empresa (com senha e metadados).
- Valida o PFX (incluindo cenários em que o **PFX legado** não abre nativamente no Node, usando **node-forge** para extrair PEM).
- Executa chamadas **SOAP 1.2** com `Content-Type: application/soap+xml; charset=utf-8` usando **`https.Agent`** com **TLS 1.2+** e **SNI** automático.
- Implementa o fluxo de **NFe Distribuição DFe** (`distDFeInt`), parseando a resposta e decodificando **`docZip`** (**base64 + gzip**).
- Expõe endpoints internos protegidos por **Bearer token** (`SEFAZ_BRIDGE_SECRET`).
- Emite **logs estruturados** (Pino). Com `LOG_LEVEL=debug`, registra o SOAP completo (request/response).

> **Importante (App Platform):** o filesystem do container é **efêmero**. Para não perder certificados a cada deploy, configure um **Volume** montado no caminho usado por `CERT_STORAGE_PATH` (no Dockerfile de exemplo: `/data/certificates`).

## Requisitos

- **Node.js 20+** (recomendado **22**, alinhado ao Dockerfile).

## Instalação

```bash
npm install
```

## Configuração (.env)

Copie o exemplo:

```bash
cp .env.example .env
```

Variáveis principais:

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta HTTP (padrão `3000`). |
| `NODE_ENV` | `production` em produção. |
| `SEFAZ_BRIDGE_SECRET` | Segredo interno para `Authorization: Bearer ...`. **Não use `change-me` em produção.** |
| `CERT_STORAGE_PATH` | Diretório base onde ficam `company-<id>/certificate.pfx`, `passphrase.txt` e `meta.json`. |
| `LOG_LEVEL` | `info`, `debug`, etc. Em `debug`, loga SOAP completo. |
| `SEFAZ_DISTRIBUICAO_URL` | (Opcional) URL fixa do `.asmx`. Se omitido, usa URL **nacional** conforme `tpAmb` (`1` produção / `2` homologação). |

## Rodar localmente

```bash
npm run dev
```

Ou build + start:

```bash
npm run build
npm start
```

Healthcheck:

```bash
curl -s http://localhost:3000/health
```

## Endpoints

### `GET /health` (público)

```bash
curl -s http://localhost:3000/health
```

### `POST /api/companies/:companyId/certificate` (autenticado)

Multipart (`multipart/form-data`):

- `certificate`: arquivo `.pfx` ou `.p12`
- `password`: senha do certificado
- Opcional: `cnpj`, `uf`, `tpAmb`

```bash
curl -sS -X POST "http://localhost:3000/api/companies/1/certificate" \
  -H "Authorization: Bearer $SEFAZ_BRIDGE_SECRET" \
  -F "certificate=@/caminho/empresa.pfx" \
  -F "password=SUA_SENHA_AQUI"
```

### `POST /api/sefaz/distribuicao` (autenticado)

```bash
curl -sS -X POST "http://localhost:3000/api/sefaz/distribuicao" \
  -H "Authorization: Bearer $SEFAZ_BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": 1,
    "cnpj": "08174605000100",
    "cUF": "21",
    "tpAmb": "1",
    "ultNSU": "000000000000000"
  }'
```

## Onde o certificado fica armazenado

Por padrão (filesystem), cada empresa possui um diretório:

```text
${CERT_STORAGE_PATH}/company-<companyId>/
  certificate.pfx
  passphrase.txt
  meta.json
```

A interface `IStorageService` em `src/services/storage.service.ts` isola o storage para evolução futura (ex.: **Spaces/S3**) sem reescrever controllers.

## Onde configurar o secret interno

- **Local:** arquivo `.env` → `SEFAZ_BRIDGE_SECRET`.
- **DigitalOcean App Platform:** *Settings* → *App-Level Environment Variables* → defina `SEFAZ_BRIDGE_SECRET` como **SECRET**.
- **App principal (Lovable):** configure o mesmo valor em variável segura do backend e envie `Authorization: Bearer ...` em todas as chamadas ao bridge.

## Docker

Build local da imagem:

```bash
docker build -t sefaz-bridge:local .
docker run --rm -p 3000:3000 \
  -e SEFAZ_BRIDGE_SECRET="troque-isso" \
  -e LOG_LEVEL=info \
  sefaz-bridge:local
```

A imagem usa `USER node` e grava certificados em `/data/certificates` por padrão.

## Deploy na DigitalOcean App Platform (resumo)

1. Crie um **App** a partir deste repositório (Dockerfile) ou faça push da imagem para o Container Registry e referencie no App Spec.
2. Defina as variáveis de ambiente (`SEFAZ_BRIDGE_SECRET`, `LOG_LEVEL`, etc.).
3. Configure **HTTP route** na porta exposta (`3000` internamente; a DO injeta `PORT` — mantenha o servidor escutando `process.env.PORT`).
4. **Volume (recomendado):** adicione um volume persistente e monte em `/data/certificates` (ou ajuste `CERT_STORAGE_PATH` para o mount path informado pela DO).
5. Health check HTTP: `GET /health`.

Consulte a documentação oficial da DigitalOcean sobre [App Platform](https://docs.digitalocean.com/products/app-platform/) para detalhes de build, domínios e secrets.

## Cloudflare (subdomínio)

1. Na DigitalOcean, anote o **hostname** público do App (ou configure um domínio customizado no App).
2. No Cloudflare, crie um registro **CNAME** (ex.: `sefaz-bridge.seudominio.com`) apontando para o hostname do App (ou use **proxied** laranja conforme sua estratégia de TLS).
3. Garanta que o modo SSL/TLS do Cloudflare seja compatível com o seu cenário (tipicamente **Full (strict)** quando a origem apresenta certificado válido).

> Se o bridge for consumido **somente** por backends (Lovable/server), considere **não expor** publicamente e usar rede privada/VPN conforme a arquitetura da DO.

## Segurança e logs

- **Não** logue senha do certificado, chave privada ou conteúdo binário do PFX.
- É permitido logar **subject**, **issuer**, **validade**, **companyId**, **cStat**, **xMotivo** e contexto de falha.
- Em `LOG_LEVEL=debug`, o SOAP completo é logado — use apenas em diagnóstico.

## Scripts npm

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Desenvolvimento com `tsx watch`. |
| `npm run build` | Compila para `dist/`. |
| `npm start` | Executa `dist/server.js`. |
| `npm run typecheck` | `tsc --noEmit`. |

## Escopo da versão 1

Sem banco, sem fila, sem regras tributárias — apenas **bridge técnico** SOAP/mTLS + armazenamento simples de certificado.
