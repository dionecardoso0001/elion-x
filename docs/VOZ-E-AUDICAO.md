# Voz e audição do ELION-X

O subsistema mais difícil da plataforma. Tudo o que está descrito aqui vive em
`assets/voice.js` (2.150 linhas), `assets/voiceid.js` (436 linhas) e nas rotas
`/api/tts` e `/api/live/session` de `server.js`.

Não há biblioteca de áudio. Não há WebAudio wrapper, não há VAD de prateleira, não
há SDK da OpenAI. É `AudioContext`, `AnalyserNode`, `RTCPeerConnection` e
`SpeechRecognition` do navegador, mais um WebSocket escrito à mão no servidor para
falar com o Edge TTS.

---

## 1. O defeito que originou tudo

A primeira versão do modo conversa ligava o reconhecimento de fala do navegador e
mandava **toda transcrição** para o agente. Não havia porta nenhuma entre o microfone
e o modelo.

O resultado, na casa do operador:

- conversa de outra pessoa no cômodo virava comando;
- a televisão ligada virava comando;
- um latido, uma cadeira arrastada ou o teclado cortavam a fala do ELION no meio;
- o modelo respondia a frases que não eram com ele, e o operador via a plataforma
  "falando sozinha".

A tentação é subir o limiar de energia. Não funciona, e o comentário em
`assets/voice.js:681` explica por quê:

> O detector antigo media só ENERGIA: "som alto = alguém falou". Por isso arrastar a
> cadeira, apoiar um copo, o cachorro andando, um latido ou o próprio teclado cortavam
> a fala do ELION no meio. E não havia conserto mexendo no limiar: subi-lo até calar a
> cadeira calaria o operador junto.

A pergunta mudou de **"está alto?"** para **"é VOZ, é a voz DELE, e foi dirigida a
mim?"**. As três perguntas são respondidas por mecanismos distintos, e este documento
é sobre eles.

---

## 2. O caminho do som — cinco taps independentes

Antes de qualquer coisa, entenda que o áudio se divide em taps com compromissos
**opostos**. O mesmo sinal medido de duas formas diferentes é a razão de metade do
código funcionar.

```
MICROFONE
   │
   ├─ stream A (vad.stream)  getUserMedia CRU  ─────────► vad.an   (fftSize 2048, smoothing 0)
   │    echoCancellation: true                              │        detecção de voz + altura
   │    noiseSuppression: FALSE                              └──► vadLoop() a cada bloco de áudio
   │    autoGainControl:  FALSE
   │
   ├─ stream B (voiceid)  getUserMedia LIMPO ─────────────► an     (fftSize 4096, smoothing 0)
   │    noiseSuppression: true                                      biometria vocal (quem é)
   │
   ├─ stream C (live.mic)  getUserMedia LIMPO ────────────► WebRTC → OpenAI Realtime
   │    echoCancellation + noiseSuppression + autoGainControl
   │
   └─ Web Speech API (instância própria do navegador) ────► transcrição pt-BR

ALTO-FALANTE
   ├─ <audio> do TTS  ──┬─► analyser (fftSize 512,  smoothing 0.74)  → esfera / waveform
   │                    ├─► lipAn    (fftSize 2048, smoothing 0.12)  → lip-sync do avatar
   │                    └─► ctx.destination                          → o operador ouve
   └─ track de áudio do AO VIVO ─► analyser + lipAn (mesmos dois taps)
```

Os dois taps de saída existem porque os requisitos brigam (`assets/voice.js:29`):

```js
// O tap da esfera é suavizado demais (0.74) e de baixa resolução para
// distinguir vogais. O lip-sync precisa do oposto: janela longa (resolve
// formantes ~23 Hz/bin) e suavização mínima (a boca reage no mesmo
// instante da sílaba, sem atraso perceptível).
```

E os dois taps de entrada existem porque **o processamento do navegador destrói
exatamente o que o detector procura**. Isto está em `assets/voice.js:829` e é um dos
erros mais caros do projeto:

```js
/* CAPTAÇÃO CRUA PARA ANALISAR — este é um dos erros que fizeram o
   operador ter de gritar.
   A supressão de ruído do navegador foi feita para a voz soar limpa aos
   ouvidos humanos, e ela consegue isso apagando exatamente o que meu
   detector procura: a periodicidade das pregas vocais e os harmônicos
   dos formantes. Eu estava medindo o sinal DEPOIS de ele ser mutilado.
   O ganho automático piora: ele levanta o ruído de fundo entre as
   palavras, o piso adaptativo sobe junto, e a porta de energia fecha na
   cara de quem fala baixo.
   Cancelamento de eco FICA — sem ele o agente se ouviria falando e se
   interromperia sozinho. */
vad.stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
}).catch(async () => navigator.mediaDevices.getUserMedia({ audio: true }));
```

O tap do AO VIVO (`assets/voice.js:1866`) pede o **oposto**, e de propósito: aquele
áudio vai para a OpenAI *ouvir*, não para nós *medirmos*.

| Tap | `noiseSuppression` | `autoGainControl` | Motivo |
|---|---|---|---|
| VAD (análise) | **false** | **false** | preservar periodicidade e harmônicos |
| Biometria | true | false | timbre limpo; ganho fixo para o LTAS não mentir |
| AO VIVO | true | **true** | o detector de turno da OpenAI precisa de sinal forte |

Faltava `autoGainControl` só no AO VIVO, e esse único campo ausente era a causa de
"preciso levantar a voz no modo ao vivo".

---

## 3. O detector de voz (VAD)

`assets/voice.js:712` a `assets/voice.js:1170`.

O detector responde, a cada bloco de áudio, três perguntas em cascata. Cada prova só
roda se a anterior passou — é uma cascata de custo crescente.

### Prova 0 — porta de energia com piso adaptativo

```js
// assets/voice.js:1058
// piso de ruído adaptativo (sobe devagar, desce rápido)
vad.floor = rms < vad.floor ? vad.floor * 0.95 + rms * 0.05 : Math.min(vad.floor * 1.004, 0.05);

const porta = Math.max(
  vad.floor * (ELX.state === 'speaking' ? VOZ.ganhoPiso : VOZ.ganhoPiso * 0.8),
  VOZ.pisoMin
);
```

A assimetria (`0.95/0.05` para descer, `1.004` para subir) é deliberada: o piso
**desce rápido** quando a sala silencia e **sobe devagar** quando aparece ruído, para
que uma frase longa não seja lentamente reclassificada como ruído de fundo.

### Prova 1 — periodicidade (autocorrelação normalizada)

Voz vem de pregas vocais que vibram; o sinal se repete a cada 1/F0. Ruído mecânico,
não.

O ponto sutil é **qual pico escolher**. Pegar o máximo global da autocorrelação é o
erro clássico, porque ela também tem picos nos submúltiplos do período — e aí uma voz
aguda é lida como voz grave uma oitava abaixo. A correção é o método de McLeod: o
**primeiro pico qualificado**, não o maior.

```js
// assets/voice.js:781 — vadAltura()
/* Autocorrelação normalizada pelo método de McLeod: o PRIMEIRO pico
   qualificado, nunca o máximo global — o máximo cai nos submúltiplos e faz
   voz aguda ser lida como voz grave. Mesmo método de assets/voiceid.js. */
const alvo = maxR * 0.86;
for (let i = 1; i < vals.length - 1; i++) {
  if (vals[i] >= alvo && vals[i] >= vals[i - 1] && vals[i] >= vals[i + 1]) {
    return { f0: sr8 / (lagMin + i), clareza: vals[i] };
  }
}
```

Antes de correlacionar, o sinal é **decimado por 6** (`vadDecima`, `assets/voice.js:768`),
o que também serve de filtro passa-baixa:

```js
/* Constantes da análise. A altura é medida a 8 kHz porque voz humana tem
   F0 entre 70 e 400 Hz — analisar isso a 48 kHz seria oito vezes o trabalho
   pelo mesmo resultado, e este laço roda a 60 Hz junto com o WebGL. */
const VAD_FFT = 2048;   // 43 ms a 48 kHz: cabem 4,8 períodos de voz grave
const DEC = 6;
const F0_MIN = 70, F0_MAX = 400;
```

Medições de bancada registradas no código (`assets/voice.js:693`):

| Som | Clareza (autocorrelação) |
|---|---:|
| voz humana | 0,94 – 1,00 |
| copo apoiado | 0,61 |
| latido | 0,43 |
| patas no chão | 0,42 |
| teclado | 0,41 |
| cadeira arrastada | 0,27 |

### Prova 2 — riqueza harmônica (por que clareza sozinha não basta)

Este é o ponto que quase ninguém prevê: **um bipe pontua clareza 1,00**. Um tom puro é
perfeitamente periódico. Pelo critério da prova 1, o micro-ondas é o interlocutor mais
articulado da casa.

O que separa voz de tom puro não é a periodicidade, é o **espectro**: voz tem
formantes, ressonâncias do trato vocal na faixa de 300 a 3500 Hz. Tom puro tem toda a
energia no fundamental.

```js
// assets/voice.js:814 — vadRiqueza()
/* Razão formantes/fundamental. O analyser entrega decibéis; converto para
   magnitude linear porque a razão só faz sentido em escala linear. A razão
   é adimensional, então o fator de escala do analyser se cancela. */
function vadRiqueza(sr) {
  vad.an.getFloatFrequencyData(vad.espectro);
  const binHz = sr / VAD_FFT;
  const somaFaixa = (lo, hi) => {
    let s = 0;
    const a = Math.max(1, Math.round(lo / binHz)), b = Math.min(vad.espectro.length - 1, Math.round(hi / binHz));
    for (let i = a; i <= b; i++) s += Math.pow(10, vad.espectro[i] / 20);
    return s;
  };
  return somaFaixa(300, 3500) / (somaFaixa(70, 300) + 1e-9);
}
```

A conversão `10^(dB/20)` não é detalhe: somar decibéis diretamente daria uma razão sem
sentido físico. E como é uma **razão**, o fator de escala arbitrário do `AnalyserNode`
se cancela — a medida não depende de calibração de volume.

