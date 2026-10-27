# SENTINEL 3D — Arquitetura (Fase 1)

> Estado: **MVP demonstrativo**. Telemetria 100% simulada, planta fictícia, nenhum equipamento físico conectado.
> Não está pronto para produção: falta homologação, IdP corporativo, persistência gerenciada e testes de carga.

## 1. Requisitos

### Funcionais (MVP implementado)
| ID | Requisito | Onde |
|---|---|---|
| RF01 | Agência 3D navegável (aérea, primeira pessoa com colisão, transparente, planta 2D) | `public/js/twin/` |
| RF02 | Objeto 3D selecionável ↔ registro de inventário ↔ telemetria ↔ eventos ↔ incidentes (mesmo `deviceId`) | `src/domain/twin.mjs` |
| RF03 | Estado por regras documentadas, com motivo rastreável | `src/engine/rules.mjs` |
| RF04 | Correlação por grafo de dependências e supressão de duplicatas | `src/engine/correlation.mjs` |
| RF05 | Diagnóstico explicável: fatos, hipótese, confiança por critérios, recomendações, incertezas | `src/engine/diagnostics.mjs` |
| RF06 | Incidentes: criação, agrupamento, reconhecimento, normalização, resolução com evidência, escalonamento | `src/engine/incidents.mjs` |
| RF07 | Simulador com cenários A–H acionáveis e encerráveis pela interface | `src/engine/simulator.mjs` |
| RF12 | Planta e inventário conforme o "Mapa de Ativos · Visão Conceitual" (ambientes 01–08, contagens por grupo) | `src/domain/twin.mjs` (`ASSET_GROUPS`, `MONITOR_DOMAINS`) |
| RF13 | Painel "Mapa de ativos" ao vivo (status, monitoramento geral, ambientes, ativos, desempenho) e camada 3D "Desempenho" | `public/js/panel.mjs`, `twin/scene.mjs` |
| RF08 | Dashboard com KPIs, gráficos filtráveis (período, categoria, agência, criticidade), linha do tempo | `public/js/views.mjs` |
| RF09 | Assistente operacional com ferramentas tipadas e escopo do perfil | `src/engine/assistant.mjs` |
| RF10 | RBAC, áreas restritas, auditoria, retenção configurável | `src/security/auth.mjs`, `server.mjs` |
| RF11 | Contrato de ingestão para gateway real (somente leitura) | `POST /api/ingest` |

### Não funcionais
| ID | Meta | Situação |
|---|---|---|
| RNF01 | ≥ 30 FPS em desktop de teste definido | **Não medido em GPU real.** O contêiner de desenvolvimento só tem renderização por software (SwiftShader, 1–5 FPS). A interface exibe o FPS **medido** no navegador do operador. |
| RNF02 | Estado visual atualizado em poucos segundos após a ingestão | Ciclo de 1 s + SSE limitado a ~1 atualização/s por cliente. Detecção de perda de comunicação: 3 intervalos de coleta (6–9 s). |
| RNF03 | Funcionar sem GPU | Planta 2D automática quando não há WebGL |
| RNF04 | Segurança por padrão | CSP sem `unsafe-inline`, anti-CSRF, cookie HttpOnly/SameSite=Strict, authz no servidor |
| RNF05 | Acessibilidade | Estados com forma + ícone + rótulo; planta 2D navegável por teclado; `prefers-reduced-motion` |

## 2. Componentes

```
 Navegador (operador)                         Servidor Node (server.mjs)
 ┌──────────────────────────┐   HTTPS/SSE    ┌──────────────────────────────────────────┐
 │ main.mjs (estado)        │◄──────────────►│ API REST + SSE + estáticos + headers     │
 │ twin/scene.mjs (Three)   │                │ security/auth.mjs  (RBAC, sanitização)   │
 │ twin/plan2d.mjs (SVG)    │                │ platform.mjs (orquestra o pipeline)      │
 │ panel.mjs / views.mjs    │                │  ├ engine/ingest.mjs     validação       │
 │ charts.mjs               │                │  ├ engine/rules.mjs      nível 1         │
 └──────────────────────────┘                │  ├ engine/analytics.mjs  nível 2         │
                                             │  ├ engine/correlation.mjs grafo          │
 Gateway de integração (futuro) ──Bearer──►  │  ├ engine/diagnostics.mjs nível 3        │
   segmento autorizado, somente leitura      │  ├ engine/incidents.mjs  ciclo de vida   │
                                             │  ├ engine/simulator.mjs  MODO DEMO       │
                                             │  └ infra/store.mjs       JSON/JSONL      │
                                             └──────────────────────────────────────────┘
```

