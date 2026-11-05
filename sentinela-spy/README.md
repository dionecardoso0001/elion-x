# Sentinela Spy

Plataforma de **visão computacional com agente de IA** que interpreta anomalias. A câmera
do PC ou do celular alimenta detectores que rodam **no próprio aparelho** (alarme em
milissegundos, sem rede). Por cima deles, o **agente Sentinela Spy** (Claude Opus 5.5, pelo
SDK oficial da Anthropic) confirma ou contesta cada evento, correlaciona os incidentes no
tempo e responde às perguntas do operador.

| Missão | O que os detectores veem | O que o agente acrescenta |
|---|---|---|
| **SENTINELA** | intrusão em zona restrita, **local restrito ensinado com fotos**, permanência, **objeto esquecido de qualquer tipo** (não só os do COCO), retirada, queda, corrida, aglomeração, objeto de risco, comportamento atípico, **movimento no escuro** | veredito (anomalia confirmada · provável falso alarme · inconclusivo), evidências, hipóteses alternativas, divergências com o detector, ação recomendada |
| **MOTORISTA** | fadiga (PERCLOS, microssono, bocejo), distração, celular, **mão no peito, mão nos olhos por mais de 3 s**, cabeça tombada | **checagem de saúde por voz** e **aviso ao responsável por WhatsApp e e-mail**, com localização; sinais observáveis, sem diagnóstico |
| **TRÂNSITO** | risco de colisão (TTC), distância, pedestre, objeto na pista, **fauna: cão de qualquer porte, cobra, boi/vaca, galinha, aves, veado (provável), tatu, jabuti, jacaré…** | leitura da cena e da visibilidade |

> ⚠️ Assistente de atenção, **não** é ADAS/DMS homologado nem sistema de segurança
> certificado. Não freia, não substitui o motorista nem a vigilância humana.

---

## Endereço próprio

| Onde | Endereço | Agente |
|---|---|---|
| **GitHub Pages** (HTTPS, funciona no celular) | `https://<seu-usuário>.github.io/sentinela-spy/` | modo **chave própria**: cada operador informa a chave no aparelho |
| **Servidor próprio** (PC, VPS) | `http://localhost:4040` (padrão) | modo **servidor**: a chave fica no `.env`, o navegador nunca a vê |

### Publicar no GitHub Pages (uma vez)

1. O código deste diretório na raiz de um repositório `sentinela-spy`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Cada push na `main` dispara `.github/workflows/pages.yml`: testes, runtime local,
   modelos baixados com SHA-256 conferido, build estático e publicação.

### Rodar no computador

```bash
npm ci
```

```bash
npm run preparar
```

```bash
npm start
```

No Windows: dois cliques em **`Iniciar Sentinela Spy.bat`** (faz os três passos).
Para o modo servidor, copie `.env.example` para `.env` e preencha `ANTHROPIC_API_KEY`.

Depois de abrir, clique **◎ TESTAR AGENTE**: é uma chamada mínima e **real** à API, com
os mesmos recursos das tarefas (modelo, fallback de recusa, saída estruturada). Ela
mostra o modelo que respondeu, a latência, os tokens e o custo, e confirma a chave antes
do primeiro evento de verdade.

**No celular** a câmera exige HTTPS: use o endereço do GitHub Pages. Para expor o
servidor próprio (túnel, VPS), **defina `SPY_TOKEN`**. Sem token, quem alcançar a porta
gasta o seu crédito da API.

---

## Recursos de campo

### Câmeras do computador
Todas as câmeras conectadas aparecem pelo nome no seletor do painel **SENSOR ÓPTICO**: a integrada, uma USB como a MX ou uma câmera virtual. O nome fica sem o código USB que o Chrome acrescenta no Windows. Uma câmera plugada ou removida com a operação em curso entra ou sai da lista sozinha. No PC, o botão vira **⇄ PRÓXIMA CÂMERA**. Se outro programa estiver usando a câmera (Teams, Zoom, OBS, Logi Tune), a tela explica o que fazer.

### Visão no escuro
Com pouca luz (abaixo de 20%), a imagem que vai aos detectores é **clareada automaticamente**, com ganho limitado a 8×, e o HUD mostra **VISÃO NOTURNA**. Um sensor de movimento com **fundo duplo** acusa **MOVIMENTO NO ESCURO** quando nenhuma pessoa, animal ou veículo detectado explica o movimento. Em zona restrita, o alerta é crítico. O limite desse sensor se adapta ao chuvisco da câmera, e uma troca brusca de luz não conta como movimento.

**Limite físico:** câmera comum sem luz nenhuma não enxerga. Escuro total exige câmera com infravermelho.