| Som | Riqueza harmônica |
|---|---:|
| voz humana | 5,4 – 16,5 |
| zumbido de geladeira (100/120 Hz) | 0,25 – 0,36 |
| bipe de micro-ondas | 0,10 |

### Prova 3 — quem falou (altura da voz)

A risada de uma criança **é voz de verdade** e passa nas duas provas anteriores. Para
separar *pessoas* usamos a altura fundamental, que a prova 1 já calculou de graça:

```js
// assets/voice.js:1078
if (vozAcustica && vad.f0Operador > 0) {           // PROVA 3 — é a voz DELE?
  doOperador = Math.abs(Math.log2(f0 / vad.f0Operador)) <= VOZ.oitavasMax;
}
```

A distância é medida em **oitavas** (`log2` da razão), não em hertz, porque a percepção
de altura é logarítmica: 20 Hz de diferença é enorme numa voz grave e irrelevante numa
aguda.

**Sem cadastro de voz, `vad.f0Operador` vale 0 e esta prova é simplesmente desligada** —
nunca travada. A degradação é deliberada: o código mede 11/11 de acerto com a prova 3
ativa e 9/11 sem ela, e aceita os 9/11, porque *ignorar o dono é pior que responder
demais*.

### Prova 4 — sustentação e proporção

As três provas acima decidem sobre **um bloco de áudio**. Uma tosse tem voz de verdade
em vários blocos seguidos. Conversa ao fundo também. A prova 4 decide sobre a
**janela**.

```js
// assets/voice.js:1105
/* PROVA 4 — SUSTENTAÇÃO E PUREZA, medidas na bancada com os sons que o
   operador citou:

                     voz contínua   quadros do operador
    tosse                231 ms        10 de 11  (91%)
    conversa ao fundo   1869 ms        31 de 89  (35%)
    interrupção real    1596 ms        76 de 76 (100%)

  Nenhuma prova sozinha separa os três. DURAÇÃO mata a tosse, que é curta
  demais para ser frase. PROPORÇÃO mata a conversa alheia, que tem voz de
  sobra mas quase toda de OUTRA altura. Juntas, com margem grande. */
```

Essa tabela é o argumento inteiro. A tosse tem **91% de quadros do operador** — ela é
mesmo a voz dele — mas dura 231 ms. A conversa ao fundo dura 1869 ms — tempo de sobra —
mas só 35% bate com a altura dele. Nenhum critério isolado separa os três casos; os
dois juntos separam com folga.

```js
// assets/voice.js:1140
const msVoz     = vad.hist.reduce((a, h) => a + (h.vozeado ? h.dt : 0), 0);
const msHumana  = vad.hist.reduce((a, h) => a + (h.vozAcustica ? h.dt : 0), 0);
const proporcaoDono = msHumana > 0 ? msVoz / msHumana : 0;

if (proporcaoDono < VOZ.proporcaoDono) return;          // 0,65
if (cortandoLive && msVoz < VOZ.vozLiveMs) return;      // 520 ms no AO VIVO
if (msVoz >= VOZ.vozMs) { /* …é interrupção de verdade… */ }   // 300 ms no microfone
```

As réguas são **diferentes por modo**, e o comentário diz por quê:

> No modo AO VIVO a régua é mais dura de propósito: lá, cortar por engano destrói a
> resposta inteira, enquanto deixar de cortar custa ao operador apenas repetir a
> pergunta. Erros de custo diferente merecem limiares diferentes.

### Trava de repetição

```js
// assets/voice.js:1152
/* TRAVA DE REPETIÇÃO. Interromper é um gesto único; repetir o gesto
   enquanto a pessoa ainda fala não interrompe mais nada — só reinicia o
   reconhecimento de fala por cima dela mesma, engolindo a frase.
   Medido: sem esta trava, 1,4 s de fala contínua disparavam SETE vezes. */
if (now - vad.ultimoDisparo < 1200) return;
```

### A lição mais cara do arquivo

```js
// assets/voice.js:732
/* ⚠ LIÇÃO CARA, ANOTADA AQUI PARA NÃO SE REPETIR.
   A primeira versão destes números foi calibrada com sons que EU sintetizei:
   limpos, altos, com harmônicos perfeitos. Deram 11 de 11 na bancada — e na
   vida real obrigaram o operador a gritar. O microfone dele passa por
   supressão de ruído e ganho automático do navegador, que achatam justamente
   a periodicidade e os harmônicos que eu media. Bancada sintética mede o
   algoritmo; só o microfone de verdade mede o PRODUTO. */
```

Os limiares originais e os atuais:

| Constante | Antes | Agora | O que corrigiu |
|---|---:|---:|---|
| `clarezaMin` | 0,75 | **0,52** | supressão de ruído corrói a periodicidade |
| `riquezaMin` | 1,50 | **0,70** | o mesmo, nos formantes |
| `pisoMin` | 0,0140 | **0,0035** | *era este* que exigia voz alta |
| `ganhoPiso` | 3,0 | **1,8** | idem |
| `vozMs` | 130 | **300** | 130 ms deixava a tosse (231 ms) passar |
| `oitavasMax` | 0,75 | **0,55** | 0,75 deixava entrar outro adulto de 195 Hz |

Os três remédios adotados: padrões muito mais permissivos, calibração no microfone
real (§8) e leitura ao vivo do que está sendo medido (`ELX.voice.escuta.medindo`),
*"para nunca mais eu ficar adivinhando"*.

---

## 4. O relógio de áudio

Este é o problema mais insidioso do subsistema, porque falha **em silêncio**.

```js
// assets/voice.js:1020
/* ⚠ O RELÓGIO DESTE LAÇO NÃO PODE VIR DA PÁGINA. Medido, nesta ordem:
     · requestAnimationFrame — CONGELA por completo em aba escondida;
     · setInterval           — o Chrome estrangula para 1 vez por segundo.
   Com qualquer um dos dois, o ELION PARAVA DE OUVIR assim que o operador
   minimizasse a janela ou trocasse de aba. Sem erro, sem aviso: só surdez.
   Um assistente de voz que só escuta quando está sendo olhado não serve. */
```

A solução: **o próprio fluxo do microfone vira o relógio**. Um `ScriptProcessorNode`
dispara a cada bloco de 1024 amostras (~21 ms a 48 kHz), e a thread de áudio não é
estrangulada por visibilidade da aba.

```js
// assets/voice.js:1034
function vadRelogioDeAudio(c, origem) {
  try {
    const proc = c.createScriptProcessor(VAD_BLOCO, 1, 1);
    proc.onaudioprocess = () => { vad.batidasDoAudio = (vad.batidasDoAudio || 0) + 1; vadLoop(); };
    const mudo = c.createGain();
    mudo.gain.value = 0;                  // o nó precisa de destino para rodar;
    origem.connect(proc); proc.connect(mudo); mudo.connect(c.destination);
    vad.proc = proc; vad.mudo = mudo;     // silenciado para não voltar aos alto-falantes
    return true;
  } catch (e) { console.warn('[vad] thread de áudio indisponível:', e.message); return false; }
}
```

O `GainNode` com ganho zero existe porque um `ScriptProcessorNode` **não roda se não
estiver conectado a um destino** — mas conectá-lo direto aos alto-falantes devolveria o
microfone ao ambiente.

### Criar o relógio não é o mesmo que ele bater

`createScriptProcessor` está obsoleto. No iPhone ele **existe, não lança erro e pode
nunca disparar**. Confiar no retorno da criação era um bug silencioso:

```js
// assets/voice.js:869
vad.batidasDoAudio = 0; vad.ultimaBatida = 0;
vad.naAudioThread = vadRelogioDeAudio(c, origem);
vad.raf = setInterval(vadLoop, VAD_INTERVALO);      // começa rápido, sempre (60 ms)
setTimeout(() => {
  if (!vad.an) return;
  const esperadas = 400 / (1000 / (c.sampleRate / VAD_BLOCO));   // quantas o nó deveria ter dado
  const funcionando = vad.naAudioThread && vad.batidasDoAudio >= esperadas * 0.5;
  if (funcionando) {
    clearInterval(vad.raf);
    vad.raf = setInterval(vadLoop, 250);            // o nó conduz; isto vira só vigia
  } else if (vad.naAudioThread) {
    console.warn('[vad] o relógio de áudio não está batendo — mantenho o temporizador rápido');
    vad.naAudioThread = false;
  }
}, 400);
```

O temporizador rápido começa **sempre**; só é rebaixado a vigia depois que as batidas
reais foram **contadas**.

### Meça o tempo, nunca o suponha

O mesmo defeito, um nível acima:

```js
// assets/voice.js:1125
/* ⚠ MEÇA O TEMPO, NUNCA O SUPONHA.
   Aqui havia `quadroMs = naAudioThread ? 21.3 : 16.7` — um palpite sobre a
   frequência do laço. Quando o relógio de áudio é CRIADO mas não dispara
   (acontece no iPhone, onde esse nó é obsoleto, e sempre que o navegador
   suspende o motor de áudio), sobra só o temporizador de reserva, de 250 ms.
   O código seguia contando cada batida como 21,3 ms — então os 300 ms de
   fala exigidos viravam 3,75 SEGUNDOS falando sem parar, e 6,25 s no modo
   AO VIVO. Para o operador isso é exatamente "ele não me ouve".
   Agora cada medição carrega quanto tempo REAL ela representa. O teto de
   120 ms impede que uma pausa do navegador seja contada como discurso. */
const dt = Math.min(Math.max(now - (vad.ultimaBatida || now), 0), 120);
vad.ultimaBatida = now;
vad.hist.push({ t: now, dt, vozeado, vozAcustica });
```

Cada amostra do histórico carrega sua própria duração medida. O teto de 120 ms impede
que uma suspensão do navegador (um único `dt` de 3 segundos) seja contada como
discurso contínuo.

---

## 5. As quatro portas de `paraMim()`