O navegador **nunca** acessa dispositivos. Toda telemetria entra pelo servidor, seja do simulador ou do gateway.

## 3. Stack e decisões (ADR resumido)

| Decisão | Escolha | Por quê | Alternativa descartada |
|---|---|---|---|
| Backend | Node.js 20+ puro (`http`) | Segue o padrão do repositório, sem framework para manter; motor e API no mesmo processo | FastAPI: exigiria segunda runtime sem ganho no MVP |
| Frontend | Módulos ES + Three.js 0.185.1, sem bundler | Sem etapa de build; o 3D é o núcleo e Three.js cobre tudo | React Three Fiber: adicionaria React + build. Reavaliar na Fase 2b se a UI crescer |
| Tempo real | SSE | Unidirecional, reconexão nativa, atravessa proxies | WebSocket: bidirecional desnecessário |
| Persistência | JSON/JSONL local | Rastreável e suficiente para demo | PostgreSQL + TimescaleDB: **alvo de produção** |
| Modelos 3D | Blockout procedural | Sem ativos licenciados disponíveis | GLB do Blender: substituir os construtores mantendo o `deviceId` |
| IA nível 3 | Templates determinísticos | Não inventa fatos; auditável | LLM: previsto e desativado (ver §8) |

Não há microsserviços nem broker: com 54 dispositivos e um processo, eles só adicionariam custo operacional. Gatilho para introduzir broker (MQTT/Kafka): múltiplas agências com ingestão acima de ~1 000 leituras/s ou necessidade de reprocessamento.

## 4. Fluxo de eventos

1. Conector (simulador ou `POST /api/ingest`) entrega a leitura.
2. `validateReading`: dispositivo cadastrado, timestamp na janela (−24 h / +5 min), métricas conhecidas e tipos válidos. Campos desconhecidos são descartados e a qualidade vira `partial`.
3. `detectAnomalies` compara com a linha de base do próprio dispositivo.
4. `computeStates` calcula o estado em ordem topológica do caminho de dados.
5. `correlate` agrupa os sinais (incêndio → energia → cascata → inferida → isolados).
6. `diagnose` produz a explicação estruturada.
7. `IncidentManager.reconcile` faz upsert por chave estável, aplica hold-down, normaliza e escalona.
8. SSE envia o snapshot sanitizado por perfil; o 3D, a planta, os KPIs e a timeline se atualizam.
9. O operador reconhece e resolve o incidente com nota de evidência (auditado).

## 5. Modelo de dados

Entidades lógicas e onde vivem no MVP:

| Entidade | MVP | Produção (PostgreSQL) |
|---|---|---|
| Organização, Agência, Andar, Ambiente | `twin.mjs` (`AGENCIES`, `rooms`, `floors`) | tabelas com FK `org → agency → floor → room` |
| Modelo3D, Posição3D | `pos` no dispositivo; geometria procedural | `model3d(uri, hash)`, `device.position` (x,y,z,floor) |
| Equipamento | `DEVICES` (id persistente) | `device(id PK, type, room_id, serial*, ip*, owner…)` (*cifrado/mascarado) |
| FonteDeTelemetria | `device.source` | `telemetry_source(connector, protocol, credentials_ref)` |
| Leitura | `latest` + `history` (ring 300) | hypertable TimescaleDB `reading(device_id, source_ts, ingest_ts, values jsonb, quality)` |
| Evento | `events.jsonl` | `event` particionada por mês |
| Alerta | motivos (`reasons`) por dispositivo | `alert` (derivável) |
| Incidente, DiagnósticoIA | `incidents.json` | `incident`, `diagnosis(engine, facts jsonb…)` |
| DependênciaEntreAtivos | `DEPENDENCIES` (`kind: conhecida`) | `dependency(from, to, type, kind)` |
| HistóricoDeManutenção | flags + eventos `maintenance.*` | `maintenance(device_id, start, end, by, note)` |
| Usuário, PerfilDeAcesso | sessão demo + `ROLES` | IdP (OIDC/SAML) + mapeamento de grupos |
| RegistroDeAuditoria | `audit.jsonl` | `audit` append-only (WORM) |

