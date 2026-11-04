# Alerta ao responsável — WhatsApp e e-mail

Quando a **checagem de saúde** do modo motorista conclui que o motorista precisa de ajuda (ele pediu, relatou sintoma ou **não respondeu**), a plataforma avisa o responsável por WhatsApp e por e-mail, com o link da localização.

A página publicada no GitHub Pages é estática e pública. Nenhuma senha pode ficar nela. Por isso o envio passa por um **relé**, que guarda as credenciais e os destinatários:

```
aparelho do motorista ──(alerta + token do aparelho)──▶ RELÉ ──▶ WhatsApp Cloud API (Meta)
                                                              └─▶ e-mail (Resend ou Gmail API)
```

O relé tem duas formas de rodar, com o mesmo código (`notificacao.mjs`):

| Onde | Para quem | Custo |
|---|---|---|
| **Cloudflare Worker** (`rele/`) | uso com o GitHub Pages; funciona 24 h sem PC ligado | plano gratuito do Workers |
| **Servidor próprio** (`npm start`, rota `/api/spy/alerta`) | quem já roda o servidor num PC ou VPS | o do servidor |

**Segurança:**
- Os **destinatários ficam no relé**. O aparelho não escolhe para quem vai, então ninguém usa o relé para mandar mensagem a terceiros.
- Cada aparelho tem o **próprio token** (mínimo de 16 caracteres).
- Há **limite de alertas** por aparelho a cada 10 minutos.
- O relé aceita só as origens configuradas (CORS).
- O link do mapa é montado no próprio relé.

---

## 1. WhatsApp — API oficial da Meta

Mensagem iniciada pela empresa (o alerta) só sai por **modelo de mensagem aprovado** pela Meta. Texto livre só vale dentro da janela de 24 h depois que o destinatário escreve primeiro.

1. Em **developers.facebook.com**, crie um app do tipo empresa e adicione o produto **WhatsApp**.
2. Na tela de configuração da API, anote o **ID do número de telefone** (`WHATSAPP_PHONE_ID`).
   - O número de teste da Meta envia só para destinatários cadastrados ali, num limite pequeno.
   - Para produção, registre um número próprio.
3. Cadastre o número do responsável como destinatário de teste, com o código do país: `5511999998888`.
4. No **WhatsApp Manager**, crie um modelo de mensagem:
   - nome `alerta_saude_motorista`;
   - categoria **Utilidade (Utility)**;
   - idioma **Português (BR)**, código `pt_BR`;
   - corpo com **5 variáveis, nesta ordem**:

   ```text
   🚨 Alerta de saúde do Sentinela Spy. Motorista: {{1}}. Veículo: {{2}}. Situação: {{3}}. Local: {{4}}. Horário: {{5}}. Triagem automática, não é diagnóstico. Em emergência, ligue 192.
   ```

   Aguarde a aprovação. Sem modelo aprovado, a Meta recusa o envio, e o teste do alerta mostra o erro dela.
5. **Token:** o token temporário da tela de configuração **expira em 24 h**. Para uso contínuo, gere o token de um **usuário do sistema** no Gerenciador de Negócios, com a permissão `whatsapp_business_messaging`. Esse é o `WHATSAPP_TOKEN`.

## 2. E-mail — escolha um

**Opção A — Resend** (precisa de domínio próprio)
1. Crie a conta em resend.com e verifique o seu domínio (registros DNS).
2. Crie uma chave de API, que será o `RESEND_API_KEY`.
3. Defina `EMAIL_REMETENTE="Sentinela Spy <alertas@seudominio.com.br>"`.

**Opção B — Gmail API** (sem domínio: envia da sua conta Gmail)
1. No Google Cloud Console, crie um projeto e ative a **Gmail API**.
2. Na **tela de consentimento OAuth**, publique o app em **produção**. Em modo "Testing", o Google faz a autorização expirar em **7 dias**.
3. Crie um cliente OAuth do tipo "Aplicativo da Web", com o URI de redirecionamento `https://developers.google.com/oauthplayground`.
4. No **OAuth 2.0 Playground**:
   - Marque "Use your own OAuth credentials" e informe o ID e o segredo do cliente.
   - Autorize o escopo `https://www.googleapis.com/auth/gmail.send`.
   - Troque o código e copie o **refresh token**.