Passar no VAD prova que **houve voz**. Não prova que a frase era **para o agente**.
Essa decisão é de `paraMim()` (`assets/voice.js:512`), e ela é aplicada nos dois modos:
no microfone, ao fim da transcrição; no AO VIVO, quando a transcrição da OpenAI chega.

A primeira versão tinha **uma porta só**: dizer o nome. O operador reclamou com razão —
ninguém fala assim.

> "Vamos trabalhar?", "hora do show", "e aí garoto" são chamados tão claros quanto
> "Elion", e ele não vai decorar fórmula nenhuma.

```js
// assets/voice.js:512
function paraMim(texto) {
  if (!CHAMADO.exigir) return { aceita: true, motivo: 'filtro desligado', quem: donoDaFala() };

  const quem = donoDaFala();
  const t = String(texto || '').trim();

  // porta 1 — chamou pelo nome. Inequívoco, entra sempre.
  if (chamouPeloNome(t)) return { aceita: true, motivo: 'chamado pelo nome', quem };

  // porta 2 — conversa já aberta. Não faço ninguém repetir saudação a cada frase.
  if (conversaAberta() && (quem.dono || quem.semDados))
    return { aceita: true, motivo: 'conversa em andamento', quem };

  // porta 3 — é a voz DELE e a frase é dirigida a alguém
  const dirigida = falaComigo(t);
  if (quem.dono && dirigida) return { aceita: true, motivo: 'sua voz, falando comigo', quem };

  // porta 4 — sem biometria confiável, aceito pela forma da frase.
  // Nunca travo o operador por falta de cadastro ou por medida ruim.
  if ((quem.semCadastro || quem.semDados) && dirigida)
    return { aceita: true, motivo: 'parece dirigida a mim', quem };

  if (!quem.dono && quem.f0)
    return { aceita: false, motivo: `voz de outra pessoa (${quem.f0} Hz)`, quem };
  return { aceita: false, motivo: 'não parecia falado comigo', quem };
}
```

| Porta | Condição | Por que existe nesta posição |
|---|---|---|
| 1 | nome reconhecido na frase | intenção inequívoca; vale **mesmo se a medida de altura saiu ruim** naquele instante |
| 2 | janela de conversa aberta (45 s) e voz do dono *ou* sem dados | ninguém repete "Elion" a cada frase de um diálogo |
| 3 | voz do dono **e** frase dirigida a alguém | é o "vamos trabalhar?" sem nome nenhum |
| 4 | sem biometria confiável **e** frase dirigida | falta de cadastro nunca pode trancar o operador |

A ordem é explicada no código:

> A ORDEM DAS PORTAS É DELIBERADA: da mais barata e inequívoca para a mais
> interpretativa. E o desempate, em toda dúvida, é ACEITAR: deixar de responder ao dono
> é um defeito pior que responder demais.

### Por que o desempate é ACEITAR

Os dois erros possíveis não custam o mesmo:

- **falso positivo** — o agente responde a algo que não era com ele. Custo: uma
  resposta desnecessária, que o operador ignora ou corta com a voz;
- **falso negativo** — o agente ignora o dono. Custo: o operador fala com uma máquina
  muda, não sabe por quê, e conclui que a plataforma travou.

O segundo é qualitativamente pior, então toda dúvida resolve a favor de aceitar.
A mesma assimetria aparece em quatro outros lugares do arquivo: na calibração (que
pode afrouxar os limiares, jamais endurecê-los), na prova 3 (desligada sem cadastro, não
travada), nas portas 2 e 4 (`semDados`/`semCadastro` contam a favor) e no cão de guarda
do microfone do AO VIVO (`falhar aberto é a única falha aceitável aqui`).

### "É dirigida a alguém?" sem chamar modelo nenhum

```js
// assets/voice.js:539
/* A FRASE FOI DIRIGIDA A ALGUÉM?
   Não tento adivinhar intenção com modelo nenhum — seria lento e caro num
   caminho que precisa ser instantâneo. Procuro os sinais que a própria
   língua dá quando alguém se dirige a outro: saudação, pergunta, ordem, ou
   segunda pessoa. É deliberadamente GENEROSO. */
function falaComigo(texto) {
  const t = semAcento(texto);
  if (t.length < 2) return false;
  return SAUDACAO.test(t) || SEGUNDA.test(t) || ORDEM.test(t) || PERGUNTA.test(texto);
}
```

Quatro expressões regulares (`assets/voice.js:546-549`) cobrindo saudação, segunda
pessoa, imperativo e interrogação. `PERGUNTA` é testada no texto **com** acento porque
procura o caractere `?`; as outras, sem acento, porque o reconhecedor de fala é
inconsistente com acentuação.

### O silêncio precisa ser legível

Quando a frase é recusada, o agente não fica só mudo:

```js
// assets/voice.js:557
/* Aviso discreto. Ficar mudo sem explicação é o que faria o senhor pensar
   que a plataforma travou — o silêncio precisa ser LEGÍVEL. */
function marcaIgnorada(motivo, texto) {
  cmd.placeholder = `ouvi, mas não era comigo — ${motivo}`;
  micBtn?.classList.add('ouvindo-alheio');
  // …volta ao normal em 2,6 s
}
```

### A válvula

```js
// assets/voice.js:366
/* VÁLVULA. Se a porta algum dia ficar apertada demais e não reconhecer o
   operador, ele não pode ficar sem voz — isso seria trocar um defeito
   chato por um defeito grave. */
exigir: localStorage.getItem('elx.exigirNome') !== '0',
```

Desligar a porta (`ELX.voice.escuta.exigirNome = false`) devolve o comportamento
original — responder a tudo — e o aviso é honesto sobre a consequência:
*"Volto a responder a tudo o que ouvir — inclusive conversa alheia."*

---

## 6. Reconhecer o nome

"Elion" é palavra rara em português. O reconhecedor de fala do navegador erra nela o
tempo todo: "elionn", "e lion", "elian", "hélion".

Comparação exata não serve. `chamouPeloNome()` (`assets/voice.js:411`) usa **distância
de edição limitada**, com uma distinção que não é preciosismo:

```js
// assets/voice.js:386
/* Aceito o nome exato ou com UMA letra a mais/a menos — nunca com uma letra
   TROCADA. A distinção não é preciosismo: o reconhecedor de fala come e
   acrescenta letras o tempo todo ("elionn", "e lion"), mas trocar uma vogal
   no meio costuma produzir OUTRO nome de gente. Foi assim que "Elton" virou
   chamado no meu primeiro teste — e "Elias", "Eliana" e "Hélio" antes dele. */
const umaTrocaSo = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false;
  return d === 1;
};
```

Hoje a **substituição também é aceita**, mas só porque a lista de exceções absorve as
colisões conhecidas:

```js
// assets/voice.js:382
const NOMES = ['elion', 'elionx', 'eliom', 'elian', 'elyon', 'ilion', 'helion', 'elio', 'aliom'];
const NAO_E_ELE = new Set(['elias', 'eliana', 'elton', 'helena', 'elenco', 'eleicao',
                           'elevador', 'nelson', 'wilson', 'aliado', 'aliar']);
```

O raciocínio da mudança está registrado (`assets/voice.js:375`):

> Voltei a ser generoso, e a razão mudou: quando o nome era a ÚNICA porta, um falso
> positivo reabria o defeito original, então eu apertei até só aceitar letra a mais ou a
> menos. Com quatro portas, apertar aqui só faz mal — barra o operador chamando o
> agente, que é o pior desfecho. As colisões reais vão na lista de exceção, que é
> honesta e explícita, em vez de sacrificar o alcance.

Uma lista negra explícita de onze palavras é mais legível e mais fácil de auditar do que
um limiar de distância ajustado até "parar de dar problema".

### O nome quebrado em duas palavras

O reconhecedor parte "Elion" em "e lion". Juntar tokens resolve — mas juntar
**qualquer** par cria falsos positivos:

```js
// assets/voice.js:415
/* Junto duas palavras só quando o corte é plausível: ou a primeira é
   "e"/"el" (o reconhecedor parte "Elion" em "e lion"), ou a primeira já
   começa com "el" e a segunda é um resto de uma ou duas letras.
   Juntar QUALQUER par produzia "li on" (de "li on-line") virando
   "lion" — e daí um chamado falso. */
const prox = toks[i + 1];
if (prox && (/^(e|el)$/.test(toks[i]) || (/^el/.test(toks[i]) && prox.length <= 2)))
  cands.push(toks[i] + prox);
```

Há ainda um piso de quatro letras (`if (c.length < 4 …) continue`), que impede que
tokens curtíssimos entrem na comparação por distância.

---

## 7. Chamado sem pedido

Defeito relatado: o ELION dizia **duas vezes seguidas** a mesma saudação.

A causa não estava no TTS nem no modelo — estava em tratar um **chamado** como um
**pedido**:

```js
// assets/voice.js:437
/* ═══ CHAMADO SEM PEDIDO ═══
   "Elion" sozinho não é comando — é alguém chamando. Tratar como comando
   mandava a palavra solta ao modelo, que via a própria saudação logo acima no
   histórico e a repetia inteira. Daí a queixa: duas vezes a mesma frase. */
```

O modelo estava fazendo exatamente o que um modelo faz: a situação era idêntica à
anterior, e a resposta anterior estava no histórico servindo de molde.

`soOChamado()` (`assets/voice.js:452`) separa os dois casos:

```js
function soOChamado(texto) {
  const t = semAcento(String(texto || '')).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!t) return false;
  const toks = t.split(/\s+/).filter(Boolean);
  if (!toks.length || toks.length > 5) return false;   // frase longa é pedido

  // remove o nome (inclusive quebrado em duas palavras, como "e lion")
  const sobra = [];
  for (let i = 0; i < toks.length; i++) {
    const junto = toks[i + 1] ? toks[i] + toks[i + 1] : null;
    if (ehNomeDele(toks[i])) continue;
    if (junto && ehNomeDele(junto) && (/^(e|el)$/.test(toks[i]) || /^el/.test(toks[i]))) { i++; continue; }
    sobra.push(toks[i]);
  }
  if (sobra.length === toks.length) return false;      // o nome nem apareceu
  return sobra.every(w => RECHEIO.has(w));             // só sobrou recheio → é chamado
}
```