Tempo: todos os timestamps em **epoch ms UTC**. A exibição usa o fuso da agência (`America/Sao_Paulo`). Cada leitura carrega `sourceTs` (origem), `ingestTs` (ingestão), idade (`now − ingestTs`) e `quality`.

## 6. Regras de estado (nível 1)

Avaliadas nesta ordem; a primeira que se aplica decide:

1. Manutenção ativa → **Manutenção** (azul).
2. Nunca reportou → **Sem dados confiáveis** (roxo).
3. Telemetria antiga (> 3 × intervalo de coleta):
   - se algum ancestral no **caminho de dados** (`network`, `poe`, `data-path`, `supervision`, `managed-by`) está desconectado ou sem dados → **Sem dados confiáveis** (estado físico indeterminado);
   - senão → **Desconectado** (cinza).
4. Leitura com `quality = bad` → **Sem dados confiáveis**.
5. Limiares do catálogo (`catalog.mjs`): crítico → **Falha crítica** (vermelho); alerta → **Instável** (amarelo).
6. Anomalia estatística sem violação de limiar → **Instável**.
7. Caso contrário → **Operacional** (verde).

Garantias: telemetria antiga **nunca** resulta em "Operacional". Câmera com `videoOk = false` e telemetria recente resulta em **Falha crítica**, mesmo respondendo à rede.

Separação de falhas: física (limiar reportado pelo dispositivo), de comunicação (desconectado / sem dados) e da plataforma (conector inativo, visível em Integrações).

## 7. Correlação e confiança

- Dependências **conhecidas** são cadastradas; relações **inferidas** (irmãos falhando com pai sadio) são rotuladas como inferência e recebem confiança baixa.
- Confiança é **qualitativa** (alta/média/baixa, ou "requer confirmação humana" para incêndio) e sempre acompanhada dos critérios que a sustentam. Não há percentuais.
- **Hold-down:** sinais isolados de perda de comunicação (10 s), porta inativa (10 s), anomalia estatística (10 s), failover (10 s), relações inferidas (8 s) e demais sinais isolados (3 s) precisam persistir antes de virar incidente. Cascata, energia, incêndio e térmico são imediatos. Isso eliminou incidentes transitórios observados em teste (dependente ou porta a montante detectados antes do componente compartilhado). Há teste de regressão para os casos.
- **Promoção de incidente:** quando um grupo correlacionado se forma e a causa raiz (ou um membro) já tinha incidente individual aberto, esse incidente é **promovido** (nova chave, linha do tempo "correlacionado") em vez de abrir outro. Exemplo: climatização degrada primeiro e, segundos depois, a sala aquece; continua um único incidente.
- **Redundância:** arestas `redundant` (dois links WAN) só quebram o caminho de dados se **todos** os pais redundantes caírem. Grupo `failover`: link fora do ar + irmão absorvendo tráfego = um incidente; o surto estatístico no link de backup é tratado como consequência.
- **Térmico:** arestas `cooling` (zona de arrefecimento da climatização) agrupam a climatização fora da faixa com equipamentos/sensores aquecendo.

## 8. IA generativa (nível 3) — guardrails para quando for ativada

- O LLM recebe **apenas** o objeto de diagnóstico estruturado (fatos já coletados), nunca telemetria bruta, vídeo, plantas ou dados de clientes.
- A saída é validada: nenhum ID, número ou fato que não exista na entrada. Se a validação falhar, vale o texto determinístico.
- O assistente continua roteando para ferramentas tipadas; o texto do usuário nunca vira instrução de sistema.
- Ativação condicionada a autorização formal e análise de risco (LGPD, política do banco).

