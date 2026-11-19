---
name: video-kb
description: Base de conhecimento persistente de vídeos (video knowledge base). Converte cada vídeo assistido com a skill `watch` em uma nota markdown pesquisável (resumo, linha do tempo com timestamps, conhecimento extraído, texto de slides e código) e consulta essas notas antes de responder ou de reassistir. Use sempre que um vídeo for assistido ou analisado (para salvá-lo); quando o usuário pedir para salvar, guardar, aprender com ou transformar um vídeo em conhecimento; e quando ele perguntar sobre algo que pode ter aparecido em um vídeo já visto ("o que aquele vídeo dizia sobre...", "já vimos algo sobre Kafka?", "segundo a palestra de ontem..."), mesmo sem mencionar a base.
---

# video-kb

A skill `watch` dá olhos, mas não memória: o relatório dela vive num diretório
temporário que deve ser apagado, e eu não lembro de nada entre sessões. A única
memória durável são arquivos. Esta skill fecha o ciclo: cada vídeo vira uma nota
com evidência datada, e perguntas futuras são respondidas a partir das notas. É
mais rápido, mais barato (sem reprocessar frames) e citável.

`SKILL_DIR` é o diretório deste SKILL.md. Use `python3` (no Windows, `python` ou `py -3`).

## Onde fica a base, e por que isso importa

```bash
python3 "$SKILL_DIR/scripts/kb.py" root
```

- Padrão: `<repo>/data/video-kb/`. No ELION-X, `data/` é ignorada pelo git (dados
  pessoais), então a base é **privada**. Numa sessão em nuvem, porém, o container
  é descartado e a pasta vai junto; o comando avisa quando for o caso.
- Para durabilidade, o usuário aponta `VIDEO_KB_DIR` para um local privado e
  persistente (checkout de um repositório **privado**, pasta sincronizada).
- O ELION-X é um repositório **público**. Por isso `new` e `reindex` se recusam
  (código 4) a gravar onde o git versionaria as notas. Só use `--allow-versioned`
  depois que o usuário confirmar que aquele repositório é privado: resumo de
  reunião, material de cliente ou do empregador publicado no GitHub é vazamento
  irreversível.

## Fluxo 1: assistir e salvar

1. **Já está na base?** `kb.py find "<URL ou caminho>"`. Links do YouTube são
   reconhecidos em qualquer formato; arquivos locais, pelo hash do conteúdo. Se
   houver nota, responda a partir dela. Reassista só se a pergunta exigir algo
   que a nota não cobre, e então use a linha do tempo dela para focar
   (`--start`/`--end`) em vez de reprocessar o vídeo inteiro.
2. **Assista** seguindo a skill `watch` (leia o SKILL.md dela): veja todos os
   frames e leia a transcrição.
3. **Crie a nota** (imprime o caminho; código 3 = fonte já registrada, e o
   caminho existente é impresso):
   ```bash
   python3 "$SKILL_DIR/scripts/kb.py" new --title "<título>" --source "<URL ou caminho>" \
     --duration MM:SS --uploader "<canal>" --engine local --detail balanced \
     --evidence "frames+transcript" --language pt --tags "iot,kafka" --confidentiality interno
   ```
4. **Preencha** cada seção substituindo os comentários `<!-- -->` pelo conteúdo,
   seguindo as regras abaixo.
5. **Reindexe:** `kb.py reindex`.
6. **Limpe** apenas o *Work dir* que o `watch` criou nesta execução. Frames não
   entram na base: custam disco e tokens, e podem conter dados sensíveis.
7. **Informe** ao usuário o caminho da nota, para que ele saiba que foi salva e
   possa pedir o contrário.

Salvar é o padrão porque é isso que o usuário quer para os vídeos que assiste.
Não salve quando ele disser que não, nem quando o vídeo for claramente
descartável (um clipe de teste, por exemplo).

## Fluxo 2: consultar

Quando a pergunta puder ter resposta em um vídeo já visto:

1. Leia o `INDEX.md` na raiz da base.
2. Procure termos nas notas (`Grep` em `<raiz>/notes/`), incluindo sinônimos e
   os termos em inglês.
3. Responda citando a nota e os timestamps, por exemplo: "segundo a nota
   `2026-11-19-arquitetura-iot.md`, [00:04]...". Deixe claro que a resposta vem
   das notas, não de uma nova visualização.
4. Se nada for encontrado, diga isso. Não invente conteúdo de vídeo.

## Como escrever a nota

Uma nota vale pelo que dá para verificar depois. Por isso:

- **Fato com timestamp.** Todo item de "Conhecimento extraído" e "Evidência
  visual" termina com `[MM:SS]`. Sem timestamp, não é evidência.
- **Separe o visto, o dito e o interpretado.** O visual vem dos frames e a fala
  da transcrição. Inferências ficam só em "Aplicação e insights", rotuladas.
- **Transcreva o texto da tela com fidelidade**: slides, código, números, nomes
  de serviços. Se estiver ilegível, diga.
- **Segredos nunca entram.** Gravações de tela mostram tokens, senhas, chaves de
  API, QR codes e dados pessoais. Substitua por `[REDACTED: tipo]`.
- **Citações curtas.** No máximo 5 trechos de até 25 palavras. A transcrição
  integral de vídeo de terceiros não entra (direito autoral). Para vídeo do
  próprio usuário (reunião, aula interna), só entra se ele pedir, em
  `transcripts/<nome-da-nota>.md`.
- **Lacunas explícitas:** sem legenda, fallback desligado, frames esparsos em
  vídeo longo, trecho focado. Resposta do motor Gemini usa `--evidence gemini`:
  são observações do Gemini, não frames que você viu, e a nota precisa dizer isso.
- **Sigilo:** `publico` (conteúdo aberto), `interno` (padrão) ou `confidencial`
  (cliente, empregador, dados pessoais). Na dúvida, `confidencial`.

## Manutenção

- Reassistiu com outro foco? Atualize a nota existente (linha do tempo e
  conhecimento) em vez de criar outra.
- Rode `kb.py reindex` depois de criar, editar ou apagar notas.
- Estrutura: `INDEX.md` (gerado), `notes/AAAA-MM-DD-slug.md` e `transcripts/`
  (opcional).