### Objeto esquecido de qualquer tipo
O mesmo fundo duplo acha **o que mudou na cena e parou**: caixa, jaqueta, ferramenta. Não depende de o objeto estar entre as categorias do detector. O dono é quem passou pelo local nos 10 s anteriores. Se ele se afasta, sai **POSSÍVEL OBJETO ESQUECIDO**. Objeto parado desde o início e sem dono (o notebook que sempre esteve na mesa) é tratado como parte do ambiente, não como abandonado.

### Fauna na pista
Um segundo modelo, o classificador EfficientNet-Lite0, com as 1.000 classes do ImageNet, refina cada animal detectado. "Ave" vira GALINHA/GALO, "vaca" vira BOI/VACA, e 118 raças de cão viram CÃO. Ele também varre trechos do corredor em busca do que o detector não conhece, como COBRA e TATU, exigindo 2 leituras seguidas.

Para cão pequeno e galinha distantes, uma segunda passada do detector olha o trecho distante em resolução maior. O porte decide o nível:
- **Animal grande:** crítico.
- **Animal pequeno:** aviso, com a orientação "reduza, não desvie bruscamente".

**VEADO** não existe no COCO nem no ImageNet: entra como "provável" (antílopes). O caminho certo para veado é o laboratório, com fotos suas.

### Checagem de saúde do motorista → aviso ao responsável
Os gatilhos são mão no peito por 2,5 s, mão nos olhos por mais de 3 s, cabeça tombada ou rosto fora de visão. A plataforma **pergunta por voz** se o motorista está bem e mostra dois botões grandes.

| Resposta | O que acontece |
|---|---|
| "estou bem" | encerra |
| "preciso de ajuda" ou sintoma | **avisa o responsável na hora** |
| **silêncio duas vezes** | **avisa também**, porque desmaio e AVC não respondem |

O aviso sai por **WhatsApp (API oficial da Meta) e e-mail**, com o link da localização, através de um relé que guarda as credenciais e os destinatários.

Depois do aviso, o agente conversa para colher sintomas e orientar segurança (pisca-alerta, parar, 192). Sintomas novos viram atualização ao responsável.

Passo a passo das contas e do relé: **[ALERTAS.md](ALERTAS.md)**.

### Laboratório de modelo
Em **⚗ ABRIR LABORATÓRIO**, você ensina com fotos suas:
- **LOCAL RESTRITO:** quando a câmera vê esse lugar com uma pessoa, dispara intrusão.
- **CLASSE NOVA:** por exemplo, VEADO no trânsito.

**Como funciona:**
- Cada foto vira um vetor de características (MobileNet-V3).
- Fotos **negativas** ("parecido, mas liberado") afinam o reconhecimento.
- O limiar é calibrado por validação, e a tela mostra a qualidade.
- **✖ ÚLTIMO ALARME FOI FALSO** transforma o quadro do alarme em exemplo negativo, com um toque.
- Exporte e importe em JSON para levar a outros aparelhos.
- Tudo fica só neste aparelho.

---

## Arquitetura

```
câmera ─▶ MediaPipe (WASM, no aparelho) ─▶ rastreador multialvo ─▶ regras da missão
        ─▶ gestor de alertas ─▶ sirene · voz · vibração           (milissegundos, sem rede)
        ─▶ registro de incidentes (IndexedDB, neste aparelho)
        ─▶ agente Sentinela Spy ─▶ interpretar · relatório · conversa   (segundos, sob demanda)
```

| Arquivo | Papel |
|---|---|
| `index.html`, `css/spy.css` | console (identidade "sala de interceptação"), acessível, CSP sem script inline |
| `js/nucleo.js` | orquestração: boot, câmera, laço, alertas, incidentes, agente, zonas, calibração |
| `js/spy/cerebro.js` | **cérebro do agente**: prompts, esquemas, ferramentas, leitura de resposta, laço de ferramentas, validação. O mesmo arquivo roda no navegador e no servidor |
| `js/spy/cliente.js` | transporte: modo servidor (`/api/spy/mensagens`) ou chave própria (SDK oficial no navegador) |
| `js/spy/incidentes.js` | registro persistente de incidentes (IndexedDB), exportação JSON |
| `js/percepcao.js` … `js/vigilancia.js` | núcleo de visão (rastreador, analisadores, alertas, HUD, sirene) |
| `js/cameras.js` | lista, nomes e troca de câmeras; erros de câmera traduzidos |
| `js/escuro.js` | monitor de luz, realce, sensor de movimento com fundo duplo |
| `js/fauna.js` | segundo estágio da fauna (ImageNet → categorias), varredura do corredor, segunda passada no trecho distante |
| `js/saude.js`, `js/escuta.js` | checagem de saúde (máquina de estados) e reconhecimento de fala |
| `js/laboratorio.js`, `js/spy/labdb.js` | laboratório de modelo: conceitos, calibração, exportação; armazenamento local |
| `js/spy/alerta.js` | envio ao relé com novas tentativas e fila sem internet |
| `notificacao.mjs`, `rele/` | relé de aviso ao responsável (WhatsApp Cloud API, Resend ou Gmail API, webhook), em Node ou Cloudflare Worker |
| `server.mjs`, `estaticos.mjs` | servidor próprio: lista de permissão, brotli/gzip, ETag, CSP; agente com a chave no servidor |
| `scripts/preparar.mjs` | runtime MediaPipe local, SDK empacotado para o navegador, modelos com SHA-256 |
| `scripts/build.mjs` | `dist/` para hospedagem estática |