O conjunto `RECHEIO` (`assets/voice.js:446`) tem 30 palavras — "oi", "ei", "opa",
"psiu", "escuta", "acorda", "atencao", "cara", "amigo"… Se depois de tirar o nome
sobrar **qualquer coisa com sentido**, é pedido e vai ao modelo como sempre. E o
critério tem um viés declarado:

> Só descarto palavra de recheio […] Se sobrar QUALQUER coisa com sentido, é pedido e
> vai para o modelo como sempre: perder um comando de verdade seria muito pior que
> responder a um chamado a mais.

A resposta é **local, instantânea e variada**, sem ida ao modelo:

```js
// assets/voice.js:476
/* Repetição é exatamente a queixa — ela não pode voltar por esta porta.
   Guardo a última para nunca repetir duas seguidas. */
const ATENDIMENTOS = [
  'Pois não, Senhor.', 'Senhor?', 'Às ordens.', 'Diga, Senhor.',
  'Estou aqui.', 'Pois não?', 'Sim, Senhor?', 'Escuto.',
];
let ultimoAtendimento = -1;
function atender() {
  let i;
  do { i = Math.floor(Math.random() * ATENDIMENTOS.length); }
  while (ATENDIMENTOS.length > 1 && i === ultimoAtendimento);
  ultimoAtendimento = i;
  return ATENDIMENTOS[i];
}
```

Sorteio **sem reposição imediata** — porque um sorteio uniforme reintroduziria a
repetição que a função existe para eliminar, uma vez a cada oito chamados.

O despacho está em `assets/voice.js:638`:

```js
/* Chamado sem pedido: atendo AQUI, na hora, e continuo escutando.
   Não gasta chamada de API e não dá ao modelo a chance de repetir a
   saudação que já está no histórico. */
if (soOChamado(t)) {
  ELX.agent?.responderLocal?.(atender());
  if (conv.on) setTimeout(() => { if (conv.on && !sttActive) startSTT(); }, 900);
  return;
}
```

`responderLocal` (`assets/agent.js:346`) põe a frase na bolha, no histórico e na fala —
mas **sem chamada de API**. Ganhos: latência zero, custo zero e a repetição resolvida
na raiz.

---

## 8. Reconhecimento de fala (STT) — dois descartes deliberados

O STT é a Web Speech API do navegador (`window.SpeechRecognition`), em `pt-BR`, com
`interimResults: true`. Só funciona em Chrome/Edge; o código avisa e desiste em vez de
degradar em silêncio.

Dois defeitos sutis foram corrigidos no `onend`:

### Descarte ao abortar de propósito

```js
// assets/voice.js:620
/* DESCARTE DELIBERADO. rec.abort() dispara este onend assim mesmo, e o
   onend é um fecho sobre o finalText daquela instância — então parar a
   escuta de propósito podia ENVIAR o que estava no meio. Era assim que
   bargeIn(), que faz stopSTT()+startSTT(), podia despachar meia frase. */
if (rec && rec.__descartar) { cmd.value = ''; cmd.placeholder = 'transmita seu comando, Senhor…'; return; }
```

`stopSTT()` marca a instância com `__descartar = true` **antes** de abortar. Sem isso, o
próprio barge-in enviava metade da frase anterior como comando.

### Só o texto confirmado

```js
// assets/voice.js:625
/* SÓ O TEXTO CONFIRMADO. Antes caía em cmd.value quando não havia
   resultado final — e cmd.value é finalText + o PROVISÓRIO, isto é, o
   palpite que o reconhecedor ainda estava revisando. Ruído de conversa
   alheia meio-ouvido virava comando por essa porta. Aceito o provisório
   só quando é substancial e o final não veio de todo. */
const provisorio = cmd.value.trim();
const t = (finalText.trim() || (provisorio.length >= 12 ? provisorio : '')).trim();
```

O piso de 12 caracteres é o meio-termo: aceita uma frase real que o reconhecedor não
finalizou, rejeita o fragmento de dois caracteres que ele ia descartar de qualquer
jeito.

### Barge-in

```js
// assets/voice.js:1189
/** operador falou por cima → corta a fala/geração e escuta na hora */
function bargeIn() {
  if (!conv.on) return;
  ELX.agent?.interrupt('barge-in');
  stopSTT();          // garante instância limpa
  startSTT();         // já captura o início da fala do operador
}
```

`interrupt()` (`assets/agent.js:334`) aborta o `AbortController` do streaming **e** para
o TTS. O histórico registra a interrupção explicitamente
(`[fala interrompida pelo operador no meio — responda à próxima mensagem com prioridade]`),
para o modelo não retomar do zero na frase seguinte.

---

## 9. Modo AO VIVO

No AO VIVO o navegador fala **direto** com a OpenAI Realtime por WebRTC. O servidor só
emite o token efêmero; o áudio nunca passa por ele.

```
navegador                         server.js                    OpenAI
   │  POST /api/live/session ────────►│
   │                                  │ POST /v1/realtime/client_secrets ──►│
   │  ◄──── {token, mode, model, portao} ◄──────────────────────────────────│
   │
   │  RTCPeerConnection + createDataChannel('oai-events')
   │  POST https://api.openai.com/v1/realtime/calls?model=…  (SDP offer)
   │  ◄──── SDP answer
   │
   │  ══════ áudio full-duplex + eventos JSON no canal de dados ══════►
```

### A configuração de turno, e as três versões dela

`server.js:4313`:

```js
turn_detection: {
  type: 'semantic_vad', eagerness: 'auto',
  create_response: true, interrupt_response: false,
},
```

| Versão | Configuração | O que deu errado |
|---|---|---|
| 1ª | nada declarado (`server_vad` 0,5; ambos os portões `true` por omissão) | qualquer som gerava resposta **e** cortava a fala |
| 2ª | `semantic_vad`, `eagerness: 'low'`, ambos `false` | matou os falsos disparos e criou **atraso** perceptível |
| 3ª | `eagerness: 'auto'`, `create_response: true`, `interrupt_response: false` | responde na hora e **cancela depois** o que não era para ele |

### Suprimir DEPOIS, em vez de esperar ANTES

Esta é a decisão de projeto central do AO VIVO:

```js
// assets/voice.js:1897
/* ═══ SUPRESSÃO DEPOIS, NÃO ESPERA ANTES ═══
   A OpenAI transcreve tudo o que o microfone capta, inclusive a
   conversa dos outros na sala. Minha versão anterior segurava TODA
   resposta até a transcrição chegar, para só então decidir — correto no
   papel, e lento na prática: o operador sentia o atraso em cada frase.
   Agora ela responde na hora, e eu CANCELO o que não era para mim.
   Trocar espera garantida por correção ocasional é o negócio certo
   quando quem espera é uma pessoa conversando. */
if (live.portao && /input_audio_transcription\.(completed|done)$/.test(msg.type || '')) {
  const dito = String(msg.transcript || msg.text || '').trim();
  if (!dito) return;                       // sem texto, deixo seguir
  const v = paraMim(dito);
  if (v.aceita) { renovaConversa(); return; }
  // não era comigo: corto a resposta que já começou e apago o item,
  // para conversa alheia não virar contexto da próxima fala dele
  envia({ type: 'response.cancel' });
  if (msg.item_id) envia({ type: 'conversation.item.delete', item_id: msg.item_id });
  return;
}
```

O `conversation.item.delete` é a parte que se esquece: cancelar a resposta não basta,
porque a fala alheia **já entrou no contexto** e contaminaria o próximo turno do
operador.

A troca é: espera garantida de ~500 ms em **toda** frase versus algumas centenas de
milissegundos de áudio errado em frases raras. Com uma pessoa do outro lado, a segunda
opção ganha.

### O portão do microfone

A causa raiz do "ele para no meio e não volta" não estava no detector local:

```js
// assets/voice.js:1920
/* ═══ PORTÃO DO MICROFONE ENQUANTO ELE FALA ═══
   A raiz do defeito relatado não estava no meu detector: estava em
   create_response:true. Qualquer som que a OpenAI classificasse como
   turno — uma tosse, um espirro, alguém falando ao fundo — fazia ela
   ABRIR UM TURNO NOVO e gerar outra resposta, que atropelava a que
   estava no ar.
   Nenhum ajuste de limiar conserta isso do lado de cá, porque a
   decisão é tomada do lado de lá. A única forma de impedir é o som
   NÃO CHEGAR. */
if (msg.type === 'response.created') { live.falando = true; liveMic(false); return; }
if (/^response\.(done|cancelled|failed|incomplete)$/.test(msg.type || '')) {
  live.falando = false; liveMic(true); return;
}
```

`liveMic(false)` não derruba a sessão — apenas põe `track.enabled = false`, e o WebRTC
segue de pé transmitindo silêncio.

O tap de análise é **outro stream** e continua ouvindo sempre. É ele quem reabre o
portão quando reconhece uma interrupção legítima — e a ordem das duas ações importa:

```js
// assets/voice.js:1161
if (cortandoLive) {
  /* Interrupção legítima reconhecida: reabro o microfone ANTES de
     cancelar, para a OpenAI ouvir a frase dele desde o começo. A ordem
     importa — cancelar primeiro deixaria as primeiras sílabas no vazio. */
  live.cortes++; live.falando = false;
  liveMic(true);
  live.envia?.({ type: 'response.cancel' });
} else bargeIn();
```

### Cão de guarda

```js
// assets/voice.js:1285
/* CÃO DE GUARDA DO PORTÃO. O microfone só fecha esperando um "terminei de
   falar" que vem pelo canal de eventos. Se esse evento se perder — queda de
   rede, resposta travada, canal caindo —, o operador ficaria MUDO sem
   entender por quê. Nenhuma resposta dura meio minuto; passados 30 s de
   portão fechado, reabro por conta própria. Falhar aberto é a única falha
   aceitável aqui. */
```

