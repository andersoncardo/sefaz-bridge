# sefaz-bridge

Microserviço **Node.js 22 + TypeScript + Fastify** para integração técnica com a **SEFAZ** (SOAP 1.2 + **mTLS**), pensado para a **DigitalOcean App Platform** (stateless, sem volume persistente).

## O que faz

- Upload de **certificado A1 (.pfx)** com validação forte (senha, par certificado/chave, fingerprint SHA-256, CNPJ extraído, bloqueio de expirado com override administrativo opcional).
- **Armazenamento remoto** em **DigitalOcean Spaces** (S3) com **cifrado em repouso** via envelope **AES-256-GCM** (`CERT_ENCRYPTION_KEY`) antes do upload.
- Modo **local** (`STORAGE_DRIVER=local`) apenas para desenvolvimento: arquivos cifrados em disco, **sem senha em texto plano**.
- Chamadas **SOAP 1.2** com timeout, **retry** só para falhas de rede transitórias, classificação de erros (`tls`, `soap`, `parse`, `auth`, `storage`, `internal`).
- Autenticação **Bearer** + opcional **HMAC** com timestamp (anti-replay), **rate limiting**, **CORS** opcional, **`X-Request-Id`**.
- **`GET /health`** com verificação do storage (HTTP **503** se o backend de certificados estiver indisponível).

## Requisitos

- **Node.js 20+** (recomendado **22**).
- **OpenSSL-compatible** runtime (imagem Debian slim no Docker).

## Instalação e execução local

```bash
cp .env.example .env
# Gere CERT_ENCRYPTION_KEY: openssl rand -base64 32
npm install
npm run dev
```

Gerar chave mestra de 32 bytes:

```bash
openssl rand -base64 32
```

## Variáveis de ambiente

