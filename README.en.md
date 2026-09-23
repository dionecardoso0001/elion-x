# ELION-X

**English** · [Português](README.md)

<p align="center">
  <img src="docs/media/demo.gif" alt="ELION-X running: the sphere wakes up, speaks its greeting, takes a weather question, calls the weather tool and answers" width="800">
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-00e5ff"></a>
  <img alt="Pure Node.js" src="https://img.shields.io/badge/Node.js-pure%2C%200%20frameworks-3c873a">
  <img alt="49 capabilities" src="https://img.shields.io/badge/capabilities-49-00e5ff">
  <a href="docs/COMO-FOI-CONSTRUIDO.md"><img alt="Engineering manual" src="https://img.shields.io/badge/engineering%20manual-7%20docs-7b61ff"></a>
</p>

> ⭐ **If this project taught you something, leave a star** — it's what helps it reach more people.
>
> *The demo UI is in Portuguese — the platform was built for a Brazilian operator. The code, the prompts and the architecture are what travel.*

**AI command center — JARVIS-class.**
A web platform that talks by voice and text, sees through cameras, recognizes people
by face and voice, operates WhatsApp, investigates official primary sources and keeps
a continuous watch on topics of interest. Everything runs **locally**, on the operator's
own machine.

<sub>Advanced Tech TI · Architect and operator: Dione Cardoso</sub>

---

| | |
|---|---|
| **49** capabilities | **37** API routes |
| **39** external services | **~22k** lines of code |
| **3** npm dependencies | **0** frameworks |

---

## 📚 Engineering manual

The complete documentation of **how ELION-X was built**: every component, every
decision, and the real bug that drove each one. The manual itself is written in Portuguese.

| Document | What you'll learn |
|---|---|
| **[How it was built](docs/COMO-FOI-CONSTRUIDO.md)** | A step-by-step guide to building a platform like this from scratch, in the order that makes sense — including the mistakes that cost the most |
| **[Architecture](docs/ARQUITETURA.md)** | The end-to-end design: agentic loop, SSE streaming, the two execution paths, provider fallback |
| **[Tools](docs/FERRAMENTAS.md)** | The 49 capabilities, and the five-layer recipe for building your own |
| **[Voice and hearing](docs/VOZ-E-AUDICAO.md)** | The hardest subsystem: voice activity detection, wake word, speaker identification, and full-duplex mode |
| **[Prompt engineering](docs/ENGENHARIA-DE-PROMPTS.md)** | The prompt, composed fresh for every message, and the defense against injection |
| **[Integrations and keys](docs/INTEGRACOES-E-CHAVES.md)** | Every external service, where to get each key, and the SSRF defense |
| **[Operations](docs/OPERACAO.md)** | Day-to-day use: what to ask for, the quadrants, the Cyber terminal, the phone |

> The documents cite **real code, with file path and line number**. No key value,
> secret or personal data appears anywhere in them.

---

## Contents