O guarda é chamado de dentro do `vadLoop()` (`assets/voice.js:1050`), **não** de um
`setInterval` — pelo mesmo motivo do §4: um temporizador de página não roda com a aba
escondida, e é justamente aí que ninguém veria o problema.

### `portao`: o servidor informa quem manda

```js
// server.js:4258
/* `portao` diz ao cliente se ELE é o responsável por decidir quando o agente
   responde. Só o caminho GA desliga a resposta automática; no legado a OpenAI
   continua respondendo sozinha, e o cliente não pode mandar responder de novo
   sem provocar resposta dobrada. Sem esta bandeira o cliente teria de adivinhar
   pelo nome do modelo — e adivinhar é como se criam defeitos silenciosos. */
```

O caminho legado (`gpt-4o-realtime-preview-2024-12-17`) não tem `semantic_vad` nem
redução de ruído; lá só dá para apertar `threshold: 0.85` e manter
`interrupt_response: false`.

### As 47 ferramentas do AO VIVO

Quem executa as ferramentas no AO VIVO é o **navegador**, não o servidor — e por isso
elas existem duas vezes. `LIVE_TOOL_NAMES` (`server.js:4248`) lista 47 das 49
ferramentas do agente; os executores estão em `liveExecToolNucleo()`
(`assets/voice.js:1338`), cada um chamando uma rota HTTP do próprio servidor.

A consequência, registrada em `assets/voice.js:1572`:

> Estavam anunciadas ao modelo sem executor aqui: ele chamava, não recebia nada e dizia
> ao operador que o modo estava fora do ar.

É o modo de falha característico dessa arquitetura: a ferramenta funciona no modo texto
e falha em silêncio no AO VIVO. Por isso `liveExecTool()` (`assets/voice.js:1317`) é uma
**casca que mede** o que o núcleo devolve:

```js
/* Casca que MEDE o que o núcleo devolve. No AO VIVO quem executa é o
   navegador, então o servidor não vê nem a chamada nem o desfecho — sem este
   aviso, tudo que o operador faz POR VOZ ficaria fora da memória de trabalho
   e fora do aprendizado. Envolver em vez de instrumentar caso a caso garante
   que a próxima ferramenta a nascer já entre medida. */
const FALHA_VIVA = /^\s*(ERRO\b|Erro:|FALHA\b|Falha ao|Não consegui|…)/;
```

Ela dispara `POST /api/activity` sem `await` — *"registro nunca pode atrasar a resposta
falada"*.

---

## 10. Síntese de voz

### O locutor incremental

O agente não espera a resposta inteira para começar a falar. `assets/agent.js:263`
alimenta o sintetizador frase a frase, **enquanto o texto ainda está sendo gerado**:

```js
/* locutor incremental — fala cada frase assim que ela termina de ser gerada */
const speaker = {
  feed(t) {
    sentBuf += t;
    let idx = -1;
    const re = /[.!?…]["')\]]?(?=\s|$)/g;
    let m; while ((m = re.exec(sentBuf))) idx = m.index + m[0].length;
    const minLen = spokeFirst ? 30 : 12; // primeira frase sai o quanto antes
    if ((idx >= minLen) || (idx > 0 && sentBuf.length > 110) || sentBuf.length > 340) {
      const cut = idx > 0 ? idx : sentBuf.length;
      const part = sentBuf.slice(0, cut).trim();
      sentBuf = sentBuf.slice(cut);
      if (part) { ELX.voice.speak(part); spokeFirst = true; }
    }
  },
  flush() { /* … */ },
};
ELX.voice.hold(true); // mantém o estado de fala aberto até o fim da geração
```

O `hold(true)` existe porque a fila de TTS esvaziar **não** significa que a resposta
acabou — só que o modelo ainda não gerou a próxima frase. Sem ele, o estado voltava a
`idle` e o modo conversa reabria o microfone no meio da resposta.

### Fatiar custa prosódia

```js
// assets/voice.js:287
/* FATIAR CUSTA PROSÓDIA.
   Cada pedaço vira um pedido de voz INDEPENDENTE, e o sintetizador começa do
   zero em cada um: escolhe altura, volume e ritmo de novo. Era daí que vinha
   a voz "afinando e engrossando" no meio da resposta, e o ritmo mudando de
   frase para frase.
   Mas não dá para mandar tudo de uma vez: até o áudio ficar pronto o operador
   fica olhando para o silêncio. O acordo é assimétrico — o PRIMEIRO pedaço
   curto, para a voz começar rápido, e os seguintes bem grandes, para haver o
   mínimo possível de recomeços. Antes eram pedaços iguais de 420, o pior dos
   dois mundos: começava devagar E recomeçava muito. */
const PRIMEIRO_PEDACO = 220;    // só o suficiente para o som começar logo
const DEMAIS_PEDACOS = 1200;    // e daí em diante, o menos cortado possível
```

Este é o insight não óbvio do subsistema: **o tamanho ótimo do pedaço não é constante**.
O primeiro pedaço paga a latência percebida; todos os outros pagam a continuidade
prosódica. Um tamanho único (420) era o pior dos dois mundos.

A mesma assimetria aparece no locutor (`minLen` 12 na primeira frase, 30 nas demais) e
no pré-carregamento:

```js
// assets/voice.js:200
/* pré-sintetiza a próxima frase enquanto a atual toca → sem pausas entre frases */
function prefetch(text) { /* fetch('/api/tts?…') e descarta — o cache do servidor guarda */ }
```

O `prefetch` não usa o resultado: ele existe só para **aquecer o cache LRU do servidor**
(`server.js:2917`), de modo que a próxima frase já esteja sintetizada quando a atual
terminar.

### A voz feminina no meio da frase

```js
// assets/voice.js:239
/* ═══ A VOZ FEMININA NO MEIO DA FRASE ═══
   Quando um pedaço falhava, este recurso de emergência assumia — e a segunda
   escolha dele era "qualquer voz pt-BR do sistema", que no Windows costuma
   ser a Maria, feminina. O operador ouvia o ELION virar mulher no meio da
   própria resposta e voltar em seguida.
   Duas correções: primeiro TENTO DE NOVO o servidor, porque a falha costuma
   ser um soluço de rede e não vale trocar de voz por causa dela; e se ainda
   assim falhar, só uso voz masculina. Não havendo nenhuma masculina, prefiro
   ficar em silêncio naquele pedaço a trocar de pessoa no meio da fala — o
   texto continua na tela, e voz trocada assusta mais que voz ausente. */
```

A cadeia de recuperação de um pedaço que falha:

1. `retentarServidor()` — segunda tentativa na mesma rota (`assets/voice.js:249`);
2. `fallbackSpeak()` com `speechSynthesis`, **só com voz masculina**
   (`vozMasculinaDoSistema()`, `assets/voice.js:262`);
3. **silêncio naquele pedaço**, se não houver voz masculina no sistema.

O passo 3 é a decisão interessante: *degradar para o silêncio é melhor que degradar
para a voz errada*, porque o texto continua na tela e a identidade do agente não quebra.

### `genSeq` — invalidar o que está em voo

```js
// assets/voice.js:323
function stopSpeak() {
  genSeq++;                       // invalida tudo que está em voo
  queue.length = 0;
  holdOpen = false;
  if (player) {
    try {
      player.onended = null; player.onerror = null;
      player.pause();
      player.removeAttribute('src'); player.load(); // aborta o download do stream
    } catch {}
  }
  // …
}
```

Todo caminho assíncrono do TTS captura `const mySeq = genSeq` e verifica
`if (mySeq !== genSeq) return` antes de agir. Sem esse contador, um `fetch` de TTS
disparado antes do barge-in voltaria depois dele e falaria por cima da nova resposta.
O `removeAttribute('src') + load()` é o que **realmente** aborta o download de um
stream em andamento; só `pause()` não aborta.

### Os motores no servidor

`handleTTS()` (`server.js:2928`), com streaming progressivo: o áudio começa a tocar
enquanto ainda está sendo sintetizado.

| Ordem | Motor | Chave | Streaming | Observação |
|---|---|---|---|---|
| 1 | OpenAI `gpt-4o-mini-tts` | `OPENAI_API_KEY` | sim | padrão quando há chave e o cliente não pediu voz específica |
| 2 | Edge TTS (Microsoft) | **nenhuma** | sim | rede de segurança gratuita; WebSocket escrito à mão |
| 3 | ElevenLabs | `ELEVENLABS_API_KEY` | não | opcional |

A escolha do motor principal foi **medida**, não suposta (`server.js:2832`):

> Por que este motor virou o principal, e não mais a reserva: medi o primeiro byte de
> áudio em 891 ms contra 1.753 ms do Edge com a voz nativa pt-BR. A OpenAI transmite
> progressivamente (132 pedaços na medição) — não era o caso na implementação antiga,
> que esperava o arquivo inteiro com `arrayBuffer()` e por isso PARECIA lenta. A voz
> melhor é também a mais rápida; não há troca.

Uma vez que o stream começou, não dá para trocar de motor:

```js
// server.js:2967
} catch (e) {
  console.warn('[tts] openai falhou:', e.message);
  // stream já começou: não dá para trocar de motor no meio do áudio
  if (res.headersSent) { try { res.end(); } catch {} return; }
}
```

### A direção de voz também já custou caro

```js
// server.js:2841
/* ⚠ ESTA INSTRUÇÃO JÁ CUSTOU CARO — leia antes de mexer.
   A versão anterior pedia "fale MUITO devagar", "pausas longas e deliberadas",
   "quase sussurrado nos momentos de maior peso" e "não tem pressa nenhuma".
   Funcionava para uma frase dramática — e era insuportável num assistente que
   responde o dia inteiro. Medido: 12,1 caracteres por segundo, contra 15 a 18
   de uma conversa normal em português.
   Pior: a resposta é falada em PEDAÇOS, cada um sintetizado separadamente. Uma
   direção que manda variar o registro ("quase sussurrado nos momentos de maior
   peso") faz o modelo escolher registro DIFERENTE a cada pedaço — e o operador
   ouvia a voz afinar e engrossar no meio da própria frase. */
```