### Públicas / operação

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta HTTP. |
| `NODE_ENV` | `production` na imagem Docker; uso típico de minificação/logs. |
| `APP_ENV` | **`production`**, **`staging`** ou **`development`**. Controla exigência de **Spaces** e validação de secrets. |
| `STORAGE_DRIVER` | `local` (dev) ou `spaces` (produção/staging na DO). |
| `CERT_STORAGE_PATH` | Base do storage **local** cifrado (ignorado quando `spaces`). |
| `SPACES_BUCKET`, `SPACES_REGION`, `SPACES_ENDPOINT` | Configuração do bucket Spaces. |
| `SPACES_PREFIX` | Prefixo de chaves por ambiente (ex.: `sefaz-bridge/production/`). |
| `SEFAZ_DISTRIBUICAO_URL` | URL fixa do `.asmx` (senão usa padrão nacional por `tpAmb`). |
| `SEFAZ_HTTP_TIMEOUT_MS` | Timeout HTTP (padrão `90000`). |
| `SEFAZ_HTTP_MAX_RETRIES` | Retries só para rede (padrão `2`). |
| `LOG_LEVEL` | `info`, `debug`, etc. |
| `ALLOW_DEBUG_SOAP` | `true` para permitir log do SOAP completo (combinar com regras abaixo). |
| `DEBUG_SOAP_IN_PROD` | `true` + `ALLOW_DEBUG_SOAP` para permitir SOAP completo com `NODE_ENV=production`. |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW` | Limite global. |
| `RATE_LIMIT_CERT_MAX`, `RATE_LIMIT_CERT_WINDOW` | Limite no upload de certificado. |
| `CORS_ORIGINS` | Lista separada por vírgula; vazio = sem CORS (recomendado server-to-server). |
| `BRIDGE_HMAC_MAX_SKEW_SEC` | Janela do relógio para HMAC (padrão `300`). |

### Secrets (nunca commitar)

| Variável | Descrição |
|----------|-----------|
| `SEFAZ_BRIDGE_SECRET` | Bearer interno. Obrigatório forte quando `APP_ENV` é `production` ou `staging`. |
| `CERT_ENCRYPTION_KEY` | 32 bytes (**hex 64 chars** ou **base64**). Cifra PFX e senha antes do Spaces/disco. |
| `SPACES_KEY`, `SPACES_SECRET` | Credenciais Spaces. |
| `BRIDGE_HMAC_SECRET` | Se definido, exige `X-Bridge-Timestamp` + `X-Bridge-Signature` nas rotas protegidas. |
| `ADMIN_CERT_OVERRIDE_SECRET` | Se definido, permite header `X-Cert-Override-Token` igual ao segredo para aceitar certificado **expirado** no upload. |

### Desenvolvimento

| Variável | Descrição |
|----------|-----------|
| `CERT_ALLOW_EXPIRED_DEV` | `true` + `NODE_ENV !== production` permite certificado expirado sem override. |

## Autenticação

### Bearer (obrigatório)

```http
Authorization: Bearer <SEFAZ_BRIDGE_SECRET>
```

### HMAC opcional

Se `BRIDGE_HMAC_SECRET` estiver definido, envie também:

```http
X-Bridge-Timestamp: <unix segundos>
X-Bridge-Signature: <hex HMAC-SHA256>
```

Payload canônico:

`v1:<ts>:<METHOD>:<path>:<corpo>`

- `GET`/`HEAD`: corpo = `empty`
- JSON: corpo = SHA-256 hex de `stableStringify` do objeto JSON parseado (mesma ordenação de chaves que o servidor).
- Multipart (upload certificado): corpo fixo = `multipart:company-certificate-upload`

## Endpoints

### `GET /health`

Público. Verifica storage (Spaces `HeadBucket` ou disco local). Resposta inclui `uptime_seconds`, `app_env`, `storage`.

### `POST /api/companies/:companyId/certificate`

Multipart: `certificate`, `password`; opcional `cnpj` (se 14 dígitos, deve bater com o CNPJ do certificado).

Override de expirado: header `X-Cert-Override-Token` quando `ADMIN_CERT_OVERRIDE_SECRET` está configurado.

### `POST /api/sefaz/distribuicao`

JSON: `companyId`, `cnpj`, `cUF`, `tpAmb`, `ultNSU`.

## Layout de storage

### Spaces (`STORAGE_DRIVER=spaces`)

Objetos por empresa sob `${SPACES_PREFIX}companies/<id>/`:

- `material.blob` — senha cifrada + PFX cifrado (formato interno).
- `meta.json` — metadados (subject, issuer, validade, fingerprint, CNPJ do cert, etc.). **Sem segredos em claro.**

Rotação: no novo upload, objetos anteriores da empresa são removidos antes de gravar.

### Local (`STORAGE_DRIVER=local`)

`company-<id>/certificate.pfx.enc` (conteúdo combinado cifrado) + `meta.json`. Somente para **desenvolvimento**.

## DigitalOcean App Platform

1. Crie um **Space** e chaves de API com acesso ao bucket.
2. Crie a **App** a partir do repositório (Dockerfile) **ou** importe `.do/app.yaml` (ajuste `github.repo`, `region`, bucket e prefixos).
3. Configure **Runtime Environment**:
   - `APP_ENV=production` (ou `staging`)
   - `STORAGE_DRIVER=spaces`
   - Secrets: `SEFAZ_BRIDGE_SECRET`, `CERT_ENCRYPTION_KEY`, `SPACES_KEY`, `SPACES_SECRET`
   - Variáveis públicas: bucket, region, endpoint, `SPACES_PREFIX`, URLs SEFAZ, limites.
4. Health check HTTP: **`/health`** (a app spec de exemplo já define `health_check.http_path`).
5. **Não** dependa de volume persistente: certificados vivem no **Spaces** cifrados.

## Deploy automático (GitHub Actions)

Configure no repositório:

- **Secret:** `DIGITALOCEAN_ACCESS_TOKEN`
- **Variable:** `DO_APP_ID` — ID numérico da app (painel DO → URL ou API).

Workflows:

| Arquivo | Comportamento |
|---------|----------------|
| `.github/workflows/deploy-do.yml` | Push em `main` → `POST /v2/apps/{app}/deployments` (redeploy; código vem do GitHub ligado à app). |
| `.github/workflows/deploy-staging-do.yml` | Push em `develop` → mesmo padrão, usando `DO_APP_ID_STAGING` (se vazio, **skip**). |
| `.github/workflows/deploy-app-spec.yml` | Alterações em `.do/**` ou disparo manual → `doctl apps update --spec` (spec versionado). |

Use **ou** redeploy simples **ou** atualização por spec conforme seu fluxo; evite duplicar lógica conflitante na mesma pipeline sem necessidade.

## Docker

```bash
docker build -t sefaz-bridge:local .
docker run --rm -p 3000:3000 \
  -e APP_ENV=development \
  -e STORAGE_DRIVER=local \
  -e CERT_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -e SEFAZ_BRIDGE_SECRET="dev-secret" \
  sefaz-bridge:local
```

Na **App Platform**, defina `APP_ENV` e `STORAGE_DRIVER=spaces` via env da app (não só `NODE_ENV`).

## Segurança e logs

- Não são logados: senha do certificado, PEM completo, corpo SOAP em produção **salvo** `ALLOW_DEBUG_SOAP` / `DEBUG_SOAP_IN_PROD`.
- CNPJ em logs aparece **mascarado** quando aplicável.
- Respostas de erro expõem `category` para diagnóstico (`tls`, `soap`, `parse`, `auth`, `storage`, `internal`).

## Estrutura relevante

- `src/services/storage/` — `IStorageService`, `LocalStorageService`, `SpacesStorageService`, fábrica.
- `src/utils/crypto-envelope.ts` — AES-256-GCM.
- `src/utils/bridge-guard.ts` — Bearer + HMAC opcional.
- `src/config/bootstrap.ts` — validação de ambiente na subida.

## Cloudflare

Crie um **CNAME** para o hostname da App Platform (ou domínio customizado configurado na DO). Para consumo **somente server-to-server**, prefira não expor publicamente ou restrinja por IP / Zero Trust, conforme sua arquitetura.

## Scripts

| Script | Descrição |
|--------|-----------|
| `npm run dev` | `tsx watch`. |
| `npm run build` | Compila para `dist/`. |
| `npm start` | Produção. |
| `npm run typecheck` | `tsc --noEmit`. |