- [Engineering manual](#-engineering-manual)
- [How to run](#how-to-run)
- [Architecture](#architecture)
- [File map](#file-map)
- [The 49 capabilities](#the-49-capabilities)
- [Knowledge base (prompts)](#knowledge-base-prompts)
- [Integrations](#integrations)
- [Configuration](#configuration)
- [Security](#security)
- [How to extend](#how-to-extend)

---

## How to run

```bash
git clone https://github.com/dionecardoso0001/elion-x.git
cd elion-x
npm install

cp .env.example .env      # then fill in ANTHROPIC_API_KEY

node server.js            # → http://localhost:3001
```

Open it in **Chrome or Edge**. Browser speech recognition only exists in those two.
Click **INICIAR SISTEMA** ("start system") and allow microphone, camera and location access.

<p align="center"><img src="docs/media/interface.png" alt="The ELION-X interface: agenda, weather, neural sphere in the center, news, market and vision" width="800"></p>

On first run, copy the profile template — that's where you tell the platform who you are
(the file stays out of git):

```bash
cp operador.exemplo.json data/operador.json
```

Diagnostics: `GET /api/status`

---

## Architecture

The server holds a continuous conversation with the model. When the model decides to use
a tool, the server runs it (or hands it off to the browser), returns the result, and the
cycle starts again — up to **six iterations** per message.

```
Speech or text
     ↓
Context assembled   ← memory · calendar · GPS · document · watchlist · biometrics
     ↓
Claude (streaming)
     ↓
Tool needed? ──yes──→ Execute ──┐
     │                          │
     no                         └──↺ up to 6 iterations
     ↓
Reply spoken + displayed
```

### Two execution paths

| Mode | Who executes | Consequence |
|---|---|---|
| **Text / Conversation** | Server (Node.js) | Access to disk, network and processes |
| **Live** (*Ao Vivo*) | Browser | Needs its own executor + an HTTP route |

> ⚠️ **The five-layer trap.** A new tool has to be registered in five places (see
> [How to extend](#how-to-extend)). Leave out the browser executor and the feature
> works over text but looks *"down"* over voice.

### Provider fallback

The whole platform used to hang off a single API. The day Anthropic returned
*"you have reached your specified API usage limits"*, typing and the microphone died
together. Only LIVE mode survived, because it talks to OpenAI.

Now the conversation **fails over and keeps going**. `fallback.mjs` translates tools and
messages between the two formats. All **8 call sites** that hit Anthropic are covered.

```
Claude fails ──→ PROVIDER error? ──no──→ propagate the error
     │                  │                (a bug of mine never fails over,
     │                 yes                otherwise I'd mask the cause)
     │                  ↓
     └──────────→ continue on OpenAI + WARN the operator
```

Two decisions worth copying:

- **The fallback is visible.** A silent plan B would let the operator see everything
  working and conclude the account is fine — exactly when it isn't.
- **Only provider errors fail over.** A programming bug that slipped through to the other
  provider would resurface in disguise, and the symptom pointing to the cause would be lost.

---

## File map

| File | Lines | Responsibility |
|---|---:|---|
| `server.js` | 5,378 | Core: agentic loop, 49 tools, 37 routes, knowledge base |
| `assets/voice.js` | 2,150 | Voice: synthesis, selective listening, live mode, lip sync |
| `assets/cyber.js` | 2,025 | Cyber Security module — dashboard and defensive analysis |
| `assets/quadrants.js` | 1,330 | Panels, virtual monitor, voice control of screens |
| `assets/app.css` | 1,243 | Holographic visual identity |
| `assets/sphere.js` | 787 | 3D sphere — shaders, smoke trails, cosmic lights |
| `assets/avatar.js` | 773 | Holographic avatar and formant-driven lip movement |
| `assets/agent.js` | 581 | Agentic loop client and UI events |
| `intel.mjs` | 530 | Primary-source investigation |
| `assets/cyber.css` | 530 | Security dashboard styles |
| `assets/voiceid.js` | 437 | Voice biometrics — capture, pitch, LTAS, identification |
| `index.html` | 420 | Interface structure |
| `loteria.mjs` | 417 | Caixa lotteries (Brazil's federal lotteries) — official results and simulation |
| `signalx.mjs` | 378 | Radio-frequency spectrum (ANATEL data — Brazil's telecom regulator) |
| `formatos.mjs` | 372 | LibreOffice, email, EPUB, ZIP, calendar, contacts |
| `wa.mjs` | 361 | WhatsApp integration |
| `assets/nasa.js` | 360 | Spectrum sweep console |
| `security.mjs` | 338 | Defensive scan of network, system and local neighborhood |
| `compreensao.mjs` | 329 | A document's structure, nature, facts and synonyms |
| `aprendizado.mjs` | 312 | Log of its own performance and of lessons from the operator |
| `fallback.mjs` | 303 | Provider fallback — Anthropic ↔ OpenAI translation |
| `leitor.mjs` | 285 | Character encoding, file type detection, CSV |
| `sitescan.mjs` | 265 | Website security audit (defensive) |
| `apis.mjs` | 163 | Catalog of public APIs that need no key |
| `video.mjs` | 143 | AI video generation |
| `assets/face.js` | 120 | Facial recognition |
| `docs.mjs` | 114 | PDF, DOCX, PPTX, XLSX extraction |
| `sw.js` | 100 | Service worker for the installable app |

### Stack

| Layer | Technology | Decision |
|---|---|---|
| Server | Node.js · `http.createServer` | **Zero frameworks**. No Express, no build step |
| Interface | HTML5 · CSS3 · vanilla JS | No React, no bundler |
| 3D | Three.js · WebGL · GLSL | Custom shaders via `onBeforeCompile` |
| Audio | Web Audio API | Formants (lips) and LTAS (biometrics) |
| Streaming | Server-Sent Events | Word-by-word, interruptible responses |
| Persistence | JSON on disk | No database. State you can audit by eye |

**Dependencies (3):** `pdf-parse` · `jszip` · `whatsapp-web.js`

---

## The 49 capabilities

<details>
<summary><b>Perception and identity</b> (5)</summary>

| Tool | What it does |
|---|---|
| `analyze_camera` | Computer vision: counts people, reads facial emotion, describes clothing |
| `switch_camera` | Switches between the built-in webcam and an external camera |
| `enroll_face` | Stores a person's face biometrically |
| `enroll_voice` | Enrolls a voice; can reuse the voice it just heard from an unknown speaker |
| `identify_voice` | Says who is speaking; for an unknown speaker, reports their demographic profile |
</details>

<details>
<summary><b>Investigation and monitoring</b> (7)</summary>

| Tool | What it does |
|---|---|
| `deep_investigate` | Queries official records in parallel (public tenders, regulators, press, research, official gazettes) |
| `watch_add` | Puts a topic or company under continuous watch |
| `watch_check` | Reports only what's new since the last alert |
| `watch_manage` | Lists or removes watched topics |
| `investigate_news` | Live journalistic investigation |
| `web_search` | Searches the web for current facts |
| `get_ai_news` | Headlines from the curated AI and tech feed |
</details>

<details>
<summary><b>Communication</b> (8)</summary>

| Tool | What it does |
|---|---|
| `wa_list_chats` | Lists recent WhatsApp chats |
| `wa_read_chat` | Reads chat history by approximate name |
| `wa_find_contact` | Finds a contact from a spoken or partial name |
| `wa_send_message` | Sends a message on the operator's behalf |
| `wa_allow` | Manages the auto-reply allowlist |
| `wa_auto_reply` | Turns auto-reply on or off |
| `get_emails` | Reads the Gmail inbox (read-only) |
| `read_email` | Opens the full body of an email |
</details>

<details>
<summary><b>Knowledge and decision</b> (5)</summary>

| Tool | What it does |
|---|---|
| `read_document` | **DOC mode** — reads PDF (even scanned), Word, Excel, PowerPoint, LibreOffice, EPUB, `.eml` email, calendar, contacts, `.zip` archives, CSV, document images and code, in any encoding. Searches with **synonyms**: asking about *multa* (fine) also finds *penalidade* (penalty) |
| `council_review` | Decision Council: 5 advisors + synthesis |
| `memory_save` | Saves a fact or preference to permanent memory |
| `memory_remove` | Deletes an item from memory |
| `ia_sem_medo` | Loads the knowledge base of the *IA Sem Medo* ("AI Without Fear") course |
</details>

<details>
<summary><b>Defensive security</b> (2)</summary>

| Tool | What it does |
|---|---|
| `cyber_scan` | Telemetry of **the host machine itself**: defense posture (antivirus, per-profile firewall, disk encryption), listening ports ranked by risk, geolocated outbound connections, configuration weaknesses, and the devices on the local network |
| `auditar_site` | **Non-intrusive** audit of an address: an A–F grade covering missing headers, TLS certificate, loose cookies, exposed software versions and publicly reachable sensitive files. It only looks at what the server already hands to any visitor — and refuses internal addresses |
</details>

<details>
<summary><b>Self-improvement</b> (2)</summary>

| Tool | What it does |
|---|---|
| `aprender_licao` | Permanently records a correction from the operator, together with the trigger that makes it relevant. It outlives the conversation and comes back in the context of future ones |
| `revisar_desempenho` | Self-review: reads the log of its own operation — success rate, where it fails and why, what's slow, and everything it has been taught |

> ELION **does not rewrite its own code**. It adjusts its behavior based on evidence of
> what went wrong. The blast radius is deliberate: an agent that edits itself without
> review can break itself at three in the morning, with no one around to see it.
</details>

<details>
<summary><b>Media and spectrum</b> (4)</summary>

| Tool | What it does |
|---|---|
| `gerar_video` · `consultar_video` | AI video generation — from text or from an image |
| `buscar_api` · `consultar_api` | Catalog of hundreds of public APIs that need no key: finds the right source and queries it on the spot, with SSRF protection |
</details>

<details>
<summary><b>Operations and routine</b> (16)</summary>

| Tool | What it does |
|---|---|
| `agenda_add` · `agenda_list` · `agenda_update` · `agenda_remove` | Calendar management |
| `open_screen` · `close_screen` | Opens or closes any panel by voice |
| `open_website` | Opens a site in the floating viewer |
| `youtube_watch` · `monitor_play` | Searches and plays on the virtual monitor |
| `get_weather` | Official Brazilian weather data + GPS |
| `lottery_result` | Official Caixa lottery results |
| `cyber_scan` | Defensive scan with geolocation of connection origins |
| `analyze_market` | Live chart with an **educational** technical reading |
| `portfolio_add` · `portfolio_view` · `portfolio_remove` | Manually declared portfolio |
</details>

---

## Knowledge base (prompts)

ELION-X's personality and competence **do not come from custom training**. They come
from a knowledge base assembled dynamically for every message, in `systemPrompt()`
(`server.js`).

### Identity — the core

> *"You are ELION-X, the central intelligence of a state-of-the-art holographic command
> platform — a JARVIS-class system."*

<sub>Translated from the original Portuguese system prompt.</sub>

### Blocks injected into every message

| Block | Content |
|---|---|
| Date and time | The current moment in Brasília, written out in full |
| Location | The computer's GPS as the **authoritative source** — never inferred from the calendar |
| `memBlock` | The last 40 facts from permanent memory |
| `agBlock` | The full calendar, already loaded — no lookup needed |
| `portfolioBlock` | The declared investment portfolio |
| `docContextBlock` | Active document: name + preview (the content comes on demand) |
| `watchBlock` | Watched topics and pending updates |
| Faces and voices | Who the platform recognizes biometrically |

> **Cost decision:** the active document enters the context only as a name and a preview.
> The full content is loaded only when the agent calls `read_document`. That avoids
> burning thousands of tokens on every trivial message.

### Other system prompts

| Constant | Role |
|---|---|
| `LIVE_INSTRUCTIONS` | Instructions for LIVE mode (OpenAI Realtime) |
| `VISION_SYSTEM` | Computer vision module — emulates FER (facial expression recognition) and clothing recognition |
| `COUNCIL_ADVISORS` | The Council's 5 reasoning methods |
| `IA_SEM_MEDO_KB` | The course knowledge base |

### Decision Council (DMAD)

Five advisors with **deliberately distinct** methods, anonymous peer review, and a
synthesis by the chair. An independent evaluator measures **real diversity**: did the
convergence come from distinct methods, or is it theatrical agreement?

| Advisor | Method |
|---|---|
| **The Contrarian** (*O Contrário*) | Falsification — steelman the opposing position |
| **The Executor** (*O Executor*) | Feasibility — resources, deadlines, first step |
| **The Strategist** (*O Estrategista*) | Second-order consequences |
| **The Outsider** (*O Outsider*) | Analogy from another industry |
| **The Sentinel** (*A Sentinela*) | Risk and exposure |

---

## Integrations

<details>
<summary><b>AI and voice</b></summary>

| Service | Use |
|---|---|
| `api.anthropic.com` | Claude — reasoning, tools, document vision |
| `api.openai.com` | Realtime — live voice mode |
| `api.elevenlabs.io` | Premium voice (optional; free synthesis by default) |
</details>

<details>
<summary><b>Official primary sources</b></summary>

| Service | What it gets you early |
|---|---|
| `pncp.gov.br` | Public tenders on PNCP (Brazil's national public procurement portal), published weeks before they make the news |
| `efts.sec.gov` | Facts disclosed to the regulator before the public announcement |
| `api.queridodiario.ok.org.br` | Municipal contracts and decrees at the source, via Querido Diário (an open archive of Brazilian municipal official gazettes) |
| `news.google.com` | Brazilian national and regional press |
| `api.gdeltproject.org` | Global press |
| `export.arxiv.org` | Papers precede the technology by 6–18 months |
| `servicebus2.caixa.gov.br` | Official lottery results |
</details>

<details>
<summary><b>Data and productivity</b></summary>

| Service | Use |
|---|---|
| `gmail.googleapis.com` | Email (OAuth 2.0, read-only) |
| `apiprevmet3.inmet.gov.br` | Official weather data from INMET (Brazil's national weather service) |
| `brasilapi.com.br` | CPTEC forecast (Brazil's weather forecasting center) |
| `api.open-meteo.com` | Global weather + geocoding |
| `nominatim.openstreetmap.org` | Address from GPS |
| `query1.finance.yahoo.com` | Market quotes |
| `s3.tradingview.com` | Asset charts |
| `api.tavily.com` | Structured web search |
</details>

> **Principle:** every source is public and official. The platform does not access any
> system without authorization, and it does not consume improperly obtained data. The
> edge comes from **reading the primary source before it becomes a story** — not from
> privileged access.

---

## Configuration

Copy `.env.example` to `.env`. Only the first variable is required.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Access to Claude — **required** |
| `OPENAI_API_KEY` | Live voice mode **and fallback** when Anthropic refuses |
| `TAVILY_API_KEY` | Web search |
| `SKYREELS_API_KEY` | AI video generation |
| `OPENAI_FALLBACK_MODEL` · `OPENAI_MODELO_LEVE` | Fallback models (sensible defaults built in) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Gmail OAuth |
| `ELEVENLABS_API_KEY` / `_VOICE_ID` | Premium voice (optional) |
| `CLAUDE_MODEL` · `LIVE_VOICE` · `EDGE_VOICE` | Model and voices |
| `PORT` · `PUBLIC_URL` · `CHROME_PATH` | Network and browser |
| `WA_HEADFUL` · `WA_WEB_VERSION` | WhatsApp session control |

### Persistent state

Eleven JSON files in `data/` — `agenda` · `memory` · `faces` · `voices` · `portfolio`
· `watch` · `geo` · `wa-allow` · `wa-log` · `obsidian` · `google-token`.

**Copying that folder is a full backup of the platform.**

---

## Security

`data/` is **never** committed. It contains:

| File | Sensitive content |
|---|---|
| `google-token.json` | A **live** Gmail OAuth token |
| `wa-session/` | The WhatsApp session — enough to **impersonate the operator** |
| `faces.json` · `voices.json` | The family's facial and voice biometrics |
| `memory.json` | Personal and professional memory |
| `watch.json` | Client accounts under watch |

### Standing principles

- Credentials appear by **name**, never by value
- The notes vault (Obsidian) is **read-only**
- WhatsApp auto-reply requires an **explicit allowlist**, per contact
- Market analysis is **educational** — never investment advice
- Cyber Security is **strictly defensive** — it never attacks and never suggests a counterattack
- Voice is recorded only under a **declared name** — never covertly

---

## How to extend

### Adding a new tool — the five layers

```
1. TOOLS[]                    server.js    → definition and input_schema
2. case 'name'                server.js    → server executor (execTool)
3. bullet in systemPrompt()   server.js    → the agent has to know it exists
4. LIVE_TOOL_NAMES[]          server.js    → enables it in LIVE mode
5. case 'name'                voice.js     → BROWSER executor (liveExecTool)
```

**Layer 5 is the one people forget.** Symptom: it works over text and fails over voice.

### Automated checker

```js
const live = fs.readFileSync('server.js','utf8')
  .match(/const LIVE_TOOL_NAMES = \[(.*?)\];/s)[1]
  .match(/'([^']+)'/g).map(s => s.replace(/'/g,''));
const voz = new Set((fs.readFileSync('assets/voice.js','utf8')
  .match(/case '[a-zA-Z_]+'/g) || []).map(s => s.replace(/case '|'/g,'')));
console.log(live.filter(t => !voz.has(t)));   // must print []
```

If the tool needs an HTTP route (live mode), add it to `server.js` and have the browser
executor call it.

---

## License

**[MIT](LICENSE)** — © 2026 Dione Cardoso · Advanced Tech TI.

Use, copy, modify and distribute it freely, including in commercial projects. The only
condition is to keep the copyright notice and the license with the code.

This repository exists to teach. If you build something from it, the
[engineering manual](docs/COMO-FOI-CONSTRUIDO.md) (in Portuguese) is the best place to start.