## 9. Segurança

| Ameaça (STRIDE) | Controle implementado | Pendente para produção |
|---|---|---|
| Spoofing | Sessão com cookie HttpOnly/SameSite=Strict; token Bearer separado para gateway | IdP corporativo + MFA; mTLS no gateway |
| Tampering | Validação estrita da ingestão; escrita atômica dos incidentes | Assinatura das leituras na origem |
| Repudiation | Auditoria de sessão, leitura sensível, vídeo, cenários, ack/resolve, negações | Log WORM centralizado (SIEM) |
| Information disclosure | RBAC no servidor; áreas restritas ocultas; IP/serial só com `read:sensitive`; IDs restritos redigidos em textos e eventos; agregados derivados de ativos restritos (energia, banda WAN, nobreaks) ocultos ao observador; 404 para não autorizado | Criptografia em repouso; proteção de plantas por agência |
| DoS | Limite de payload (16 KB / 256 KB ingestão), máximo de 500 leituras por lote, SSE limitado | Rate limit por IP/token; WAF |
| Elevation | Permissões por ação; nenhum comando físico existe na API | Revisão de segurança independente |

Cabeçalhos: CSP (`script-src 'self'` + hash do import map, sem `unsafe-inline`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`. Proteção contra path traversal no servidor estático. O servidor escuta em `127.0.0.1` por padrão; em produção, deve ficar atrás de um proxy TLS (HSTS).

**A plataforma não possui, por projeto, nenhum endpoint de atuação física**: armar/desarmar alarme, abrir cofre, liberar porta ou desligar equipamento.

## 10. Aderência ao mapa conceitual

| Elemento do mapa | Implementação |
|---|---|
| Ambientes 01–08 (numeração, nomes, descrições; 06 em azul) | `ROOMS` com `num`, `desc`, `tech`; rótulos 3D, legenda do painel e planta 2D |
| Disposição: 06 e 07 nos fundos, 01 à esquerda com parede vermelha de ATMs, 04 central, 02/03 à frente, 05/08 à direita via corredor, vestíbulo envidraçado | Planta 36 × 20 m em `twin.mjs` |
| Status Online / Instável / Offline | Painel "Status dos equipamentos" (Offline = falha crítica + desconectado). Os 6 estados da especificação continuam no 3D |
| Monitoramento geral: CFTV, Rede, Energia, Climatização, Incêndio | `MONITOR_DOMAINS` (+ Segurança, Servidores, Autoatendimento) com Normal/Atenção/Falha ao vivo |
| Mapa de ativos com contagens | `ASSET_GROUPS`; teste automatizado garante 12 / 2 / 6 / 2 / 2 / 4 / 3 / 4 / 1 |
| Câmera da Área Restrita vermelha, cofre amarelo | Cenário F reproduz exatamente esse estado |
| Logotipo Santander | Somente com ativo oficial autorizado em `public/brand/logo.png`; sem ele, placa neutra |
| **Câmera dentro dos sanitários** | **Não reproduzida** (LGPD/privacidade): CAM-022 fica no corredor de acesso |

## 11. Critérios de aceitação do MVP

| Critério | Verificação |
|---|---|
| Cenários A–H produzem o estado e o incidente esperados | `test/engine.test.mjs` (automatizado) |
| Inventário igual ao mapa; nenhuma câmera em sanitário; todo ativo dentro do seu ambiente | `test/engine.test.mjs` |
| Todos os cenários acionáveis pela API | `test/api.test.mjs` |
| Sem incidentes duplicados/transitórios no cenário B | teste de regressão (falha sem a correção) |
| Observador não vê ativos, IP/serial ou IDs restritos | `test/api.test.mjs` |
| CSRF, sessão, CSP, ingestão autenticada | `test/api.test.mjs` |
| Interface sem erros de console em todos os modos e menus | Playwright/Chromium (manual, descrito no README) |
| ≥ 30 FPS | **pendente**: medir em desktop com GPU definido |
