# PACTO — diagnóstico de negociação pós-reunião

> Você sai da reunião e, antes de chegar ao carro, já tem o diagnóstico da
> negociação, a estratégia do retorno e os próximos passos.

Este documento cobre a **Fase 0** (o "cérebro", só software). O dispositivo
portátil vem nas fases seguintes; até lá, o próprio celular grava pela aba
**GRAVAR AGORA** e faz o papel dele.

## Roteiro do produto

| Fase | Entrega | Critério para avançar |
|---|---|---|
| **0 · Cérebro** ✅ | Áudio ou transcrição → relatório → email/WhatsApp | 5 reuniões reais com relatório útil, avaliado pelo operador |
| 1 · Protótipo | Firmware no Seeed XIAO ESP32S3 Sense: gravar no microSD e enviar por Wi-Fi | 1 h de gravação limpa; bateria para um dia |
| 2 · Ponte celular | PWA com Bluetooth, fila offline, envio pelo 4G/5G | Funciona sem Wi-Fi |
| 3 · Produto | Carcaça, placa própria, bateria definitiva | 10 unidades com usuários piloto |
| 4 · Lançamento | Homologação Anatel, termos LGPD, preço | Piloto B2B pago |

## Como usar

1. No `.env`: `ANTHROPIC_API_KEY` (já existente) e, para áudio, `ASSEMBLYAI_API_KEY`
   (ou `PACTO_STT=deepgram` + `DEEPGRAM_API_KEY`).
2. `npm start` e abra `http://localhost:3001/pacto.html`.
3. Preencha o contexto, escolha a entrada (arquivo, gravar agora ou colar
   transcrição), confirme o aviso de gravação e clique em **ANALISAR REUNIÃO**.
4. Para receber por email: reautorize o Gmail em `/oauth/google/start` (o envio
   precisa do escopo `gmail.send`, que não existia antes do PACTO).

**Sem chave de transcrição?** Use **COLAR TRANSCRIÇÃO** (uma fala por linha,
`Nome: fala`). Serve também para reuniões já transcritas pelo Teams ou Meet.

## Pipeline — o que acontece e por quê

```
entrada ─► transcrição ─► métricas ─► análise (Claude) ─► verificação ─► relatório ─► entrega
           (adaptador)    (código)    (JSON Schema)       das citações   HTML/texto   nível 4/5
```

| Etapa | Onde | Decisão de engenharia |
|---|---|---|
| Upload do áudio | `salvarAudio` | Grava em disco por streaming: 1 h de WAV passa de 100 MB e não cabe no `readBody` de 45 MB do servidor. |
| Transcrição | `transcrever` | **Adaptador**: AssemblyAI ou Deepgram atrás da mesma saída `{falante, inicio, fim, texto}`. Trocar de fornecedor é mudar uma variável. O Claude não transcreve áudio; isso é tarefa de um serviço de STT. |
| Áudio apagado | `processar` | *Privacy-first*: depois de transcrever, o áudio é apagado (`PACTO_MANTER_AUDIO=1` mantém, para comparar provedores). |
| Métricas | `medir` | Proporção de fala, perguntas e palavras por falante são **medidas em código** e passadas ao modelo como fato. O que dá para medir não fica a cargo de estimativa. |
| Análise | `claudeEstruturado` | Saída estruturada (`output_config.format` com JSON Schema): a API garante o formato. Streaming porque relatório longo com raciocínio pode estourar o tempo limite. `fallbacks: "default"` refaz em outro modelo se o principal recusar. |
| Verificação | `verificarCitacoes` | A regra anti-alucinação **aplicada em código**: toda citação é procurada na transcrição (ignorando acento e pontuação). A que não bate aparece em laranja como "não verificada". |
| Relatório | `relatorioHTML` | Estilos *inline*, porque clientes de email ignoram `<style>`. Legível no celular. |
| Entrega | rota `/enviar` | Para o próprio operador é **nível 4** (reversível). Para terceiros é **nível 5**: exige confirmação explícita e envia só a **ata**. |

## As três regras que protegem o produto

1. **Analisa o que foi dito, nunca rotula quem a pessoa é.** Nada de perfil
   psicológico, "está mentindo" ou estado emocional. Isso não tem base confiável
   a partir de uma transcrição, expõe o operador à LGPD, e o AI Act europeu
   proíbe reconhecimento de emoções no trabalho.
2. **Sem citação verificável, a afirmação não vale.** O prompt exige a citação e
   o código confere.
3. **A estratégia nunca sai da empresa.** O envio a terceiros manda só a ata:
   promessas e próximos passos que não são exclusivamente nossos. Objeções,
   BATNA, limite de concessão e autoavaliação ficam com o operador.

## O que o relatório contém

Resumo executivo · participação medida · mapa de decisão (decisor,
influenciador, bloqueador) · interesses × posições · objeções com resposta
pronta · sinais de compromisso (forte, moderado, evasivo) · promessas ·
playbook do retorno (entregáveis, abertura, perguntas, BATNA, limite de
concessão, riscos) · autoavaliação · lacunas · próximos passos com o nível do
dial de autonomia.

## API

| Método | Rota | Função |
|---|---|---|
| GET | `/api/pacto/status` | O que está configurado (Claude, STT, Gmail, WhatsApp) |
| GET | `/api/pacto/reunioes` | Lista as reuniões |
| POST | `/api/pacto/reunioes` | Cria `{contexto, consentimento: true, transcricao?}`; com transcrição, já analisa |
| PUT | `/api/pacto/reunioes/:id/audio` | Corpo = áudio bruto; inicia a transcrição |
| GET | `/api/pacto/reunioes/:id` | Estado, transcrição, métricas e relatório (JSON) |
| GET | `/api/pacto/reunioes/:id/relatorio` | Relatório em HTML |
| POST | `/api/pacto/reunioes/:id/enviar` | `{canal: "email"\|"whatsapp", destino?, confirmar?}` |
| DELETE | `/api/pacto/reunioes/:id` | Apaga reunião, transcrição e relatório |

Os dados ficam em `data/pacto/<id>/`, que já está no `.gitignore`.

## Como validar a Fase 0 (o critério para avançar)

1. **Escolha do STT:** passe os mesmos 3 áudios pela AssemblyAI e pela Deepgram
   (`PACTO_MANTER_AUDIO=1`) e conte, em cada um, os **erros de atribuição de
   falante** e os termos de negócio errados. Vence quem errar menos quem disse o quê.
2. **Qualidade do relatório:** em 5 reuniões reais, avalie de 1 a 5:
   as objeções estão todas lá? O playbook é algo que você usaria? Alguma
   afirmação sem base? Meta: média 4 e citações verificadas acima de 90%.
3. Só depois disso compre o hardware da Fase 1.

## Limites conhecidos da Fase 0

- **Sem autenticação própria**, como o resto do ELION-X: está protegido apenas
  por rodar localmente. Ao expor pelo túnel do celular, qualquer pessoa com a URL
  acessa as reuniões. Adicionar autenticação é pré-requisito antes de uso fora de casa.
- Se o servidor reiniciar durante uma análise, a reunião fica parada em
  "transcrevendo" ou "analisando". Apague e reenvie.
- **WhatsApp** usa `whatsapp-web.js`, não oficial: serve para enviar a você
  mesmo. Para produto comercial, o caminho é a WhatsApp Business Cloud API.
- Reuniões muito longas (várias horas) podem exceder o tamanho de uma resposta;
  nesse caso o erro diz isso explicitamente.