### O agente Sentinela Spy

- **Modelo:** `claude-opus-5-5` (SDK `@anthropic-ai/sdk` 0.137.0, versão fixa).
- **Fallback de recusa ligado por padrão:** `fallbacks: "default"` com o beta
  `server-side-fallback-2026-07-01`. Se o classificador de segurança recusar, a própria
  API repete o pedido no modelo recomendado. Uma recusa que sobra (`stop_reason: "refusal"`)
  é tratada antes de qualquer leitura de conteúdo.
- **Três tarefas:**
  - `interpretar`: o evento + 1 quadro + telemetria produzem uma **saída estruturada**
    (JSON Schema) com veredito, risco, evidências, hipóteses, divergências e ação. Roda em
    esforço `low`, para responder em segundos.
  - `relatorio`: correlaciona os incidentes de uma janela (repetição, escalada,
    concentração por zona ou horário).
  - `conversa`: perguntas do operador, com **ferramentas executadas no navegador**:
    `consultar_incidentes`, `estado_atual`, `capturar_quadro`. As chamadas paralelas são
    respondidas numa única mensagem, e o histórico só cresce (nunca editado). Para limpar,
    abra uma nova conversa.
- **Disparo automático:** só em evento **crítico**, no máximo 1 a cada 45 s e 30 por hora.
- **Adaptação a recurso recusado:** se a API recusar um recurso **opcional** nesta
  conta (o fallback de recusa ou o nível de esforço), o agente avisa na tela, repete o
  pedido uma vez sem ele e segue assim. Ferramentas e histórico nunca são alterados: uma
  mudança no meio da conversa invalidaria o pensamento preservado do modelo.
- **Custo:** o painel mostra a estimativa da sessão, calculada pela tabela de preços do
  Opus 5.5 (US$ 4 por milhão de tokens de entrada, US$ 20 de saída e US$ 0,20 de leitura
  de cache). Uma interpretação típica (quadro de 768 px + telemetria + parecer) fica na
  ordem de **centavos de dólar**. É estimativa, não fatura: o valor real está no Console
  da Anthropic.

---

## Segurança e privacidade

| Camada | Medida |
|---|---|
| Câmera | processada no aparelho; um quadro só vai ao agente quando ele interpreta um evento ou você pede, e o envio de imagens pode ser desligado |
| Chave da API (modo servidor) | só no `.env` do servidor. O cliente manda só a tarefa e as mensagens; modelo, prompt e ferramentas são montados no servidor |
| Chave da API (modo chave própria) | fica na sessão da aba (ou neste aparelho, se você pedir) e vai só para `api.anthropic.com` |
| Servidor | escuta em `127.0.0.1` por padrão; `SPY_TOKEN` comparado em tempo constante; limite de 12 consultas/min; corpo ≤ 13 MB; cancela a chamada se a aba fechar |
| Mensagens repassadas | só papéis `user`/`assistant`, blocos conhecidos, imagens JPEG/PNG/WebP pequenas e no máximo 80 mensagens. Mensagem "system" injetada pelo cliente é recusada |
| Página | CSP: script só da própria origem (sem inline), `wasm-unsafe-eval` para o MediaPipe, conexões só para a própria origem, a API da Anthropic e as contingências; `frame-ancestors 'none'`, `nosniff`, `no-referrer` |
| Saída do agente | entra na tela só por `textContent`, porque saída de LLM é dado não confiável |
| Prompt | telemetria, histórico e texto dentro das imagens são marcados como **dado, não instrução** |
| Modelos de visão | SHA-256 fixado e conferido a cada carga, inclusive do cache |
| Estáticos | lista de permissão + caminho real conferido (`realpath`); `:`/`~`/segmento oculto recusados (Windows/NTFS) |
| Indexação | `robots.txt` (`Disallow: /`) + `X-Robots-Tag: noindex` |