A direção atual (`TTS_DIRECAO`, `server.js:2857`) pede o oposto: **registro fixo**, mesma
altura, mesmo volume, mesma velocidade, *"trate cada trecho como continuação exata do
anterior, na mesma respiração"*. Gravidade vem do timbre, não da lentidão.

E a velocidade foi resolvida por **controle direto**, não por texto:

```js
// server.js:2870
/* A instrução em texto sozinha não bastava: reescrevê-la levou a fala de 12,1
   para apenas 13,1 caracteres por segundo. Quem resolve é o controle direto.
   Varrido com repetição para separar o efeito do ruído entre execuções:
     1,00 → 13,5    1,20 → 15,8    1,25 → 16,9    1,30 → 16,2    1,40 → 17,7
   1,25 é o mais estável dentro da faixa de conversa (15 a 18) e sobra margem
   antes de soar apressado. Ajustável por TTS_SPEED no .env. */
const TTS_VELOCIDADE = Math.min(2, Math.max(0.5, parseFloat(process.env.TTS_SPEED || '1.25')));
```

Lição transferível: **pedir comportamento em linguagem natural quando existe um
parâmetro para ele é o caminho lento**. A instrução textual moveu a métrica em 8%; o
parâmetro moveu 39%.

### A chave do cache

```js
// server.js:2936
/* A voz e a DIREÇÃO da OpenAI entram na chave. Sem elas, trocar TTS_VOICE ou
   afinar a interpretação no .env não teria efeito nenhum nas frases já
   faladas: o cache continuaria servindo o áudio da voz antiga, e pareceria
   que a configuração foi ignorada. */
const key = crypto.createHash('md5')
  .update(JSON.stringify([clean, opts.voice, opts.rate, opts.pitch, TTS_VOZ, TTS_DIRECAO, TTS_VELOCIDADE]))
  .digest('hex');
```

Toda entrada que afeta a saída precisa entrar na chave — inclusive a instrução de
interpretação, que é a que mais parece "configuração" e menos parece "entrada".

### Edge TTS sem dependência nenhuma

`edgeTTSOnce()` (`server.js:2717`) implementa um cliente WebSocket completo em ~90
linhas: `wsEncodeFrame()` monta os quadros mascarados do cliente, `wsParser()`
(`server.js:2683`) decodifica os quadros do servidor **com suporte a fragmentação**
(opcode 0 de continuação) e responde ping com pong.

Dois detalhes operacionais:

- o serviço exige uma versão de Chromium ≥ 132 no cabeçalho, e recusa com **403**
  versões antigas (`EDGE_CHROMIUM`, `server.js:2656`);
- a assinatura `Sec-MS-GEC` é um SHA-256 de um carimbo de tempo arredondado em janelas
  de 5 minutos, o que torna o handshake **sensível ao relógio da máquina**. Um 403 por
  desvio de relógio é detectado e corrigido sozinho:

```js
// server.js:2808
async function edgeTTS(text, opts = {}, onChunk) {
  try {
    return await edgeTTSOnce(text, opts, onChunk);
  } catch (e) {
    if (e.status === 403 && e.serverDate) {
      const skew = Math.round((new Date(e.serverDate).getTime() - Date.now()) / 1000);
      if (Number.isFinite(skew)) {
        console.warn(`[edge-tts] 403 — ajustando relógio em ${skew}s e repetindo`);
        edgeSkewSec = skew;
        return await edgeTTSOnce(text, opts, onChunk);
      }
    }
    throw e;
  }
}
```

O desvio aprendido fica em memória e vale para as chamadas seguintes.

### O que nunca é falado

```js
// assets/voice.js:165
function stripForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' trecho de código exibido na interface. ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>|~]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4200);
}
```

Bloco de código vira uma frase que **aponta para a tela** em vez de ser lido; link vira
o texto do link; marcação e emoji somem.

---

## 11. Calibração — botão direito e toque longo

```js
// assets/voice.js:889
/* ═══════════════════════════════════════════════════════════════════════
   CALIBRAÇÃO NO MICROFONE DE VERDADE

   Existe porque errei: acertei 11 de 11 numa bancada de sons que eu mesmo
   sintetizei e, no microfone do operador, o obriguei a gritar. Números
   escolhidos por mim, num sinal escolhido por mim, provam o algoritmo e não
   provam o produto.

   Aqui o produto se mede sozinho: ouve o silêncio da sala dele, ouve a voz
   dele em volume normal, e ajusta os limiares com folga PARA BAIXO do que
   mediu. Fica guardado entre sessões.
   ═══════════════════════════════════════════════════════════════════════ */
```

`calibrar()` (`assets/voice.js:901`) faz duas coletas: 2,5 s de silêncio e 6 s de fala
normal.

### A porta fica no meio geométrico

```js
// assets/voice.js:933
const fundo = perc(rQuieto, 0.9) || 0.001;        // o ruído da sala, com folga
const voz   = perc(rFala, 0.6);                   // volume típico da fala dele

/* A porta fica no MEIO GEOMÉTRICO entre o ruído e a voz. Fica acima do
   silêncio e bem abaixo da fala — em vez de num número que eu inventei. */
const piso = Math.max(0.0015, Math.min(voz * 0.35, Math.sqrt(fundo * voz) * 0.55));
```

Média **geométrica**, não aritmética, porque as duas grandezas estão em escala de
amplitude e podem diferir por uma ordem de magnitude — a aritmética grudaria no maior
dos dois.

### A calibração só pode afrouxar

```js
// assets/voice.js:955
/* Fico bem ABAIXO do que ele produz, e NUNCA acima do padrão: a calibração
   pode me deixar mais sensível, jamais menos. Se ela pudesse endurecer os
   limiares, um momento ruim de medição trancaria o operador para fora — e
   ficaria gravado. O teto é a proteção contra a minha própria medida. */
novo.clarezaMin = Math.min(VOZ_PADRAO.clarezaMin, Math.max(0.28, +(perc(clarezas, 0.20) * 0.7).toFixed(2)));
novo.riquezaMin = Math.min(VOZ_PADRAO.riquezaMin, Math.max(0.20, +(perc(riquezas, 0.20) * 0.55).toFixed(2)));
```

`Math.min(VOZ_PADRAO.…, …)` é o teto e `Math.max(0.28, …)` é o piso. Um procedimento
automático que grava estado permanente precisa de uma direção proibida — aqui, a
direção "mais restritivo".

### Recusa honesta

```js
// assets/voice.js:937
/* RECUSA HONESTA. Se a sala não estava em silêncio, ou se ele não falou, a
   medida não vale nada — e uma calibração ruim é pior que nenhuma, porque
   fica gravada. Melhor dizer que não deu e manter o que já funcionava. */
if (voz < fundo * 1.6)
  return { ok: false, msg: `não distingui sua voz (…) do ruído da sala (…). ` +
                           `Tente num momento mais silencioso, ou aproxime-se do microfone.` };
```

### A tolerância de oitavas vem da dispersão real

```js
// assets/voice.js:970
/* A tolerância deixa de ser um número meu e passa a ser a DISPERSÃO DELE. */
/* Piso de 0,45 oitava, não menos. Seis segundos de fala calibrando medem
   a voz DAQUELE momento; depois ele vai falar animado, cansado ou rouco,
   e uma tolerância medida no momento calmo o trancaria do lado de fora. */
const espalha = Math.abs(Math.log2(perc(f0s, 0.9) / perc(f0s, 0.1))) / 2;
novo.oitavasMax = +Math.min(0.70, Math.max(0.45, espalha * 1.35 + 0.22)).toFixed(2);
```

### Medição fresca todo quadro

Um defeito de segunda ordem, que fazia a calibração produzir um resultado **pior que o
padrão**:

```js
// assets/voice.js:1086
/* MEDIÇÃO FRESCA TODO QUADRO, inclusive abaixo da porta.
   Sem esta linha, vad.ultimo ficava congelado no último quadro ALTO — e a
   calibração, ao "ouvir o silêncio", relia aquele valor antigo e concluía
   que a sala era barulhenta. O resultado saía pior que o padrão: piso de
   energia 4× mais alto e riqueza mínima 4,8× maior, ou seja, exatamente o
   defeito que a calibração existe para curar. */
```

E a coleta recusa ler a mesma medição duas vezes (`assets/voice.js:905`):

```js
/* Só conta medição NOVA. Guardo o instante de cada uma e recuso repetir a
   mesma — foi assim que a primeira versão desta função encheu a amostra de
   silêncio com o eco de um quadro alto anterior. */
const m = vad.ultimo;
if (m && m.t !== visto) { visto = m.t; amostras.push({ ...m }); }
setTimeout(passo, 10);          // não usa rAF: aba escondida o congelaria
```

### Os dois gestos

**Botão direito no microfone** (`assets/voice.js:1215`):

```js
micBtn?.addEventListener('contextmenu', abreCalibracao);
```

```js
// assets/voice.js:1199
/* BOTÃO DIREITO NO MICROFONE = CALIBRAR.
   Antes este gesto ligava e desligava a exigência do nome. Troquei porque a
   necessidade mudou: com quatro portas de entrada, ninguém mais fica
   trancado do lado de fora — mas a captação continua dependendo do
   microfone e da sala DELE, e é isso que a calibração resolve. */
```

**Toque longo, para quem não tem botão direito** (`assets/voice.js:1217`):

```js
/* TOQUE LONGO — a mesma porta, para quem não tem botão direito.
   A calibração ficava acessível só por clique-direito, e celular não tem.
   Como ela é guardada POR APARELHO (localStorage), o celular precisa da
   dele — e estava trancado do lado de fora. O contextmenu até dispara em
   alguns Android, mas no iPhone abre o menu do sistema em vez disso; por
   isso conto o tempo do toque em vez de confiar nesse evento.
   600 ms com o dedo parado: longo o bastante para não pegar um toque
   normal, curto o bastante para não parecer travamento. */
```