5. Variáveis: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. Trocar a senha do Google revoga essa autorização; se acontecer, refaça o passo 4.

Em ambas as opções, `EMAIL_DESTINOS` é o e-mail do responsável. Para mais de um, separe por vírgula.

## 3. Relé no Cloudflare Workers

Gere um token por aparelho:

```bash
node -e "console.log('carro1:' + require('crypto').randomBytes(24).toString('hex'))"
```

Implante. Na pasta `sentinela-spy/rele`, rode cada comando por vez:

```bash
npx wrangler login
```

```bash
npx wrangler secret put RELE_TOKENS
```

```bash
npx wrangler secret put WHATSAPP_TOKEN
```

```bash
npx wrangler secret put RESEND_API_KEY
```

```bash
npx wrangler deploy
```

Preencha em `rele/wrangler.toml`, ou como `secret`:
- `WHATSAPP_PHONE_ID`
- `WHATSAPP_TEMPLATE`
- `WHATSAPP_DESTINOS`
- `EMAIL_DESTINOS`
- `EMAIL_REMETENTE`

`RELE_ORIGENS` já vem com o endereço do seu GitHub Pages.

O endereço do relé fica `https://sentinela-spy-rele.<sua-conta>.workers.dev/alerta`.

## 4. Liberar o relé na página publicada

A página só conversa com endereços que a sua política de segurança (CSP) permite. No GitHub:
1. Abra **Settings → Secrets and variables → Actions → Variables → New repository variable**.
2. Crie `SPY_RELE_URL` com o endereço do relé, terminando em `/alerta`.
3. Publique de novo: em **Actions**, abra "Publicar Sentinela Spy no GitHub Pages" e clique em **Run workflow**.

## 5. No aparelho

Missão **MOTORISTA** → painel **CHECAGEM DE SAÚDE**:
1. **⚙ RESPONSÁVEL E RELÉ**: informe o nome do motorista, o veículo e o **token deste aparelho**.
   - O endereço vem da publicação.
   - Em servidor próprio, deixe o endereço em branco.
2. **🎙 LIBERAR MICROFONE**: faça isso antes de dirigir, para o navegador não pedir permissão no meio de uma emergência.
3. **◎ TESTAR ALERTA**: o responsável deve receber uma mensagem **TESTE** por cada canal. A tela mostra o resultado de cada um.

## Servidor próprio (em vez do Worker)

Coloque as mesmas variáveis no `.env` ao lado do `server.mjs` e rode `npm start`. O console mostra `alerta  relé ativo → WhatsApp + e-mail`. No aparelho, informe só o token.

## Limites — leia antes de usar com motoristas reais

- **É triagem, não diagnóstico.** Os gatilhos (mão no peito, mão nos olhos por mais de 3 s, cabeça tombada, rosto fora de visão) também acontecem sem doença. A conversa por voz serve para filtrar isso. O silêncio escala porque desmaio e AVC não respondem.
- **O reconhecimento de fala é do navegador.**
  - No Chrome ele costuma usar os servidores do Google, e o áudio sai do aparelho só durante a pergunta.
  - O Firefox não tem reconhecimento de fala. Nele, a checagem funciona apenas com os botões.
- **Sem internet, o alerta fica na fila** e sai quando a conexão voltar. **192 (SAMU) continua sendo o caminho de emergência.**
- **LGPD:** o alerta é dado de saúde (dado pessoal sensível, art. 5º, II).
  - A base é a proteção da vida (art. 11, II, "e").
  - Envie o mínimo: não vai foto.
  - Em uso corporativo, informe os motoristas por escrito e registre o tratamento no RIPD (relatório de impacto).
