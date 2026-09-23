# ELION-X

**Central de comando por inteligência artificial — classe JARVIS.**
Plataforma web que conversa por voz e texto, enxerga pelas câmeras, reconhece pessoas
pelo rosto e pela voz, opera o WhatsApp, investiga fontes primárias oficiais e vigia
continuamente temas de interesse — tudo executando **localmente**, na máquina do operador.

<sub>Advanced Tech TI · Arquiteto e operador: Dione Cardoso</sub>

---

| | |
|---|---|
| **49** capacidades | **37** rotas de API |
| **39** serviços externos | **~22k** linhas de código |
| **3** dependências npm | **0** frameworks |

---

## 📚 Manual de engenharia

A documentação completa de **como o ELION-X foi construído** — cada elemento, cada
decisão e o defeito real que motivou cada uma delas.

| Documento | O que você aprende |
|---|---|
| **[Como foi construído](docs/COMO-FOI-CONSTRUIDO.md)** | O passo a passo para erguer uma plataforma dessas do zero, na ordem em que faz sentido construir — com os erros que custaram caro |
| **[Arquitetura](docs/ARQUITETURA.md)** | O desenho de ponta a ponta: laço agêntico, streaming SSE, os dois caminhos de execução, contingência de provedor |
| **[Ferramentas](docs/FERRAMENTAS.md)** | As 49 capacidades e a receita das cinco camadas para criar a sua |
| **[Voz e audição](docs/VOZ-E-AUDICAO.md)** | O subsistema mais difícil: detector de voz, palavra de ativação, quem está falando, e o modo full-duplex |
| **[Engenharia de prompts](docs/ENGENHARIA-DE-PROMPTS.md)** | O prompt montado por composição a cada mensagem, e a defesa contra injeção |
| **[Integrações e chaves](docs/INTEGRACOES-E-CHAVES.md)** | Cada serviço externo, onde obter cada chave, e a defesa contra SSRF |
| **[Operação](docs/OPERACAO.md)** | Como usar no dia a dia: o que pedir, os quadrantes, o terminal Cyber, o celular |

> Os documentos citam **código real com caminho e linha**. Nenhum valor de chave,
> segredo ou dado pessoal aparece em lugar nenhum deles.

---

## Índice

