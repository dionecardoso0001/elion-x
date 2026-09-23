# Operação — como usar o ELION-X no dia a dia

Este documento é para quem **opera** a plataforma. Se você quer saber como ela foi
construída, vá para [COMO-FOI-CONSTRUIDO.md](COMO-FOI-CONSTRUIDO.md).

---

## Índice

- [Iniciar](#iniciar)
- [Os dois modos de conversa](#os-dois-modos-de-conversa)
- [Como chamar](#como-chamar)
- [O que pedir](#o-que-pedir)
- [Os quadrantes](#os-quadrantes)
- [Modo DOC — documentos](#modo-doc--documentos)
- [Terminal Cyber](#terminal-cyber)
- [No celular](#no-celular)
- [Quando algo falha](#quando-algo-falha)

---

## Iniciar

```bash
node server.js          # → http://localhost:3001
```

No Windows há dois atalhos prontos: **`Iniciar ELION-X.bat`** sobe a plataforma e abre
o navegador; **`ELION-X Mobile.bat`** sobe e publica o endereço para o celular.

Abra em **Chrome ou Edge** — o reconhecimento de voz do navegador só existe neles. Na
tela de abertura, clique em **INICIAR SISTEMA** e permita microfone, câmera e
localização. Esse clique não é enfeite: navegador nenhum deixa tocar áudio sem um
gesto do usuário, e é ali que a plataforma destrava o som.

### Na primeira vez

Copie o modelo de perfil e preencha com os seus dados:

```bash
cp operador.exemplo.json data/operador.json
```

Ali ficam o seu nome, como quer ser chamado e quem o reconhecimento facial e vocal
deve identificar. O diretório `data/` está no `.gitignore` — nada disso vai para o
controle de versão. **Sem esse arquivo a plataforma funciona**; ela apenas trata você
de forma neutra até que você se apresente.

---

## Os dois modos de conversa

| | **Microfone** | **AO VIVO** |
|---|---|---|
| Botão | 🎤 | **AO VIVO** |
| Como funciona | você fala, ele transcreve, pensa e responde | conversa contínua, full-duplex |
| Latência | ~1–3 s para começar a falar | quase imediata |
| Interromper | possível | você fala por cima e ele para |
| Provedor | Claude (Anthropic) | OpenAI Realtime |
| Melhor para | pedido bem definido, análise, documento | conversa de ida e volta, pensar junto |

Os dois têm as **mesmas ferramentas**. A diferença é o ritmo: o microfone é um turno
de cada vez; o AO VIVO é uma conversa.

> Eles usam provedores diferentes. Se um ficar indisponível, o outro continua — e no
> modo texto a plataforma migra sozinha para a OpenAI, avisando você.

---

## Como chamar

Depois de ligar o microfone, existem **quatro portas de entrada**. Você não precisa
decorar fórmula nenhuma.

**1. Pelo nome.** *"Elion, que horas são?"* — inequívoco, entra sempre. O
reconhecimento de voz erra nome próprio raro com frequência, então "Elian", "Ilion" e
"Helion" também funcionam.

**2. A conversa já aberta.** Depois do primeiro chamado, fica uma janela em que as
frases seguintes valem sem repetir o nome. Ninguém conversa dizendo "Elion" em toda
frase.

**3. A sua voz, dirigida a alguém.** *"Vamos trabalhar?"*, *"hora do show"*, *"e aí,
garoto"* são chamados tão claros quanto o nome. A plataforma reconhece a sua voz e
percebe quando a frase é dirigida a alguém.

**4. O desempate.** Na dúvida, ele **aceita** — deixar de responder ao dono é pior que
responder demais.

### Chamar sem pedir nada

Dizer só **"Elion"** é chamar, não pedir. Ele responde na hora com uma frase curta —
*"Pois não, Senhor."*, *"Às ordens."*, *"Diga."* — e espera. Não gasta chamada de API
e nunca repete a mesma resposta duas vezes seguidas.

### Quando ele não escuta bem

**Clique com o botão direito no microfone** (ou toque longo, no celular) para ele se
calibrar ao ruído da sua sala. A calibração só pode deixá-lo *mais* sensível, nunca
menos — foi feita assim de propósito.

Conversa de outras pessoas, TV, latido e barulho de objeto **não** viram comando: há
um detector de voz que separa a sua fala do resto. Veja
[VOZ-E-AUDICAO.md](VOZ-E-AUDICAO.md) se quiser entender como.

---

## O que pedir

Frases que funcionam, por área. Não é uma lista fechada — é conversa, não menu.

### Agenda e memória
| Diga | O que acontece |
|---|---|
| *"O que eu tenho hoje?"* | lê a agenda direto, sem perguntar nada |
| *"Marca reunião quinta às 15h com o cliente"* | grava e o quadrante AGENDA acende |
| *"Lembra que eu prefiro relatórios curtos"* | vai para a memória permanente |

### Documentos
| Diga | O que acontece |
|---|---|
| *"O que esse contrato diz sobre multa?"* | busca no documento inteiro, **com sinônimos** |
| *"Analisa essa proposta"* | parecer executivo: números, riscos, lacunas, recomendação |
| *"Qual o valor total?"* | responde do documento, citando de onde veio |

### Segurança
| Diga | O que acontece |
|---|---|
| *"Audita o site do cliente"* | nota A–F: cabeçalhos, TLS, cookies, arquivos expostos |
| *"Esse site é seguro?"* | o mesmo, em linguagem de consultor |
| *"Faz uma varredura"* | telemetria defensiva da sua própria máquina |

### Investigação
| Diga | O que acontece |
|---|---|
| *"Investiga a empresa X"* | fontes primárias oficiais em paralelo |
| *"Fica de olho em Y"* | vigilância contínua; depois, só o que é novo |
| *"O que saiu de novo?"* | relata apenas as novidades desde o último aviso |

### Decisão
| Diga | O que acontece |
|---|---|
| *"Convoca o conselho"* | 5 conselheiros com métodos distintos + veredito |
| *"Pressiona essa decisão"* | o mesmo — para escolha real com dilema |

### Sobre ele mesmo
| Diga | O que acontece |
|---|---|
| *"O que você aprendeu?"* | autoexame: onde acerta, onde falha, o que lhe ensinaram |
| *"Está tudo funcionando?"* | diagnóstico honesto, inclusive se estiver em contingência |

> **Ele aprende com correção.** Quando você disser *"não faz assim"*, *"responde mais
> curto"*, *"nunca mais faça isso"* — ele grava a lição de forma permanente e ela
> volta nas próximas conversas. Não precisa repetir.

### Controlar a tela pela voz
*"Abre o Cyber"*, *"fecha isso"*, *"abre o site da Vivo"*, *"mostra a câmera"*,
*"vira seu rosto humano"*, *"volta a ser esfera"*.

---

## Os quadrantes

| Painel | Mostra | Ele preenche quando |
|---|---|---|
| **AGENDA** | compromissos | você marca algo, ou pergunta |
| **CLIMA** | meteorologia da sua posição | você pergunta do tempo |
| **NOTÍCIAS IA** | manchetes de tecnologia | sozinho, ao iniciar |
| **MERCADO** | gráfico com leitura técnica | você cita um ativo |
| **VISÃO** | câmera + análise | você pede para ele olhar |
| **CANAL** | a conversa | sempre |

Quando o ELION preenche um quadrante sozinho, ele **pulsa** — é o sinal de que a
automação agiu.

> **Mercado é educativo.** Ele ensina a ler o gráfico. Nunca dá recomendação de
> compra ou venda, e isso não se contorna pedindo de outro jeito.

---

## Modo DOC — documentos

Arraste o arquivo ou use o botão **📎 DOC**.

**O que ele lê:** PDF (inclusive digitalizado, por visão), Word `.docx`, Excel `.xlsx`,
PowerPoint `.pptx`, LibreOffice `.odt`/`.ods`/`.odp`, EPUB, e-mail `.eml`, calendário
`.ics`, contatos `.vcf`, pacote `.zip`, RTF, CSV/TSV, imagem de documento (PNG/JPG/
WebP) e qualquer arquivo de código ou configuração — **em qualquer codificação**
(UTF-8, UTF-16, Windows-1252).

O que ele **não** lê vem com a saída: HEIC diz que o iPhone converte sozinho ao
compartilhar; `.doc` antigo pede para salvar como `.docx`; `.rar` pede um `.zip`.

**Ao carregar, ele já sabe** que tipo de documento é (contrato, edital, proposta, nota
fiscal, currículo, planilha), tem o mapa das seções e os valores, prazos e CNPJ. Por
isso responde pergunta pontual sem ler tudo.

**A busca entende sinônimo.** Perguntar por *multa* encontra *penalidade pecuniária*
e *cláusula penal*; *prazo* encontra *vigência*; *SLA* encontra *disponibilidade*.
Antes disso, perguntar "qual a multa?" num contrato que escreve "penalidade" devolvia
"não encontrei" — e isso não parecia falha, parecia resposta.

> Um documento por vez. Ao carregar outro, o anterior sai.

---

## Terminal Cyber

Botão **⛨ CYBER**. Comandos reais do console:

| Comando | O que faz |
|---|---|
| `ajuda` | esta lista |
| `real` / `sim` | **alterna telemetria REAL da sua máquina** / simulação |
| `varredura` | varredura completa do perímetro e dos ativos |
| `ameacas` | lista as ameaças vivas com id e status |
| `rastrear <ip\|id>` | rastreia a origem (geo + rota de saltos) |
| `analisar [ip\|id]` | kill chain + MITRE + previsão do próximo passo |
| `killchain` | estágios da cadeia de ataque |
| `mitigar [id\|tudo]` | aplica scrubbing / rate-limit |
| `bloquear <ip>` | descarta o prefixo da origem |
| `isolar [nó]` | quarentena de um nó comprometido |
| `matar <pid>` | encerra processo malicioso |
| `restaurar` | reverte volumes a snapshot íntegro |
| `honeypot` | desvia o atacante para isca |
| `sinkhole` / `engano` | defesa ativa: drena, prende e expõe |
| `dossie` | dossiê de atribuição da origem |
| `denunciar` | gera a denúncia ao provedor/CERT |
| `doutrina` | a doutrina completa de defesa ativa (legal) |
| `lockdown` | fechamento total do perímetro |
| `nmap <host>` | varredura de portas de ativo interno |
| `nos` | estado da topologia interna |
| `defcon [1-5]` | consulta ou força o nível de prontidão |
| `status` · `limpar` · `sair` | console |

**O comando que importa é `real`.** Ele liga a telemetria da sua máquina de verdade:
postura de defesa (antivírus, firewall por perfil, criptografia de disco), portas em
escuta classificadas por risco, conexões externas geolocalizadas, fraquezas de
configuração e os aparelhos da sua rede local. Leva até ~30 s.

Tudo marcado com **[REAL]** vem da sua máquina. O resto é cenário tático.

> **Estritamente defensivo.** A plataforma observa, classifica e orienta. Nunca ataca
> e nunca sugere contra-atacar — nem quando o comando tem nome agressivo.

---

## No celular

`ELION-X Mobile.bat` publica o endereço. Ao abrir no celular, use **"Adicionar à tela
de início"** — a plataforma é instalável e passa a abrir como aplicativo, em tela
cheia, sem barra de navegador.

O microfone funciona igual. Toque longo no botão do microfone abre a calibração.

---

## Quando algo falha

| O que aparece | O que significa | O que fazer |
|---|---|---|
| ⚠ *"...continuando pela OpenAI"* | a Anthropic recusou (teto de uso, queda). Ele **continua funcionando** por outro provedor | levante o teto em `console.anthropic.com` › Settings › Limits |
| *"Limite de uso atingido — retomando em Ns"* | limite por minuto; ele espera e repete sozinho | nada |
| *"FALHA DE COMUNICAÇÃO"* | o erro real vem escrito na mensagem | leia o texto — ele costuma dizer o que fazer |
| Ele não escuta | ruído alto ou microfone errado | botão direito no microfone → calibrar |
| Ele responde a conversa alheia | filtro frouxo para a sua sala | calibrar |
| Visor abre em branco | o site recusa ser embutido | ele avisa e oferece abrir fora |
| PDF "sem texto" | é digitalizado e a transcrição falhou | mande uma foto das páginas |

### Diagnóstico

`GET /api/status` devolve o estado da plataforma. E você pode simplesmente **perguntar
a ele**: *"está tudo funcionando?"* — ele lê o próprio registro de desempenho e conta,
inclusive quando está mancando.

---

## Um aviso sobre rede

A plataforma **não tem autenticação**. As rotas `/api/` respondem a quem alcançar a
porta. Isso é aceitável em `localhost`, que é o uso pretendido.

**Não exponha a porta 3001 na internet** sem colocar autenticação na frente. Quem
alcançar essa porta lê seus e-mails, sua agenda, suas conversas de WhatsApp e manda
mensagem no seu nome. O acesso móvel usa um túnel com endereço difícil de adivinhar —
é conveniência, não é segurança.
