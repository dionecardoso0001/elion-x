# Advanced Tech TI · Studio IA

Plataforma de venda de **vídeos e fotos de propaganda produzidos por IA**. O cliente monta o briefing num estúdio interativo, paga online e recebe o material pronto numa página de acompanhamento. A produção é feita pelos **bots Grok** do operador.

```
briefing (estúdio interativo) → orçamento calculado no servidor → pedido + checkout
→ webhook assinado do pagamento → despacho assinado ao bot Grok
→ callbacks assinados (progresso / entrega) → download na página do pedido → ajustes
```

Node.js puro (≥ 20), **zero dependências**, no mesmo padrão do ELION-X.

## Como rodar

```bash
cd studio
cp .env.example .env          # preencha BOT_SHARED_SECRET e ADMIN_TOKEN
npm start                     # http://localhost:3333
npm run bot:exemplo           # (outro terminal) bot de referência em :4444
npm test                      # testes ponta a ponta
```

Com `PAYMENT_PROVIDER=mock`, o checkout é simulado e dá para testar o fluxo inteiro sem cobrança. O servidor **se recusa a iniciar** com `mock` em `NODE_ENV=production`.

| Página | Para quê |
|---|---|
| `/` | Landing + estúdio interativo com preview ao vivo |
| `/pedido.html?id=…#t=…` | Acompanhamento, download e pedido de ajuste |
| `/admin.html` | Painel do operador (token `ADMIN_TOKEN`) |

## Arquitetura

| Arquivo | Responsabilidade |
|---|---|
| `server.mjs` | HTTP, rotas, cabeçalhos de segurança, limitação de taxa, fila de despacho |
| `lib/catalog.mjs` | Pacotes, adicionais e **cálculo de preço** (única fonte de verdade) |
| `lib/validate.mjs` | Validação por lista branca de todo dado de entrada |
| `lib/payments.mjs` | Provedores `mock` e `stripe` (Checkout + verificação do webhook) |
| `lib/grok.mjs` | Despacho aos bots e assistente de roteiro via API xAI |
| `lib/store.mjs` | Persistência em JSON com escrita atômica e fila serializada |
| `lib/crypto.mjs` | Tokens, HMAC, comparação em tempo constante |
| `scripts/bot-exemplo.mjs` | Implementação de referência do contrato dos bots |

**Estados do pedido:** `awaiting_payment → paid → in_production → delivered`, com `revision_requested` (ajuste) e `failed`.

## Contrato dos bots Grok

### 1. A plataforma chama o bot (pedido pago ou ajuste)

`POST` em `GROK_BOT_URL_VIDEO` / `GROK_BOT_URL_PHOTO` / `GROK_BOT_URL`:

```http
Content-Type: application/json
X-Studio-Event: order.paid | order.revision
X-Studio-Timestamp: 1761062400
X-Studio-Signature: sha256=<hex HMAC-SHA256(BOT_SHARED_SECRET, "<timestamp>.<corpo bruto>")>
Idempotency-Key: AT-XXXXXXXX:order.paid:0
```

```json
{
  "event": "order.paid",
  "order": {
    "id": "AT-7K2Q9M4P",
    "package": { "id": "comercial-pro", "name": "Comercial Pro", "kind": "video", "durationSec": 30 },
    "deliverables": { "videos": 1, "images": 2 },
    "addons": ["urgente"], "slaHours": 36, "dueAt": "2026-10-23T04:00:00.000Z",
    "briefing": { "goal": "vender-produto", "style": "divertido", "format": "9:16", "brand": "…", "product": "…",
                  "audience": "…", "message": "…", "cta": "…", "script": "…", "references": ["https://…"] },
    "customerFirstName": "Ana"
  },
  "callbackUrl": "https://seu-dominio/api/bots/callback"
}
```

Em ajustes, o corpo também traz `"revisionNote"`. O bot deve **verificar a assinatura**, responder `2xx` em até 15 s e produzir de forma assíncrona. Sem `2xx`, a plataforma tenta de novo com espera exponencial (30 s → 30 min, 8 tentativas); o painel permite reenviar à mão. O bot **não** recebe e-mail, telefone nem token de acesso do cliente.