- [Manual de engenharia](#-manual-de-engenharia)
- [Como rodar](#como-rodar)
- [Arquitetura](#arquitetura)
- [Mapa de arquivos](#mapa-de-arquivos)
- [As 49 capacidades](#as-49-capacidades)
- [Base de conhecimento (prompts)](#base-de-conhecimento-prompts)
- [Integrações](#integrações)
- [Configuração](#configuração)
- [Segurança](#segurança)
- [Como estender](#como-estender)

---

## Como rodar

```bash
git clone https://github.com/dionecardoso0001/elion-x.git
cd elion-x
npm install

cp .env.example .env      # e preencha ANTHROPIC_API_KEY

node server.js            # → http://localhost:3001
```

Abra no **Chrome ou Edge** — o reconhecimento de voz do navegador só existe neles.
Clique em **INICIAR SISTEMA** e permita microfone, câmera e localização.

Diagnóstico: `GET /api/status`

---

## Arquitetura

O servidor mantém uma conversa contínua com o modelo. Quando o modelo decide usar uma
ferramenta, o servidor a executa (ou delega ao navegador), devolve o resultado e o ciclo
recomeça — até **seis voltas** por mensagem.

```
Fala ou texto
     ↓
Contexto montado    ← memória · agenda · GPS · documento · vigilância · biometria
     ↓
Claude (streaming)
     ↓
Precisa de ferramenta? ──sim──→ Executa ──┐
     │                                     │
     não                                   └──↺ até 6 voltas
     ↓
Resposta falada + exibida
```

### Dois caminhos de execução

| Modo | Quem executa | Consequência |
|---|---|---|
| **Texto / Conversa** | Servidor (Node.js) | Acesso a disco, rede e processos |
| **Ao Vivo** | Navegador | Exige executor próprio + rota HTTP |

> ⚠️ **Armadilha das cinco camadas.** Uma ferramenta nova precisa ser registrada em
> cinco lugares (ver [Como estender](#como-estender)). Faltando o executor do navegador,
> o recurso funciona por texto e parece *"fora do ar"* por voz.

### Contingência de provedor

A plataforma inteira pendurava numa API só. No dia em que a Anthropic devolveu
*"you have reached your specified API usage limits"*, digitar e o microfone morreram
juntos — e só o modo AO VIVO sobreviveu, porque ele fala com a OpenAI.

Agora a conversa **migra e segue**. `fallback.mjs` traduz ferramentas e mensagens entre
os dois formatos; os **8 pontos** que chamam a Anthropic têm cobertura.

```
Claude falha ──→ é erro de PROVEDOR? ──não──→ propaga o erro
     │                   │                    (defeito meu não vira desvio,
     │                  sim                     senão eu mascaro a causa)
     │                   ↓
     └──────────→ segue pela OpenAI + AVISA o operador
```

Duas decisões que valem a pena copiar:

- **O desvio é visível.** Um plano B silencioso faria o operador ver tudo funcionando
  e concluir que a conta está boa — justamente quando não está.
- **Só erro de provedor desvia.** Um defeito de programação que caísse no outro
  provedor reapareceria mascarado, e o sintoma que aponta para a causa se perderia.

---

## Mapa de arquivos

| Arquivo | Linhas | Responsabilidade |
|---|---:|---|
| `server.js` | 5.378 | Núcleo: laço agêntico, 49 ferramentas, 37 rotas, base de conhecimento |
| `assets/voice.js` | 2.150 | Voz: síntese, escuta seletiva, modo ao vivo, sincronia labial |
| `assets/cyber.js` | 2.025 | Módulo de Cyber Security — painel e análise defensiva |
| `assets/quadrants.js` | 1.330 | Painéis, monitor virtual, controle de telas por voz |
| `assets/app.css` | 1.243 | Identidade visual holográfica |
| `assets/sphere.js` | 787 | Esfera 3D — shaders, rastros de fumaça, luzes cósmicas |
| `assets/avatar.js` | 773 | Avatar holográfico e movimento labial por formantes |
| `assets/agent.js` | 581 | Cliente do laço agêntico e eventos de interface |
| `intel.mjs` | 530 | Investigação em fontes primárias |
| `assets/cyber.css` | 530 | Estilo do painel de segurança |
| `assets/voiceid.js` | 437 | Biometria vocal — captura, pitch, LTAS, identificação |
| `index.html` | 420 | Estrutura da interface |
| `loteria.mjs` | 417 | Loterias da Caixa — resultados oficiais e simulação |
| `signalx.mjs` | 378 | Espectro de radiofrequência (base da ANATEL) |
| `formatos.mjs` | 372 | LibreOffice, e-mail, EPUB, ZIP, calendário, contatos |
| `wa.mjs` | 361 | Integração WhatsApp |
| `assets/nasa.js` | 360 | Console de varredura do espectro |
| `security.mjs` | 338 | Varredura defensiva de rede, sistema e vizinhança |
| `compreensao.mjs` | 329 | Estrutura, natureza, fatos e sinônimos de um documento |
| `aprendizado.mjs` | 312 | Registro do próprio desempenho e lições do operador |
| `fallback.mjs` | 303 | Contingência de provedor — tradução Anthropic ↔ OpenAI |
| `leitor.mjs` | 285 | Codificação de caracteres, natureza do arquivo, CSV |
| `sitescan.mjs` | 265 | Auditoria de segurança de site (defensiva) |
| `apis.mjs` | 163 | Catálogo de APIs públicas sem chave |
| `video.mjs` | 143 | Geração de vídeo por IA |
| `assets/face.js` | 120 | Reconhecimento facial |
| `docs.mjs` | 114 | Extração de PDF, DOCX, PPTX, XLSX |
| `sw.js` | 100 | Service worker do aplicativo instalável |

### Stack

| Camada | Tecnologia | Decisão |
|---|---|---|
| Servidor | Node.js · `http.createServer` | **Zero framework**. Sem Express, sem build |
| Interface | HTML5 · CSS3 · JS puro | Sem React, sem empacotador |
| 3D | Three.js · WebGL · GLSL | Shaders próprios via `onBeforeCompile` |
| Áudio | Web Audio API | Formantes (lábios) e LTAS (biometria) |
| Transmissão | Server-Sent Events | Resposta palavra a palavra, interrompível |
| Persistência | JSON em disco | Sem banco. Estado auditável a olho nu |

**Dependências (3):** `pdf-parse` · `jszip` · `whatsapp-web.js`

---

## As 49 capacidades

<details>
<summary><b>Percepção e identidade</b> (5)</summary>

| Ferramenta | O que faz |
|---|---|
| `analyze_camera` | Visão computacional: conta pessoas, lê emoção facial, descreve vestuário |
| `switch_camera` | Alterna entre webcam integrada e câmera externa |
| `enroll_face` | Memoriza biometricamente o rosto de uma pessoa |
| `enroll_voice` | Cadastra a voz; aceita aproveitar a voz recém-ouvida de um desconhecido |
| `identify_voice` | Diz quem está falando; se for de fora, informa o perfil demográfico |
</details>

<details>
<summary><b>Investigação e vigilância</b> (7)</summary>

| Ferramenta | O que faz |
|---|---|
| `deep_investigate` | Consulta registros oficiais em paralelo (licitações, reguladores, imprensa, pesquisa, diários) |
| `watch_add` | Coloca tema ou empresa sob vigilância contínua |
| `watch_check` | Relata apenas o que é novo desde o último aviso |
| `watch_manage` | Lista ou remove temas monitorados |
| `investigate_news` | Investigação jornalística ao vivo |
| `web_search` | Busca na internet por fatos atuais |
| `get_ai_news` | Manchetes do feed curado de IA e tecnologia |
</details>

<details>
<summary><b>Comunicação</b> (8)</summary>

| Ferramenta | O que faz |
|---|---|
| `wa_list_chats` | Lista conversas recentes do WhatsApp |
| `wa_read_chat` | Lê histórico por nome aproximado |
| `wa_find_contact` | Localiza contato por nome falado ou parcial |
| `wa_send_message` | Envia mensagem em nome do operador |
| `wa_allow` | Gerencia lista de permissão de resposta automática |
| `wa_auto_reply` | Liga/desliga a resposta automática |
| `get_emails` | Lê a caixa de entrada do Gmail (somente leitura) |
| `read_email` | Abre o corpo completo de um e-mail |
</details>

<details>
<summary><b>Conhecimento e decisão</b> (5)</summary>

| Ferramenta | O que faz |
|---|---|
| `read_document` | **Modo DOC** — lê PDF (até digitalizado), Word, Excel, PowerPoint, LibreOffice, EPUB, e-mail `.eml`, calendário, contatos, pacote `.zip`, CSV, imagem de documento e código, em qualquer codificação. Busca com **sinônimos**: perguntar por *multa* encontra *penalidade* |
| `council_review` | Conselho de Decisão: 5 conselheiros + síntese |
| `memory_save` | Grava fato ou preferência na memória permanente |
| `memory_remove` | Apaga item da memória |
| `ia_sem_medo` | Carrega a base do curso IA Sem Medo |
</details>

<details>
<summary><b>Segurança defensiva</b> (2)</summary>

| Ferramenta | O que faz |
|---|---|
| `cyber_scan` | Telemetria da **própria máquina**: postura de defesa (antivírus, firewall por perfil, criptografia de disco), portas em escuta classificadas por risco, conexões externas geolocalizadas, fraquezas de configuração e os aparelhos da rede local |
| `auditar_site` | Auditoria **não invasiva** de um endereço: nota A–F com cabeçalhos ausentes, certificado TLS, cookies frouxos, versão de software exposta e arquivos sensíveis públicos. Só observa o que o servidor já entrega a qualquer visitante — e recusa endereço interno |
</details>

<details>
<summary><b>Autoaperfeiçoamento</b> (2)</summary>

| Ferramenta | O que faz |
|---|---|
| `aprender_licao` | Grava uma correção do operador de forma permanente, com o gatilho que a torna relevante. Sobrevive à conversa e volta no contexto das próximas |
| `revisar_desempenho` | Autoexame: lê o registro do próprio funcionamento — taxa de êxito, onde falha e por quê, o que é lento, e tudo que já lhe ensinaram |

> O ELION **não reescreve o próprio código**. Ele ajusta comportamento a partir de
> evidência do que deu errado. O raio de alcance é deliberado: um agente que se edita
> sem revisão pode se quebrar sozinho às três da manhã, sem ninguém para ver.
</details>

<details>
<summary><b>Mídia e espectro</b> (4)</summary>

| Ferramenta | O que faz |
|---|---|
| `gerar_video` · `consultar_video` | Geração de vídeo por IA — de texto ou de imagem |
| `buscar_api` · `consultar_api` | Catálogo de centenas de APIs públicas sem chave: encontra a fonte e consulta na hora, com defesa contra SSRF |
</details>

<details>
<summary><b>Operação e rotina</b> (16)</summary>

| Ferramenta | O que faz |
|---|---|
| `agenda_add` · `agenda_list` · `agenda_update` · `agenda_remove` | Gestão da agenda |
| `open_screen` · `close_screen` | Abre/fecha qualquer painel por voz |
| `open_website` | Abre site no visor flutuante |
| `youtube_watch` · `monitor_play` | Pesquisa e exibe em monitor virtual |
| `get_weather` | Meteorologia oficial brasileira + GPS |
| `lottery_result` | Resultados oficiais das loterias da Caixa |
| `cyber_scan` | Varredura defensiva com geolocalização de origem |
| `analyze_market` | Gráfico ao vivo com leitura técnica **educativa** |
| `portfolio_add` · `portfolio_view` · `portfolio_remove` | Carteira declarada manualmente |
</details>

---

## Base de conhecimento (prompts)

A personalidade e a competência do ELION-X **não vêm de treinamento próprio**: vêm de uma
base de conhecimento montada dinamicamente a cada mensagem, em `systemPrompt()`
(`server.js`).

### Identidade — o núcleo

> *"Você é ELION-X, a inteligência central de uma plataforma de comando holográfica de
> última geração — um sistema da classe JARVIS."*

### Blocos injetados a cada mensagem

| Bloco | Conteúdo |
|---|---|
| Data e hora | Momento atual em Brasília, por extenso |
| Localização | GPS do computador como **fonte autoritativa** — nunca deduzir da agenda |
| `memBlock` | Últimos 40 fatos da memória permanente |
| `agBlock` | Agenda completa já carregada — dispensa consulta |
| `portfolioBlock` | Carteira de investimentos declarada |
| `docContextBlock` | Documento ativo: nome + prévia (conteúdo vem sob demanda) |
| `watchBlock` | Temas sob vigilância e novidades pendentes |
| Rostos e vozes | Quem a plataforma reconhece biometricamente |

> **Decisão de economia:** o documento ativo entra no contexto só como nome e prévia.
> O conteúdo completo só é carregado quando o agente chama `read_document` — evita
> gastar milhares de tokens em toda mensagem trivial.

### Outros prompts do sistema

| Constante | Papel |
|---|---|
| `LIVE_INSTRUCTIONS` | Instruções do modo AO VIVO (OpenAI Realtime) |
| `VISION_SYSTEM` | Módulo de visão computacional — emula FER e reconhecimento de vestuário |
| `COUNCIL_ADVISORS` | Os 5 métodos de raciocínio do Conselho |
| `IA_SEM_MEDO_KB` | Base de conhecimento do curso |

### Conselho de Decisão (DMAD)

Cinco conselheiros com métodos **deliberadamente distintos**, revisão anônima entre pares
e síntese pela presidência. Um avaliador independente mede a **diversidade real** — se a
convergência veio de métodos distintos ou é concordância teatral.

| Conselheiro | Método |
|---|---|
| **O Contrário** | Falsificação — steelman da posição oposta |
| **O Executor** | Viabilidade — recursos, prazos, primeiro passo |
| **O Estrategista** | Consequência de segunda ordem |
| **O Outsider** | Analogia de outro setor |
| **A Sentinela** | Risco e exposição |

---

## Integrações

<details>
<summary><b>IA e voz</b></summary>

| Serviço | Uso |
|---|---|
| `api.anthropic.com` | Claude — raciocínio, ferramentas, visão de documentos |
| `api.openai.com` | Realtime — modo de voz ao vivo |
| `api.elevenlabs.io` | Voz premium (opcional; padrão é síntese gratuita) |
</details>

<details>
<summary><b>Fontes primárias oficiais</b></summary>

| Serviço | O que antecipa |
|---|---|
| `pncp.gov.br` | Edital publicado semanas antes de virar notícia |
| `efts.sec.gov` | Fato comunicado ao regulador antes do anúncio |
| `api.queridodiario.ok.org.br` | Contrato e decreto municipal na origem |
| `news.google.com` | Imprensa brasileira nacional e regional |
| `api.gdeltproject.org` | Imprensa mundial |
| `export.arxiv.org` | Artigo antecede a tecnologia em 6–18 meses |
| `servicebus2.caixa.gov.br` | Resultados oficiais das loterias |
</details>

<details>
<summary><b>Dados e produtividade</b></summary>

| Serviço | Uso |
|---|---|
| `gmail.googleapis.com` | E-mail (OAuth 2.0, somente leitura) |
| `apiprevmet3.inmet.gov.br` | Meteorologia oficial (INMET) |
| `brasilapi.com.br` | Previsão CPTEC |
| `api.open-meteo.com` | Meteorologia global + geocodificação |
| `nominatim.openstreetmap.org` | Endereço a partir do GPS |
| `query1.finance.yahoo.com` | Cotações |
| `s3.tradingview.com` | Gráficos de ativos |
| `api.tavily.com` | Busca web estruturada |
</details>

> **Princípio:** toda fonte é pública e oficial. A plataforma não acessa sistema sem
> autorização nem consome dado obtido indevidamente. A vantagem vem de **ler a fonte
> primária antes de ela virar pauta** — não de acesso privilegiado.

---

## Configuração

Copie `.env.example` para `.env`. Só a primeira é obrigatória.

| Variável | Finalidade |
|---|---|
| `ANTHROPIC_API_KEY` | Acesso ao Claude — **obrigatória** |
| `OPENAI_API_KEY` | Modo de voz ao vivo **e contingência** quando a Anthropic recusa |
| `TAVILY_API_KEY` | Busca na web |
| `SKYREELS_API_KEY` | Geração de vídeo por IA |
| `OPENAI_FALLBACK_MODEL` · `OPENAI_MODELO_LEVE` | Modelos da contingência (padrões sensatos já embutidos) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | OAuth do Gmail |
| `ELEVENLABS_API_KEY` / `_VOICE_ID` | Voz premium (opcional) |
| `CLAUDE_MODEL` · `LIVE_VOICE` · `EDGE_VOICE` | Modelo e timbres |
| `PORT` · `PUBLIC_URL` · `CHROME_PATH` | Rede e navegador |
| `WA_HEADFUL` · `WA_WEB_VERSION` | Controle da sessão WhatsApp |

### Estado persistente

Onze arquivos JSON em `data/` — `agenda` · `memory` · `faces` · `voices` · `portfolio`
· `watch` · `geo` · `wa-allow` · `wa-log` · `obsidian` · `google-token`.

**Copiar essa pasta é fazer o backup completo da plataforma.**

---

## Segurança

`data/` **nunca** é versionado. Contém:

| Arquivo | Conteúdo sensível |
|---|---|
| `google-token.json` | Token OAuth **ativo** do Gmail |
| `wa-session/` | Sessão do WhatsApp — permite **personificar o operador** |
| `faces.json` · `voices.json` | Biometria facial e vocal da família |
| `memory.json` | Memória pessoal e profissional |
| `watch.json` | Carteira de clientes sob vigilância |

### Princípios permanentes

- Credenciais aparecem por **nome**, jamais por valor
- Cofre de anotações (Obsidian) em modo **somente leitura**
- Resposta automática do WhatsApp exige **lista de permissão explícita** por contato
- Análise de mercado é **educativa** — nunca recomendação de investimento
- Cyber Security é **estritamente defensivo** — nunca ataca, nunca sugere contra-ataque
- Voz só é gravada com **nome declarado** — nunca em segredo

---

## Como estender

### Criar uma ferramenta nova — as cinco camadas

```
1. TOOLS[]                    server.js    → definição e input_schema
2. case 'nome'                server.js    → executor do servidor (execTool)
3. bullet no systemPrompt()   server.js    → o agente precisa saber que existe
4. LIVE_TOOL_NAMES[]          server.js    → liberação para o modo AO VIVO
5. case 'nome'                voice.js     → executor do NAVEGADOR (liveExecTool)
```

**A camada 5 é a mais esquecida.** Sintoma: funciona por texto, falha por voz.

### Verificador automático

```js
const live = fs.readFileSync('server.js','utf8')
  .match(/const LIVE_TOOL_NAMES = \[(.*?)\];/s)[1]
  .match(/'([^']+)'/g).map(s => s.replace(/'/g,''));
const voz = new Set((fs.readFileSync('assets/voice.js','utf8')
  .match(/case '[a-zA-Z_]+'/g) || []).map(s => s.replace(/case '|'/g,'')));
console.log(live.filter(t => !voz.has(t)));   // tem de sair []
```

Se a ferramenta precisar de rota HTTP (modo ao vivo), acrescente em `server.js` e faça o
executor do navegador chamá-la.

---

## Licença

**[MIT](LICENSE)** — © 2026 Dione Cardoso · Advanced Tech TI.

Use, copie, modifique e distribua à vontade, inclusive em projeto comercial. A única
condição é manter o aviso de autoria e a licença junto do código.

O propósito deste repositório é ensinar: se você construir algo a partir dele, o
[manual de engenharia](docs/COMO-FOI-CONSTRUIDO.md) é o melhor ponto de partida.
