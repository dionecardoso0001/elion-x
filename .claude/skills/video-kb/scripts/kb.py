#!/usr/bin/env python3
"""video-kb: base de conhecimento de vídeos em markdown (somente biblioteca padrão).

Subcomandos:
  root      mostra a raiz da base, se ela é privada e se é durável
  find SRC  procura uma nota existente para a mesma fonte (URL ou arquivo)
  new       cria uma nota a partir do template e imprime o caminho
  reindex   regenera INDEX.md a partir do frontmatter de todas as notas

Raiz: $VIDEO_KB_DIR, senão <raiz do repositório git>/data/video-kb.
Códigos de saída: 0 ok, 1 não encontrado, 2 erro, 3 duplicata, 4 local versionado.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL_DIR / 'references' / 'note-template.md'
TRACKING = re.compile(r'^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|si|igshid)$', re.I)
CONFIDENTIALITY = ('publico', 'interno', 'confidencial')


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True)
    except OSError:  # git ausente: trate como "fora de um repositório"
        return None


def kb_root() -> Path:
    configured = os.environ.get('VIDEO_KB_DIR', '').strip()
    if configured:
        return Path(configured).expanduser().resolve()
    top = _git(['rev-parse', '--show-toplevel'], Path.cwd())
    base = Path(top.stdout.strip()) if top and top.returncode == 0 and top.stdout.strip() else Path.cwd()
    return base / 'data' / 'video-kb'


def exposure(root: Path) -> str | None:
    """Aviso quando o git versionaria as notas gravadas sob root."""
    anchor = root
    while not anchor.exists() and anchor != anchor.parent:
        anchor = anchor.parent
    inside = _git(['rev-parse', '--is-inside-work-tree'], anchor)
    if not inside or inside.returncode != 0 or inside.stdout.strip() != 'true':
        return None
    ignored = _git(['check-ignore', '-q', str(root / 'notes' / 'probe.md')], anchor)
    if ignored and ignored.returncode == 0:
        return None
    remote = _git(['remote', 'get-url', 'origin'], anchor)
    origin = remote.stdout.strip() if remote and remote.returncode == 0 else '(sem remote origin)'
    return (f'{root} é versionado pelo git ({origin}). As notas seriam publicadas no próximo push. '
            'Confirme com o usuário que esse repositório é PRIVADO antes de usar --allow-versioned.')


def _youtube_id(host: str, path: str, query: str) -> str | None:
    host = re.sub(r'^(www\.|m\.|music\.)', '', host)
    if host == 'youtu.be':
        return path.strip('/').split('/')[0] or None
    if host in ('youtube.com', 'youtube-nocookie.com'):
        if path == '/watch':
            return dict(parse_qsl(query)).get('v') or None
        match = re.match(r'^/(?:shorts|live|embed|v)/([^/]+)', path)
        return match.group(1) if match else None
    return None


def source_id(source: str) -> str:
    """Identidade estável da fonte: o mesmo vídeo gera o mesmo id em qualquer formato de link."""
    text = source.strip()
    parsed = urlparse(text)
    if parsed.scheme in ('http', 'https') and parsed.netloc:
        host = (parsed.hostname or '').lower()
        video = _youtube_id(host, parsed.path, parsed.query)
        if video:
            return f'youtube:{video}'
        query = urlencode(sorted((k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
                                 if not TRACKING.match(k)))
        return f"url:{host.removeprefix('www.')}{parsed.path.rstrip('/') or '/'}" + (f'?{query}' if query else '')
    path = Path(text).expanduser()
    if path.is_file():  # pelo conteúdo: renomear ou mover o arquivo não cria duplicata
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1 << 20), b''):
                digest.update(block)
        return f'file:sha256:{digest.hexdigest()[:16]}'
    return f'name:{path.name or text}'


def slugify(text: str, limit: int = 60) -> str:
    ascii_text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    slug = re.sub(r'[^a-z0-9]+', '-', ascii_text.lower()).strip('-')
    return slug[:limit].rstrip('-') or 'video'


def parse_frontmatter(text: str) -> dict:
    if not text.startswith('---'):
        return {}
    end = text.find('\n---', 3)
    data = {}
    for line in text[3:end if end >= 0 else 0].splitlines():
        key, sep, raw = line.partition(':')
        if not sep or not key.strip() or key.lstrip().startswith('#'):
            continue
        raw = raw.strip()
        try:
            data[key.strip()] = json.loads(raw) if raw[:1] in ('"', '[') else raw
        except ValueError:
            data[key.strip()] = raw
    return data


def notes(root: Path) -> list[tuple[Path, dict]]:
    folder = root / 'notes'
    if not folder.is_dir():
        return []
    return [(p, parse_frontmatter(p.read_text(encoding='utf-8'))) for p in sorted(folder.glob('*.md'))]


def matches(root: Path, source: str) -> list[Path]:
    wanted = source_id(source)
    return [p for p, fm in notes(root) if fm.get('source_id') == wanted or fm.get('source') == source.strip()]


def _guard(root: Path, allow_versioned: bool) -> None:
    warning = exposure(root)
    if warning and not allow_versioned:
        print(f'[video-kb] RECUSADO: {warning}', file=sys.stderr)
        raise SystemExit(4)
    if warning:
        print(f'[video-kb] aviso: {warning}', file=sys.stderr)


def cmd_root(args) -> int:
    root = kb_root()
    print(root)
    count = len(notes(root))
    print(f'[video-kb] {count} nota(s); raiz {"existe" if root.exists() else "ainda não criada"}.', file=sys.stderr)
    warning = exposure(root)
    print(f'[video-kb] ATENÇÃO: {warning}' if warning else '[video-kb] privada: o git não versiona esta pasta.',
          file=sys.stderr)
    if os.environ.get('CLAUDE_CODE_REMOTE', '').lower() in ('1', 'true', 'yes') and not os.environ.get('VIDEO_KB_DIR'):
        print('[video-kb] sessão em nuvem: esta pasta é apagada com o container. Para durabilidade, '
              'aponte VIDEO_KB_DIR para um repositório privado.', file=sys.stderr)
    return 0


def cmd_find(args) -> int:
    found = matches(kb_root(), args.source)
    for path in found:
        print(path)
    return 0 if found else 1


def cmd_new(args) -> int:
    root = kb_root()
    _guard(root, args.allow_versioned)
    existing = matches(root, args.source)
    if existing and not args.allow_duplicate:
        print(existing[0])
        print('[video-kb] fonte já registrada; atualize essa nota (ou use --allow-duplicate).', file=sys.stderr)
        return 3
    tags = sorted({t.strip().lower() for t in args.tags.split(',') if t.strip()})
    values = {'title': args.title, 'source': args.source.strip(), 'source_id': source_id(args.source),
              'uploader': args.uploader, 'duration': args.duration, 'watched_at': args.watched_at,
              'engine': args.engine, 'detail': args.detail, 'evidence': args.evidence,
              'language': args.language, 'tags': tags, 'confidentiality': args.confidentiality}
    text = TEMPLATE.read_text(encoding='utf-8').replace('{{heading}}', args.title.replace('\n', ' '))
    for key, value in values.items():
        text = text.replace('{{' + key + '}}', json.dumps(value, ensure_ascii=False))
    folder = root / 'notes'
    folder.mkdir(parents=True, exist_ok=True)
    stem, n = f'{args.watched_at}-{slugify(args.title)}', 1
    path = folder / f'{stem}.md'
    while path.exists():
        n += 1
        path = folder / f'{stem}-{n}.md'
    path.write_text(text, encoding='utf-8')
    print(path)
    return 0


def _cell(value) -> str:
    if isinstance(value, list):
        value = ', '.join(map(str, value))
    return str(value or '—').replace('|', '\\|').replace('\n', ' ')


def cmd_reindex(args) -> int:
    root = kb_root()
    _guard(root, args.allow_versioned)
    rows = sorted(notes(root), key=lambda item: (str(item[1].get('watched_at', '')), item[0].name), reverse=True)
    lines = ['# Índice da base de conhecimento de vídeos', '',
             '_Gerado por `kb.py reindex`; não edite à mão._', '', f'{len(rows)} vídeo(s).', '',
             '| Assistido em | Título | Duração | Tags | Sigilo | Nota |', '|---|---|---|---|---|---|']
    for path, fm in rows:
        lines.append(f"| {_cell(fm.get('watched_at'))} | {_cell(fm.get('title'))} | {_cell(fm.get('duration'))} "
                     f"| {_cell(fm.get('tags'))} | {_cell(fm.get('confidentiality'))} | [{path.name}](notes/{path.name}) |")
    root.mkdir(parents=True, exist_ok=True)
    (root / 'INDEX.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(root / 'INDEX.md')
    return 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):  # consoles do Windows
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('root').set_defaults(run=cmd_root)
    find = sub.add_parser('find')
    find.add_argument('source')
    find.set_defaults(run=cmd_find)
    new = sub.add_parser('new')
    new.add_argument('--title', required=True)
    new.add_argument('--source', required=True)
    new.add_argument('--uploader', default='desconhecido')
    new.add_argument('--duration', default='desconhecida')
    new.add_argument('--watched-at', default=dt.date.today().isoformat())
    new.add_argument('--engine', choices=['local', 'gemini'], default='local')
    new.add_argument('--detail', default='balanced')
    new.add_argument('--evidence', default='frames+transcript')
    new.add_argument('--language', default='desconhecido')
    new.add_argument('--tags', default='')
    new.add_argument('--confidentiality', choices=CONFIDENTIALITY, default='interno')
    new.add_argument('--allow-duplicate', action='store_true')
    new.add_argument('--allow-versioned', action='store_true')
    new.set_defaults(run=cmd_new)
    reindex = sub.add_parser('reindex')
    reindex.add_argument('--allow-versioned', action='store_true')
    reindex.set_defaults(run=cmd_reindex)
    args = parser.parse_args()
    try:
        return args.run(args)
    except OSError as exc:
        print(f'[video-kb] erro de arquivo: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