Três detalhes de implementação que fazem o gesto funcionar de verdade:

- `touchmove` com deslocamento > 12 px **cancela** — é rolagem, não toque longo;
- `touchend` com `longo === true` chama `preventDefault()` e `stopPropagation()`, senão
  o mesmo gesto também ligaria o modo conversa;
- `touchstart`/`touchmove` são `{ passive: true }`; só o `touchend` não é, porque
  precisa cancelar.

O que a calibração grava em `localStorage`:

| Chave | Conteúdo |
|---|---|
| `elx.voz.calib` | JSON com `pisoMin`, `ganhoPiso`, `clarezaMin`, `riquezaMin`, `oitavasMax` |
| `elx.voz.f0` | altura fundamental medida do operador, em Hz |
| `elx.exigirNome` | `'0'` desliga a porta das quatro entradas |

---

## 12. Biometria vocal — `assets/voiceid.js`

Módulo separado, para responder **quem** está falando (não *se* alguém falou).

Três descritores: F0 por autocorrelação (mesmo método de McLeod), **LTAS** — espectro
médio de longo prazo em 20 bandas logarítmicas de 120 Hz a 7 kHz — e formantes médios
F1/F2/F3, que dependem do comprimento do trato vocal e separam adulto de criança mesmo
quando o pitch se aproxima.

```js
// assets/voiceid.js:280
/* Usa correlação de PEARSON, não cosseno simples: todo espectro de voz tem a
   mesma forma geral (energia caindo com a frequência), então o cosseno dá
   score alto até para pessoas diferentes. Pearson compara os vetores
   CENTRADOS — ou seja, o desvio de cada um em relação à própria média —,
   realçando a assinatura individual em vez da forma comum. */
```

A pontuação final pesa timbre 0,45, pitch 0,35 e trato vocal 0,20, com um filtro rígido
de pitch antes de tudo (`F0_GATE = 0.38` oitavas: fora da faixa, nem compara o resto).

Afirmar um nome exige **duas** condições:

```js
// assets/voiceid.js:395
/* Só AFIRMA o nome com score alto E vantagem clara sobre o 2º. Sem a
   margem, duas pessoas de voz parecida (irmãos de idade próxima) fariam
   o sistema cravar um nome no cara ou coroa. */
if (melhor && score >= SIM_OK && margem >= MARGEM) { /* … */ }
```

`SIM_OK = 0.90`, `MARGEM = 0.03`. Entre `SIM_DUVIDA = 0.82` e `SIM_OK`, o agente é
instruído a **perguntar** em vez de chutar.

### Trava contra contaminação do perfil

```js
// assets/voiceid.js:345
/* TRAVA CONTRA CONTAMINAÇÃO DO PERFIL.
   Sem isto, QUALQUER voz captada entra na média. Foi o que estragou o
   perfil do operador: 126 Hz (ele) somado a 207 Hz (voz alheia que o
   microfone pegou junto) virou um centroide de 167 Hz — que não
   reconhece nem um nem outro. Uma amostra fora do tom do perfil é
   recusada em vez de diluir o que já estava certo. */
```

Um perfil por centroide é frágil a amostras contaminadas: uma única inclusão errada
degrada o perfil para **todo mundo**, e o sistema fica pior do que estava.

### Silenciar a escuta inteira ao gravar

```js
// assets/voiceid.js:205
/* 2) SILENCIAR A ESCUTA INTEIRA enquanto grava.
   Parar só o STT não bastava: o detector de barge-in (VAD) continuava
   ouvindo, escutava a PESSOA SENDO CADASTRADA e disparava interrupção —
   o cadastro morria em ~5s com "transmissão interrompida pelo operador".
   O mesmo vale no modo AO VIVO, onde o áudio seguia sendo enviado. */
```

### Privacidade

Os dados biométricos ficam em `data/voices.json`, que está no `.gitignore` e **nunca sai
da máquina**. O código que identifica qual dos perfis é o do operador
(`carregaVozOperador`, `assets/voice.js:1002`) contém o primeiro nome dele numa
expressão regular; aqui ele aparece **redigido por privacidade**:

```js
const dono = (voices || []).find(v => /operador|[nome do operador]|dono/i.test(`${v.relacao} ${v.nome}`))
          || (voices || [])[0];
```

A altura medida **na calibração** tem preferência sobre a do cadastro, porque veio do
mesmo microfone, na mesma sala, no mesmo volume de conversa real.

---

## 13. Suspender e retomar a audição

```js
// assets/voice.js:2064
/* ═════════ SUSPENDER/RETOMAR AUDIÇÃO — usado pelo Monitor de vídeo ═════════
   Quando um vídeo toca no monitor, o som vaza pelos alto-falantes e o
   microfone capta essa voz como se fosse o operador (falso barge-in, ele
   "ouve" o vídeo e reage). Solução: desligar de vez a captação (STT + VAD +
   a faixa de áudio do modo AO VIVO) enquanto o vídeo toca, e só devolver
   quando o operador pedir a palavra (push-to-talk) ou fechar o monitor. */
```

O cancelamento de eco do navegador cobre a **própria voz sintetizada do agente**, mas
não o áudio arbitrário de um vídeo — daí a suspensão explícita.

A trava tem de ficar dentro de `startSTT()`, não em quem chama:

```js
// assets/voice.js:592
/* TRAVA DA SUSPENSÃO — precisa ficar AQUI, não em quem chama.
   O laço da conversa religa o STT sozinho por temporizador (~300ms) em
   dois pontos. Sem esta linha, suspendListening() era desfeito logo em
   seguida e a escuta voltava: no cadastro de voz o VAD interrompia a
   própria pessoa sendo gravada, e no monitor o áudio do vídeo vazava de
   volta para o agente. resumeListening() limpa a flag ANTES de chamar,
   então o retorno normal continua funcionando. */
if (listenSuspended) return;
```

Quando um estado é restabelecido por temporizadores espalhados, a guarda pertence ao
ponto de entrada — não a cada chamador.

`pushToTalkOnce()` (`assets/voice.js:2087`) escuta **um** comando com o vídeo em pausa, e
chama `renovaConversa()` antes: *"apertar para falar é endereçamento explícito: dispensa
o nome."*

---

## 14. Ganchos de verificação

Todo o subsistema é exposto em `ELX.voice.escuta` (`assets/voice.js:2113`) — e a
justificativa é metodológica:

```js
/* ESCUTA SELETIVA — exposta para verificação e para o operador comandar.
   As decisões de "isto é comigo?" e "isto é voz dele?" são invisíveis por
   natureza: sem um gancho, só dá para testá-las falando perto do
   computador e torcendo — o que é demonstração, não medida. */
```

```js
/* vadStart/vadStop expostos para VERIFICAÇÃO: trocando o microfone por
   um som sintético dá para medir o detector REAL — o de produção, com o
   AnalyserNode de verdade — em vez de uma reimplementação de bancada
   que pode divergir dele. Sem este gancho, testar "o cachorro late e o
   ELION não para de falar" exigiria um cachorro. */
```

```js
/* Seam de VERIFICAÇÃO do portão do AO VIVO. Sem ele, provar que uma
   tosse não corta a fala exigiria abrir uma sessão paga da OpenAI, ter
   microfone de verdade e tossir na hora certa. */
simularLive(falando) { live.on = true; live.falando = !!falando; return { on: live.on, falando: live.falando }; },
```

| Gancho | Para quê |
|---|---|
| `escuta.chamouPeloNome(t)`, `paraMim(t)`, `soOChamado(t)`, `falaComigo(t)` | as decisões de endereçamento, testáveis por texto |
| `escuta.vadStart()` / `vadStop()` | o detector **de produção**, alimentável por som sintético |
| `escuta.simularLive(bool)` / `pararSimulacao()` | o portão do AO VIVO sem abrir sessão paga |
| `escuta.medindo` | leitura ao vivo de `rms`, `f0`, `clareza`, `riqueza` |
| `escuta.calibracao`, `recalibrarDoZero()` | inspecionar e zerar o estado gravado |
| `escuta.ignoradas`, `ruidosCalados`, `disparos` | contadores: o que foi barrado, o que foi calado, o que disparou |
| `escuta.limiares` | o objeto `VOZ` vivo |
| `voice.execTool(nome, args)` | o executor de ferramentas do AO VIVO, sem microfone |

O princípio: **onde a decisão é invisível, exponha a costura**. Um teste que exige um
cachorro latindo não é um teste.

---

## 15. Configuração

Só os **nomes** das variáveis. Nenhum valor de chave aparece neste repositório nem
neste documento.

| Variável | Obrigatória | Para quê | Onde obter |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | sim | laço agêntico do modo texto/microfone | console.anthropic.com |
| `OPENAI_API_KEY` | para o AO VIVO e o TTS principal | Realtime + `gpt-4o-mini-tts` | platform.openai.com |
| `ELEVENLABS_API_KEY` | não | terceiro motor de TTS | elevenlabs.io |
| `ELEVENLABS_VOICE_ID` | não | timbre do ElevenLabs | painel do ElevenLabs |
| `TTS_VOICE` | não | timbre da síntese principal | — |
| `TTS_SPEED` | não | velocidade da fala (padrão 1,25) | — |
| `TTS_DIRECAO` | não | direção de interpretação passada ao sintetizador | — |
| `LIVE_VOICE` | não | timbre do modo AO VIVO (padrão `cedar`) | — |
| `EDGE_VOICE` | não | timbre do Edge TTS (padrão `pt-BR-AntonioNeural`) | — |

O Edge TTS **não usa chave**: ele se autentica com um token público embutido no recurso
de leitura em voz alta do próprio navegador Edge (constante `EDGE_TOKEN`,
`server.js:2654`) mais a assinatura temporal `Sec-MS-GEC`. É por isso que ele serve de
rede de segurança: continua funcionando mesmo sem nenhuma conta configurada.

