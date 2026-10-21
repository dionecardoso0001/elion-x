# Super Apps e Tecnologia de Fronteira

Índice: 1. O que é um super app de verdade · 2. Arquitetura de referência · 3. Plataformas (PWA, React Native/Expo, desktop) · 4. Tecnologia de fronteira (IA nativa, agentes, RAG, WebGPU, local-first, edge, tempo real, passkeys) · 5. Quando NÃO usar · 6. Roteiro de entrega em fases

"Surreal" para o usuário final significa: instantâneo, funciona offline, entende linguagem natural, antecipa o próximo passo, é bonito e nunca perde dados. Isso vem de engenharia disciplinada combinando as técnicas abaixo — não de uma biblioteca mágica.

## 1. O que é um super app de verdade
Um app hospedeiro com identidade, pagamentos, notificações e mensageria compartilhados, onde **módulos (mini-apps)** de domínios diferentes rodam com contrato estável (ex.: WeChat, Grab, Mercado Pago). Requisitos técnicos centrais: conta única (SSO), carteira/pagamento, deep links, módulos carregáveis sob demanda, sandbox de permissões por módulo, telemetria por módulo e equipes independentes.

## 2. Arquitetura de referência
```
[Clientes] Web (Next.js PWA) · iOS/Android (Expo) · Desktop (Tauri)
     │  design system único (tokens JSON → CSS/RN)
     ▼
[Edge] CDN + WAF + rate limit + BFF por cliente (GraphQL ou tRPC/REST)
     ▼
[Serviços de plataforma] Identity (OIDC/passkeys) · Payments · Notifications · Feature flags · Search
[Serviços de domínio] mini-app A · mini-app B · … (cada um dono do seu banco)
     ▼
[Dados] PostgreSQL (OLTP) · Redis (cache/filas) · Object storage · Event bus (Kafka/NATS/SQS)
        Vetorial (pgvector) · Data lake/warehouse para analytics
[Observabilidade] OpenTelemetry → traces, métricas, logs · SLOs e alertas
```
Comece **monólito modular** (um deploy, módulos com fronteiras rígidas); extraia serviços só quando escala, time ou compliance exigirem. Microsserviços prematuros são a forma mais cara de errar.

Mini-apps no cliente: no web, rotas carregadas sob demanda (`dynamic import`) ou Module Federation; no mobile, módulos JS com Expo Router e feature flags; atualizações OTA via EAS Update (respeitando as regras das lojas: OTA só para JS/assets, não para mudar a natureza do app).

## 3. Plataformas
- **PWA**: manifest, service worker (Workbox), cache offline estratégico (stale-while-revalidate para dados, cache-first para assets), Web Push (iOS 16.4+ só com o app adicionado à tela inicial), Background Sync onde suportado.
- **React Native + Expo** (padrão para mobile cross-platform): Expo Router, Reanimated 3 + Gesture Handler para animações a 60/120 fps na UI thread, `expo-secure-store` para tokens, `expo-local-authentication` para biometria, EAS Build/Submit. Nova arquitetura (Fabric/TurboModules) habilitada por padrão nas versões recentes — confira o SDK atual.
- **Desktop**: Tauri (Rust, binário pequeno, superfície de ataque menor) ou Electron (ecossistema maior; exige `contextIsolation`, `sandbox`, sem `nodeIntegration`).

## 4. Tecnologia de fronteira

### 4.1 IA nativa no produto
- **LLM via API** com streaming (SSE) para resposta imediata; tool use/function calling para o modelo executar ações reais do app (com confirmação do usuário em ações destrutivas ou financeiras).
- Use os modelos mais recentes e capazes disponíveis; consulte a documentação do provedor para IDs e preços atuais antes de codar.
- **RAG**: ingestão → chunking semântico → embeddings → pgvector/Qdrant → recuperação híbrida (BM25 + vetor) → reranking → resposta com citações. Avalie com conjunto de perguntas de referência (precisão das citações, taxa de "não sei").
- **Agentes**: loop planejar → agir (ferramentas) → observar, com limites de passos, orçamento de custo, logs de cada chamada e humano no circuito para efeitos irreversíveis.
- **Segurança de IA** (OWASP Top 10 for LLM Applications): prompt injection direta e indireta (conteúdo recuperado é dado, não instrução), vazamento de dados no contexto, saída do modelo tratada como entrada não confiável (nunca `eval`, sempre sanitizar HTML), permissões mínimas para ferramentas, rate limit e teto de gasto por usuário.
- **IA no dispositivo**: WebGPU + ONNX Runtime Web / Transformers.js para inferência local (privacidade, latência zero, offline); Core ML / ML Kit no mobile.

### 4.2 WebGPU
Computação e renderização de próxima geração no navegador (Chrome/Edge desde 2023, Safari e Firefox com suporte em evolução — verifique caniuse no momento). Three.js tem `WebGPURenderer` com fallback para WebGL2. Use para partículas massivas, simulações, inferência de ML. Sempre forneça fallback.

### 4.3 Local-first e sincronização
Dados no dispositivo primeiro, sincronização em segundo plano, colaboração sem conflitos: CRDTs (Yjs, Automerge) ou motores de sync (ElectricSQL, PowerSync, Replicache/Zero). Resultado: UI instantânea, offline real, colaboração multiusuário estilo Figma/Linear. Custo: modelagem de conflitos e autorização no servidor de sync.

### 4.4 Tempo real
WebSocket (bidirecional), SSE (servidor→cliente, simples, ótimo para streaming de IA), WebRTC (áudio/vídeo/P2P, com TURN para NAT). Escala horizontal via Redis pub/sub ou NATS. Presença, cursores ao vivo, notificações.

### 4.5 Edge e serverless
Funções na borda (Cloudflare Workers, Vercel Edge) para autenticação de borda, A/B, personalização e cache — latência baixa global. Limites: runtime restrito, conexões a banco exigem pooling/HTTP drivers. Banco distribuído (Turso/libSQL, Neon, D1) quando leitura global importa.

### 4.6 Identidade moderna
**Passkeys (WebAuthn/FIDO2)**: login sem senha resistente a phishing. OIDC/OAuth 2.1 com PKCE para apps; tokens curtos + refresh rotativo; sessões revogáveis; MFA por risco.

### 4.7 UX "mágica"
Optimistic UI (atualiza antes do servidor, reverte em erro), prefetch de rotas prováveis, skeletons com forma real, View Transitions entre telas, haptics no mobile, busca instantânea (Meilisearch/Typesense), comandos por voz e paleta de comandos (⌘K).

## 5. Quando NÃO usar
- CRDT/local-first para dados financeiros com regras transacionais fortes → use servidor autoritativo.
- Agentes autônomos onde um fluxo determinístico resolve → fluxo determinístico é mais barato, testável e auditável.
- Microsserviços com time < 10 pessoas → monólito modular.
- WebGPU obrigatório para conteúdo crítico → nunca; sempre fallback.

## 6. Roteiro em fases (realista)
1. **Fundação (2–4 semanas)**: design system, auth, shell do app, CI/CD, observabilidade, 1 mini-app.
2. **MVP (4–8 semanas)**: 2–3 mini-apps, pagamentos, notificações, analytics de produto.
3. **Diferenciação**: IA nativa, offline/local-first, tempo real.
4. **Escala**: extração de serviços, multi-região, SLOs, pentest externo, programa de bug bounty.
Prazos são ordens de grandeza para um time pequeno sênior; recalibre com escopo real.
