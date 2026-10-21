# Advanced Tech TI · Studio IA

Plataforma de venda de **vídeos e fotos de propaganda produzidos com IA**. O cliente escolhe o estilo numa galeria explicada, envia o briefing e as fotos do produto, paga por **Pix** e baixa o material pronto na página do pedido. **A produção é sua**, com as suas IAs; a plataforma cuida da venda, do pagamento, da organização e da entrega.

```
galeria de estilos → pacote → briefing + fotos do produto → Pix (QR + copia-e-cola com valor)
→ cliente toca "Já fiz o Pix" → você confere o extrato e confirma no painel
→ produz com suas IAs → envia os arquivos pelo painel → entrega → link pelo WhatsApp → ajustes
```

Node.js puro (≥ 20), **zero dependências de servidor**. Única biblioteca de navegador: `qrcode-generator` 1.4.4 (MIT), servida localmente em `public/vendor/`.

## Como rodar

```bash
cd studio
cp .env.example .env     # preencha PIX_KEY, PIX_NAME, PIX_CITY e ADMIN_TOKEN
npm start                # http://localhost:3333
npm test                 # testes ponta a ponta
```

| Página | Para quem | Para quê |
|---|---|---|
| `/` | Cliente | Galeria de estilos, pacotes e pedido (com envio de fotos) |
| `/pedido.html?id=…#t=…` | Cliente | Pix, fotos, acompanhamento, download e ajustes |
| `/admin.html` | Você | Confirmar Pix, conduzir a produção, enviar arquivos, avisar o cliente |

## Rotina do operador (painel)

1. **Pedido novo** aparece em "Aguardando Pix". Quando o cliente toca "Já fiz o Pix", o pedido vai para **"Precisa de ação"**, com o nome do pagador e o identificador.
2. **Abra o app do banco e confira o crédito.** Só então toque em **Confirmar Pix recebido**. Nunca confirme por comprovante enviado pelo cliente: comprovante falso é a fraude mais comum em Pix manual.
3. **Detalhes → Copiar briefing (para suas IAs)** e baixe as fotos do cliente. Toque em **Iniciar produção** (a mensagem opcional aparece para o cliente).
4. Produza nas suas plataformas de IA. Em **Detalhes**, envie os arquivos prontos (MP4, MOV, WEBM, JPG, PNG, WEBP, ZIP ou PDF, até `MAX_DELIVERY_MB`).
5. **Entregar ao cliente** libera o download e abre a mensagem pronta para o **WhatsApp** com o link do pedido.
6. Se o cliente pedir **ajuste**, o pedido volta para "Precisa de ação" com a nota dele.

Pedidos sem pagamento nem aviso são cancelados após `UNPAID_EXPIRY_HOURS` (padrão 72 h). Com `NOTIFY_WEBHOOK_URL`, você recebe um POST a cada pedido novo, aviso de Pix e pedido de ajuste (para ligar num bot seu de Telegram/WhatsApp).

## Galeria de estilos

Definida em `lib/styles.mjs`: **7 estilos de imagem** (still de estúdio, editorial de luxo, lifestyle, flat lay, pop colorido, futurista/neon, retrato profissional) e **6 de vídeo** (comercial cinematográfico, reels dinâmico, produto 360°/macro, motion graphics, apresentador virtual, estilo UGC). Cada um tem: o que é, para que serve, ideal para quem e o que o cliente precisa enviar. Pacotes com vídeo **e** imagens exigem um estilo de cada. As miniaturas são ilustrações animadas em CSS, sinalizadas como tal, e não trabalhos de clientes: quando tiver trabalhos reais autorizados, substitua por eles.

## Arquitetura

| Arquivo | Responsabilidade |
|---|---|
| `server.mjs` | HTTP, rotas, cabeçalhos de segurança, limitação de taxa, painel, uploads |
| `lib/catalog.mjs` | Pacotes, adicionais e **cálculo de preço** (única fonte de verdade) |
| `lib/styles.mjs` | Galeria de estilos e categorias |
| `lib/validate.mjs` | Validação por lista branca de todo dado de entrada |
| `lib/pix.mjs` | Payload Pix copia-e-cola (BR Code EMV + CRC16, validado contra o exemplo do Banco Central) |
| `lib/payments.mjs` | Provedores `pix` (manual), `stripe` (webhook) e `mock` (desenvolvimento) |
| `lib/files.mjs` | Upload em streaming, tipo pelos bytes, remoção de EXIF, URLs assinadas, Range |
| `lib/store.mjs` | Persistência em JSON com escrita atômica e fila serializada |
| `lib/grok.mjs` | Automação opcional com bots e assistente de roteiro via API xAI |

