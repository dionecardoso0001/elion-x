# Contratos de API e de eventos

Todas as respostas são JSON (`application/json; charset=utf-8`) e todos os horários são epoch ms em UTC.
Mutações exigem o cabeçalho `X-Sentinel-Csrf: 1` e o cookie de sessão (exceto `/api/ingest`).

## Ingestão (gateway → plataforma)

`POST /api/ingest`. Habilitado só quando `SENTINEL_INGEST_TOKEN` está definido.

```http
Authorization: Bearer <token do gateway>
Content-Type: application/json
```

```json
{
  "readings": [
    { "deviceId": "TH-01", "sourceTs": 1767225600000, "values": { "tempC": 23.4, "humidityPct": 47 }, "quality": "good" }
  ]
}
```

| Campo | Regra |
|---|---|
| `deviceId` | `^[A-Z0-9-]{2,32}$` e precisa estar cadastrado |
| `sourceTs` | epoch ms; aceito entre agora − 24 h e agora + 5 min |
| `values` | só as métricas do tipo no catálogo (`src/domain/catalog.mjs`); número finito, booleano ou enum de texto |
| `quality` | `good` (padrão) ou `bad` |
| lote | até 500 leituras e 256 KB |

Resposta `202`: `{ accepted, rejected, results: [{ ok, deviceId, dropped[] } | { ok: false, error }] }`.
Métricas desconhecidas são descartadas (`dropped`) e a leitura passa a ter qualidade `partial`.

## Endpoints principais

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/api/health` | — | estado do processo |
| GET/POST | `/api/session` | — | consulta/cria sessão de **demonstração** (`SENTINEL_DEMO_AUTH=0` desativa) |
| GET | `/api/me`, `/api/meta` | sessão | perfil, catálogo, estados |
| GET | `/api/agencies`, `/api/agencies/:id/layout` | read:twin | agências e planta |
| GET | `/api/devices`, `/api/devices/:id` | read:twin | inventário sanitizado + estado, histórico, dependências |
| GET | `/api/devices/:id/video` | read:video | painel de vídeo (sintético; auditado) |
| POST | `/api/devices/:id/maintenance` | device:maintenance | `{ on, note }` |
| GET | `/api/dependencies` | read:twin | grafo visível ao perfil |
| GET | `/api/incidents?status=active\|normalizado\|resolvido` | read:incidents | incidentes (redigidos se restritos) |
| POST | `/api/incidents/:id/ack` | incident:ack | reconhecer |
| POST | `/api/incidents/:id/resolve` | incident:resolve | `{ note }` (≥ 5 caracteres; só após normalização) |
| GET | `/api/events?limit&category` | read:twin | eventos |
| GET | `/api/metrics/summary?period=15m\|1h\|6h\|24h\|7d&category&severity` | read:twin | dados dos gráficos |
| GET/POST | `/api/scenarios`, `/api/scenarios/:A-E\|all/start\|stop` | scenario:run | simulador |
| POST | `/api/assistant` | assistant:use | `{ q }` → `{ intent, tool, text, items, diagnosis, actions, source }` |
| GET | `/api/reports/incidents?period=today\|7d` | read:incidents | relatório Markdown |
| GET | `/api/connectors` | read:twin | matriz de conectores e estado em execução |
| GET | `/api/admin/audit` | admin:audit | trilha de auditoria |
| GET/PUT | `/api/admin/config` | admin:config | `{ retentionDays }` (1–3650) |
| GET | `/api/stream` | sessão | SSE: `snapshot`, `update`, `notify` |

## Evento (persistido em `data/events.jsonl`)

```json
{ "id": "EV-…", "ts": 1767225600000, "type": "state.changed", "severity": "high", "category": "rede",
  "deviceId": "SW-03", "incidentId": null, "from": "ok", "to": "offline", "text": "…", "synthetic": true }
```

Tipos: `state.changed`, `incident.created|reopened|recovered|escalated|acknowledged|resolved`, `maintenance.start|end`, `scenario.start|stop`.

## Diagnóstico

```json
{ "engine": "sentinel-ai/deterministico-v1", "kind": "cascade", "title": "…", "severity": "high", "priority": "P2",
  "facts": ["…"], "hypothesis": "…", "confidence": "alta", "confidenceCriteria": ["…"],
  "recommendations": ["…"], "uncertainties": ["…"], "relation": "conhecida", "rootDeviceId": "SW-03", "devices": ["…"],
  "protocol": { "note": "…", "steps": ["…"] } }
```