**LGPD:** rosto e estado de saúde são **dados pessoais sensíveis** (Lei 13.709/2018,
art. 5º, II; tratamento pelo art. 11). O agente é instruído a não identificar pessoas.
Para uso **corporativo ou em frota**, exija antes: base legal, Relatório de Impacto
(RIPD), aviso aos monitorados e política de retenção.

---

## Calibração com a sua realidade

Painel **CALIBRAÇÃO DE CAMPO**:

1. Escolha o perfil (conservador · padrão · sensível). Pisos de segurança: colisão
   nunca abaixo de 2,6 s; microssono nunca acima de 1,5 s.
2. Grave a sessão e anote cada alerta: **V** correto, **F** falso, **P** perdido,
   **M** marca de teste.
3. Avalie:

```bash
npm run avaliar -- sentinela-campo-motorista-AAAA-MM-DDTHH-MM-SS.jsonl
```

O relatório traz alarmes por hora, precisão e revocação com intervalo de Wilson (95%) e
a latência dos testes dirigidos.

---

## Qualidade — o que foi verificado

- **163 testes automatizados** (`npm test`), entre eles:
  - Câmeras, escuro (quadros sintéticos com ruído de sensor), fauna (os 285 rótulos conferidos contra a lista do próprio modelo), mãos e checagem de saúde, relé (formatos de WhatsApp, Resend e Gmail conferidos na documentação oficial) e laboratório.
  - Núcleo de visão com cenários físicos sintéticos.
  - Cérebro do agente: esquemas dentro das restrições de saída estruturada, laço de
    ferramentas, recusa, fallback e histórico só crescente.
  - Servidor: token, limite de taxa, travessia de caminho, compressão.
  - **Contrato com o SDK oficial real** contra uma API simulada local. Confere os
    cabeçalhos (`x-api-key`, `anthropic-version`, `anthropic-beta`) e o corpo
    (`model`, `fallbacks`, `output_config`).
- **Ponta a ponta no Chromium** com câmera falsa e API simulada:
  - Interpretação automática em evento crítico, chat com 3 ferramentas e relatório.
  - Persistência após recarregar.
  - Modo chave própria com o SDK no navegador (cabeçalho de acesso direto conferido).
  - **TESTAR AGENTE** nos dois modos.
  - Adaptação quando a API recusa o fallback.
  - **Nenhuma violação de CSP**.
- **axe-core 4.14, WCAG 2.2 A/AA:** 0 violações no desktop, no celular (Pixel 7) e com o
  diálogo de configuração aberto. Sem rolagem horizontal.

- **Ponta a ponta no Chromium (novos recursos):**
  - Duas câmeras: listadas pelo nome e trocadas pelo seletor e pelo botão.
  - Vídeo escuro (4% de luz): o modo noturno liga sozinho e dispara MOVIMENTO NO ESCURO.
  - Trânsito: "ANIMAL NA PISTA: CÃO" em crítico e "GATO" em aviso.
  - Checagem de saúde, com fala e reconhecimento simulados e relé interceptado: silêncio, "estou bem", sintoma e botão.
  - Laboratório: 5 fotos → reconhecimento a 95% → intrusão → falso alarme vira negativa → o alarme para.
  - Simulação do GitHub Pages: nenhuma origem externa contatada.
  - axe-core: 0 violações WCAG 2.2 AA nos diálogos novos e no celular.
- **Privacidade verificada:** o MediaPipe tenta enviar telemetria a `odml.pa.googleapis.com`, e a CSP bloqueia esse envio.

**Ainda não verificado:**

- Envio **real** de WhatsApp e e-mail: depende das contas (ver ALERTAS.md).
- Reconhecimento de fala real nos navegadores.
- Cobra e veado em imagem real.
- Câmera infravermelha.

- Chamada **real** à API da Anthropic: depende da sua chave. Os testes usam uma API
  simulada, de propósito, sem custo.
- Fadiga e mal-estar reais, estrada real, celulares reais (Android e iOS Safari) e GPU
  real.
- Taxa de falso alarme em operação contínua. Use a calibração de campo.

---

## Licenças

Código: MIT (`LICENSE`). Terceiros:

- MediaPipe Tasks Vision (Apache-2.0). Modelos EfficientDet-Lite0, EfficientNet-Lite0 (ImageNet), MobileNet-V3, Face e Pose Landmarker, publicados pelo Google.
- `@anthropic-ai/sdk` (MIT, `vendor/anthropic-sdk.LICENSE.txt` após `npm run preparar`).
- Fontes Orbitron, Rajdhani e Share Tech Mono (SIL OFL-1.1, `fontes/LICENSE-*.txt`).
- Modelos de visão do MediaPipe: consulte os *model cards* de cada um.