### 2. O bot devolve progresso e entrega

`POST {callbackUrl}`, assinado do mesmo jeito:

```json
{ "orderId": "AT-7K2Q9M4P", "status": "in_production", "progress": 60, "message": "Gerando cenas" }
```
```json
{ "orderId": "AT-7K2Q9M4P", "status": "delivered", "message": "Material pronto!",
  "assets": [ { "type": "video", "url": "https://cdn…/final.mp4", "thumbnail": "https://cdn…/capa.jpg", "label": "Vídeo 9:16" },
              { "type": "image", "url": "https://cdn…/foto1.jpg", "label": "Capa 1" } ] }
```
```json
{ "orderId": "AT-7K2Q9M4P", "status": "failed", "message": "Motivo curto" }
```

Regras: só `https`; com `DELIVERY_ALLOWED_HOSTS` definido, só esses hosts; janela de 5 min no timestamp; callback repetido é descartado. Os arquivos ficam no armazenamento do bot (CDN/bucket) — a plataforma guarda só as URLs.

## Segurança — o que está tratado

- **Preço só no servidor**: o total é recalculado a partir dos ids; valor enviado pelo navegador é ignorado. O webhook Stripe confere `amount_total` com o pedido.
- **Pagamento só por webhook assinado** (Stripe `t=…,v1=…`, tolerância de 5 min), nunca pelo redirecionamento do navegador. Idempotente.
- **Acesso ao pedido (BOLA/IDOR)**: token aleatório de 256 bits, guardado só como hash SHA-256, comparado em tempo constante. "Não existe" e "token errado" respondem igual (404). O token viaja no **fragmento** da URL (`#t=`), que não vai para o servidor nem para o `Referer`.
- **Bots**: HMAC-SHA256 nos dois sentidos, anti-replay, `redirect: 'error'` no despacho, validação de URLs entregues (bloqueia `javascript:`, `http:` e credenciais na URL).
- **SSRF**: links de referência do cliente nunca são buscados pelo servidor.
- **XSS**: CSP `script-src 'self'` sem `unsafe-inline`; o frontend só usa `textContent`/atributos, nunca `innerHTML`.
- **Injeção de prompt** no assistente: briefing delimitado como dado, saída tratada como texto puro, sem ferramentas.
- Cabeçalhos: CSP, HSTS (produção), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP.
- Limitação de taxa por IP/rota, limite de corpo, timeouts, bloqueio de path traversal, `PUBLIC_BASE_URL` fixo (nada derivado do cabeçalho `Host`).
- Arquivo de dados gravado com permissão `0600`.

## Riscos remanescentes (decisões conscientes)

| Risco | Mitigação recomendada antes de escalar |
|---|---|
| Persistência em JSON, 1 instância | Migrar `lib/store.mjs` para PostgreSQL (mesma interface) |
| Limitação de taxa em memória | Redis quando houver mais de uma instância |
| Cliente que perde o link do pedido em outro aparelho | Enviar o link por e-mail (SES/Resend) após o pagamento |
| URLs de entrega públicas | Usar URLs assinadas com expiração no bucket |
| Termos de uso/política de privacidade | Redigir com jurídico (LGPD, direitos de imagem, uso de IA em publicidade) |
| Preços do catálogo | São ponto de partida — calibrar pelo custo real de geração por pedido |

## Produção — checklist

1. `NODE_ENV=production`, `PUBLIC_BASE_URL=https://…`, `ADMIN_TOKEN` e `BOT_SHARED_SECRET` com 32+ caracteres (o servidor não sobe sem eles).
2. `PAYMENT_PROVIDER=stripe` + chaves; cadastrar o webhook em `/api/webhooks/stripe` com `checkout.session.completed` e `checkout.session.async_payment_succeeded`.
3. Proxy reverso com TLS (Nginx/Caddy/Cloudflare) e `TRUST_PROXY=1`.
4. `DELIVERY_ALLOWED_HOSTS` com o domínio do seu CDN.
5. Backup do `DATA_FILE`.