**Estados do pedido:** `awaiting_payment → payment_reported → paid → in_production → delivered`, com `revision_requested`, `failed` e `canceled`.

## Segurança — o que está tratado

- **Pagamento:** o cliente só *avisa* que pagou; quem marca como pago é você, no painel autenticado. Valor e identificador vêm do servidor e entram no QR, então o cliente não digita valor.
- **Preço só no servidor:** valor enviado pelo navegador é ignorado.
- **Acesso ao pedido (BOLA/IDOR):** token aleatório de 256 bits, guardado só como hash SHA-256, comparado em tempo constante; "não existe" e "token errado" respondem igual. O token viaja no fragmento da URL (`#t=`), que não vai ao servidor nem ao `Referer`. O painel gera um link novo quando precisa reenviar, invalidando o anterior.
- **Uploads:** gravação em streaming com limite rígido; tipo decidido pelos bytes (não pelo nome); nome aleatório no disco; fotos reconvertidas no navegador e com EXIF/GPS removido também no servidor; permissões `0600/0700`; fotos travadas depois que a produção começa.
- **Downloads:** URLs assinadas com HMAC e validade de 1 h; suporte a Range para vídeo no Safari.
- **XSS:** CSP `script-src 'self'` sem `unsafe-inline`; frontend só usa `textContent`/atributos.
- Cabeçalhos (CSP, HSTS em produção, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP), limitação de taxa, timeouts, bloqueio de path traversal, `PUBLIC_BASE_URL` fixo.

## Riscos e limitações (decisões conscientes)

| Risco | O que fazer |
|---|---|
| **Conciliação manual do Pix** não escala bem (passa a pesar com dezenas de pedidos por dia) | Migrar para Pix dinâmico com webhook via um PSP (Mercado Pago, Efí, Asaas). A plataforma já tem a estrutura de provedor para isso |
| **Comprovante falso** | Regra do passo 2 acima: confirme só pelo extrato |
| **Chave Pix exposta** a todos os clientes | Use chave aleatória ou CNPJ, nunca CPF |
| Txid de QR estático **nem sempre aparece** no extrato | O nome do pagador e o horário informados pelo cliente ajudam a localizar |
| Persistência em JSON e arquivos no disco local, 1 instância | Backup diário da pasta `data/`; ao crescer, PostgreSQL + bucket de arquivos |
| Cliente perde o link | Painel → "Link do cliente / WhatsApp" gera um novo |
| Questões legais (CDC art. 37, CONAR, LGPD, direito de imagem) | Termos de uso e política de privacidade revisados por advogado antes de abrir ao público |
| Nota fiscal e tributação das vendas | Ver com seu contador |

## Automação opcional com bots Grok

Se `GROK_BOT_URL` estiver configurado, cada pedido pago é enviado automaticamente ao bot (POST assinado com HMAC-SHA256 em `X-Studio-Signature`, com briefing e links assinados das fotos válidos por 7 dias), e o bot pode responder progresso e entrega em `POST /api/bots/callback`, também assinado. Sem a variável, nada é despachado e a produção é manual. O contrato está em `lib/grok.mjs` e há um bot de referência em `scripts/bot-exemplo.mjs`.

## Produção — checklist

1. `NODE_ENV=production`, `PUBLIC_BASE_URL=https://…`, `ADMIN_TOKEN` com 32+ caracteres (o servidor não sobe sem eles).
2. `PAYMENT_PROVIDER=pix` com `PIX_KEY` (aleatória ou CNPJ), `PIX_NAME` e `PIX_CITY` exatamente como no banco. Faça um Pix de teste de R$ 1 lendo o QR com o app de outro banco.
3. Proxy reverso com TLS (Nginx/Caddy/Cloudflare) e `TRUST_PROXY=1`; aumente o limite de upload do proxy para o seu `MAX_DELIVERY_MB`.
4. Backup da pasta `data/` (pedidos e arquivos).