O modo AO VIVO exige **créditos** na conta OpenAI. O erro é traduzido em vez de
repassado cru (`assets/voice.js:1990`):

```js
if (e.quota) {
  ELX.toast?.('Modo AO VIVO exige créditos na conta OpenAI (platform.openai.com → Billing). O modo conversa 🎤 continua gratuito.', 'red');
  ELX.voice?.speak('Senhor, o modo ao vivo requer créditos na conta OpenAI, que estão esgotados no momento. Sugiro o modo conversa pelo microfone — gratuito e com a mesma inteligência.');
}
```

Há também um *cooldown* de 4 s no botão, *"evita marteladas no botão (e rate-limit em
cima de rate-limit)"*.

---

## 16. Tabela dos defeitos corrigidos

Todo item abaixo é um defeito real, relatado pelo operador ou medido, com a correção no
código citado.

| Defeito | Causa | Correção | Onde |
|---|---|---|---|
| Responde a conversa alheia, à TV, ao cachorro | nenhuma porta entre transcrição e agente | quatro portas de `paraMim()` | `voice.js:512` |
| Cadeira/copo/teclado cortam a fala | detector media só energia | 4 provas: periodicidade, riqueza, altura, sustentação | `voice.js:1046` |
| Bipe do micro-ondas interrompe | tom puro tem clareza 1,00 | razão formantes/fundamental ≥ 0,70 | `voice.js:814` |
| Tosse corta a fala | `vozMs` era 130 ms; tosse dura 231 ms | `vozMs` = 300 ms (520 ms no AO VIVO) | `voice.js:747` |
| Risada de criança interrompe | é voz de verdade | prova 3: altura em oitavas, ±0,55 | `voice.js:1078` |
| "Elton"/"Elias"/"Hélio" viram chamado | distância de edição sem exceções | lista `NAO_E_ELE` + regra da troca única | `voice.js:383` |
| "li on-line" vira chamado | juntava qualquer par de tokens | só junta quando o corte é plausível | `voice.js:415` |
| Repete a mesma saudação duas vezes | chamado tratado como pedido; modelo copiava o histórico | `soOChamado()` + resposta local sorteada sem repetir | `voice.js:452` |
| Para de ouvir com a aba minimizada | `rAF` congela, `setInterval` é estrangulado | `ScriptProcessorNode` como relógio | `voice.js:1034` |
| Exige 3,75 s de fala contínua | duração do quadro **suposta** em 21,3 ms | `dt` medido por batida, teto de 120 ms | `voice.js:1135` |
| "Preciso gritar" | limiares calibrados em bancada sintética | limiares permissivos + calibração no microfone real | `voice.js:742`, `901` |
| "Preciso gritar" só no AO VIVO | faltava `autoGainControl` só nesse `getUserMedia` | adicionado | `voice.js:1866` |
| Calibração piora os limiares | `vad.ultimo` congelava no último quadro alto | medição fresca todo quadro + recusa de amostra repetida | `voice.js:1086`, `905` |
| Barge-in envia meia frase | `onend` dispara também no `abort()` | marca `__descartar` antes de abortar | `voice.js:620` |
| Ruído meio-ouvido vira comando | usava o texto provisório do reconhecedor | só texto final, ou provisório com ≥ 12 caracteres | `voice.js:625` |
| Interrompe 7 vezes em 1,4 s | sem trava entre disparos | trava de 1200 ms | `voice.js:1158` |
| Voz vira feminina no meio da frase | recurso de emergência pegava qualquer voz pt-BR | retenta o servidor, depois só voz masculina, senão silêncio | `voice.js:249`, `262` |
| Voz afina e engrossa entre frases | pedaços iguais de 420 + direção pedindo variar registro | 1º pedaço 220, demais 1200; direção de registro fixo | `voice.js:297`, `server.js:2857` |
| Fala lenta demais (12,1 car./s) | lentidão escrita na direção de voz | direção reescrita + `speed` 1,25 → 16,9 car./s | `server.js:2870` |
| Trocar `TTS_VOICE` não tem efeito | cache não incluía voz nem direção na chave | chave passa a incluir ambas | `server.js:2936` |
| Handshake do Edge TTS dá 403 | relógio da máquina fora de sincronia | aprende o desvio pelo cabeçalho `Date` e repete | `server.js:2808` |
| AO VIVO para no meio e não volta | `create_response: true` abria turno novo a cada som | portão do microfone fechado enquanto ele fala | `voice.js:1920` |
| AO VIVO fica mudo de vez | evento de fim de resposta perdido | cão de guarda reabre após 30 s | `voice.js:1291` |
| AO VIVO atrasa cada frase | transcrição no caminho crítico | responder na hora e cancelar depois | `voice.js:1897` |
| Conversa alheia vira contexto | cancelar a resposta não apaga o item | `conversation.item.delete` | `voice.js:1916` |
| Ferramenta "fora do ar" só na voz | anunciada ao modelo sem executor no cliente | executores em `liveExecToolNucleo` | `voice.js:1572` |
| Vídeo do monitor vira comando | eco cobre a voz do agente, não áudio arbitrário | `suspendListening()` + trava dentro de `startSTT()` | `voice.js:2064`, `592` |
| Cadastro de voz morre em 5 s | VAD ouvia a própria pessoa sendo gravada | `suspendListening()` durante a captura | `voiceid.js:205` |
| Perfil de voz deixa de reconhecer o dono | centroide contaminado (126 Hz + 207 Hz = 167 Hz) | recusa amostra a mais de 0,45 oitava do perfil | `voiceid.js:345` |
| Voz aguda lida como grave | máximo global da autocorrelação cai nos submúltiplos | primeiro pico qualificado (McLeod) | `voice.js:781`, `voiceid.js:106` |
| Calibração inacessível no celular | só existia por `contextmenu` | toque longo de 600 ms, com cancelamento por rolagem | `voice.js:1217` |

---

## 17. Os cinco princípios que este subsistema ensina

1. **Bancada sintética mede o algoritmo; só o microfone de verdade mede o produto.**
   11/11 de acerto em sons gerados por quem escreveu o detector, e o operador gritando
   na vida real.
2. **Meça o tempo, nunca o suponha.** Uma constante de 21,3 ms virou uma exigência de
   3,75 segundos de fala contínua quando a premissa mudou por baixo.
3. **Erros de custo diferente merecem limiares diferentes.** A mesma prova roda com
   300 ms no microfone e 520 ms no AO VIVO, porque lá cortar por engano destrói a
   resposta inteira.
4. **Mais rápido errar e corrigir do que fazer todo mundo esperar pela certeza** — desde
   que o erro seja reversível e a pessoa esteja esperando.
5. **Onde a decisão é invisível, exponha a costura.** "Isto é comigo?" e "isto é a voz
   dele?" não têm saída observável; sem um gancho, testá-las é demonstração, não medida.

---

## Referências no código

| Assunto | Arquivo | Linha |
|---|---|---:|
| Taps de análise (esfera e lip-sync) | `assets/voice.js` | 21 |
| Análise vocálica / formantes | `assets/voice.js` | 72 |
| Limpeza de texto para fala | `assets/voice.js` | 165 |
| Fila de TTS e `playNext` | `assets/voice.js` | 209 |
| Retentativa + fallback masculino | `assets/voice.js` | 249, 262 |
| Tamanhos de pedaço | `assets/voice.js` | 297 |
| `CHAMADO` e janela de conversa | `assets/voice.js` | 361 |
| `NOMES` / `NAO_E_ELE` | `assets/voice.js` | 382 |
| `chamouPeloNome` | `assets/voice.js` | 411 |
| `soOChamado` / `atender` | `assets/voice.js` | 452, 483 |
| `paraMim` — as quatro portas | `assets/voice.js` | 512 |
| `falaComigo` + as quatro regex | `assets/voice.js` | 546 |
| `startSTT` e os dois descartes | `assets/voice.js` | 590 |
| Estado do VAD | `assets/voice.js` | 712 |
| Limiares `VOZ_PADRAO` | `assets/voice.js` | 742 |
| `vadAltura` (McLeod) | `assets/voice.js` | 781 |
| `vadRiqueza` | `assets/voice.js` | 814 |
| `vadStart` — captação crua | `assets/voice.js` | 826 |
| `calibrar` | `assets/voice.js` | 901 |
| Relógio de áudio | `assets/voice.js` | 1020 |
| `vadLoop` — o laço de decisão | `assets/voice.js` | 1046 |
| `donoDaFala` / `bargeIn` | `assets/voice.js` | 1177, 1189 |
| Calibração por gesto | `assets/voice.js` | 1199, 1217 |
| Portão do microfone do AO VIVO | `assets/voice.js` | 1279, 1291 |
| Executores das 47 ferramentas | `assets/voice.js` | 1317, 1338 |
| `liveStart` — WebRTC | `assets/voice.js` | 1849 |
| Supressão depois / portão | `assets/voice.js` | 1897, 1920 |
| Suspender / retomar audição | `assets/voice.js` | 2064 |
| API pública `ELX.voice` | `assets/voice.js` | 2096 |
| Locutor incremental | `assets/agent.js` | 263 |
| `responderLocal` | `assets/agent.js` | 346 |
| Cliente WebSocket do Edge TTS | `server.js` | 2669, 2683 |
| `edgeTTSOnce` / correção de relógio | `server.js` | 2717, 2808 |
| `TTS_VOZ` / `TTS_DIRECAO` / `TTS_VELOCIDADE` | `server.js` | 2840, 2857, 2876 |
| `openaiTTS` / `handleTTS` | `server.js` | 2880, 2928 |
| `LIVE_TOOL_NAMES` (47) | `server.js` | 4248 |
| `handleLiveSession` / `turn_detection` | `server.js` | 4253, 4313 |
| Rota `/api/tts` | `server.js` | 4430 |
| Biometria vocal completa | `assets/voiceid.js` | 1–436 |

Visão geral da plataforma e das outras camadas: [`docs/ARQUITETURA.md`](ARQUITETURA.md).
