# Procedência: skill `watch` (vendorizada)

| Campo | Valor |
|---|---|
| Origem | https://github.com/bradautomates/claude-video (subpasta `skills/watch/`) |
| Versão | 0.3.2 |
| Commit fixado | `03ceb42f7fa2c4439aca01752118044baabffb8f` |
| Licença | MIT, Copyright (c) 2026 Bradley Bonanno (ver `LICENSE`) |
| Vendorizada em | 2026-11-19 |

`SKILL.md`, `scripts/*.py` e `LICENSE` são **cópias byte a byte** do upstream nesse
commit. Não edite estes arquivos: qualquer mudança quebra a verificação de
integridade e mistura código de terceiros com código próprio. Extensões (como a
base de conhecimento) ficam em `.claude/skills/video-kb/`.

## Por que vendorizada, e não instalada como plugin

- **Versão fixa.** O plugin do marketplace acompanha o `main` do autor: um push
  futuro (ou uma conta comprometida) passaria a rodar no seu shell sem revisão.
  Aqui só roda o código revisado.
- **Persistência.** Containers de nuvem são efêmeros; o que está no repositório
  volta em toda sessão, local ou na nuvem.
- **Sem execução automática.** O plugin registra um hook `SessionStart` que roda
  código a cada início de sessão. A cópia vendorizada não inclui `hooks/`.

Fora do runtime e não incluídos: `hooks/`, `tests/`, `.github/`, manifestos
Codex/Agents, `scripts/build-skill.sh` e as imagens da documentação.

## Revisão de segurança (2026-11-19)

Escopo: leitura integral do `SKILL.md` e dos 10 scripts.

- Python só com a biblioteca padrão; `subprocess` sempre com lista de argumentos
  (sem `shell=True`, `eval`, `exec`, `pickle` ou ofuscação).
- A URL de origem é passada ao `yt-dlp` depois de `--`, e `is_url()` rejeita
  valores iniciados por `-`, o que impede injeção de argumentos.
- Saída de rede: o site do vídeo (via yt-dlp) e, **somente se configurados**,
  `generativelanguage.googleapis.com` (Gemini), `api.groq.com` e `api.openai.com`.
  O instalador opcional do WhisperX baixa de PyPI, `download.pytorch.org`,
  Hugging Face e `astral.sh`.
- O arquivo de configuração é criado com modo 0600, e as chaves não vão para log.
- Suíte upstream: 249/249 testes passando (Python 3.13.18, FFmpeg 6.1.1,
  yt-dlp 2026.10.26).

Riscos residuais, mitigados pela configuração padrão `WATCH_ENGINE=local` e
`WATCH_WHISPER_BACKEND=none`:

1. **Chave de outro projeto usada sem aviso.** `config.py` também procura
   `GEMINI_API_KEY`, `GROQ_API_KEY` e `OPENAI_API_KEY` no `.env` do diretório
   atual. O `.env.example` do ELION-X prevê `OPENAI_API_KEY`: com o backend
   `auto` ou `openai`, o áudio do vídeo iria para a OpenAI, cobrado na chave do
   ELION-X.
2. **Upload para o Google.** Com o motor `auto` e uma `GEMINI_API_KEY`
   encontrável, vídeos locais são enviados ao Files API do Google (apagados ao
   fim; se a exclusão falhar, expiram em 48 h).
3. **`curl … | sh` em duas etapas.** `setup.py --install-whisperx` baixa e
   executa o instalador do `uv` (astral.sh) quando ele não existe. Só roda se
   você pedir WhisperX.
4. **Vídeo é dado não confiável.** Legendas e frames podem conter instruções; o
   `SKILL.md` já manda tratá-los como evidência, nunca como comando.
5. **`allowed-tools: Bash, Read, AskUserQuestion` no frontmatter.** Enquanto a
   skill estiver ativa, o Claude Code pode usar essas ferramentas sem pedir
   permissão, e Bash é uma concessão ampla. O fluxo revisado só roda os scripts
   da própria skill; se quiser aprovação manual de cada comando, essa linha é o
   ponto a ajustar (o que exigiria divergir do upstream).

## Verificar a integridade

```bash
cd .claude/skills/watch && sha256sum -c UPSTREAM.sha256
```

## Atualizar para uma versão nova

1. Clone o upstream no commit ou tag desejado.
2. `diff -r` entre `skills/watch/` do upstream e esta pasta; revise cada mudança
   (hosts de rede novos, `subprocess`, leitura de credenciais).
3. Copie `SKILL.md` e `scripts/*.py`, atualize a tabela acima e regenere o
   `UPSTREAM.sha256`.
