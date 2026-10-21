# Arquitetura e Backend de Produção (Node.js e Python)

Índice: 1. Estrutura de projeto · 2. Contrato e validação · 3. Node (Fastify) · 4. Python (FastAPI) · 5. Dados · 6. Filas, cache e jobs · 7. Observabilidade · 8. Deploy e infraestrutura · 9. Testes

## 1. Estrutura (monólito modular)
```
src/
  modules/<dominio>/{routes,service,repository,schemas,policies,tests}
  platform/{auth,db,cache,queue,logger,config,errors}
  app.ts | main.py
```
Regra: módulo só conversa com outro pela interface `service`, nunca pelo banco do outro. `policies` concentra autorização (quem pode o quê sobre qual objeto).

## 2. Contrato e validação
- Schemas únicos de entrada/saída: Zod (TS) ou Pydantic v2 (Python); gere OpenAPI a partir deles.
- Valide **tudo** que entra (body, query, params, headers, arquivos) com allowlist; rejeite campos extras (evita mass assignment).
- Configuração validada no boot (`z.object({...}).parse(process.env)`), falhe rápido.

## 3. Node — Fastify + TypeScript
```ts
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';

const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'] }, trustProxy: true });
await app.register(helmet);                       // headers seguros
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

const Params = z.object({ id: z.string().uuid() });
app.get('/orders/:id', { preHandler: app.authenticate }, async (req, reply) => {
  const { id } = Params.parse(req.params);
  const order = await db.order.findFirst({ where: { id, ownerId: req.user.id } }); // authz no objeto (anti-BOLA)
  if (!order) return reply.code(404).send({ error: 'not_found' });            // 404, não 403: não revela existência
  return order;
});
app.setErrorHandler((err, req, reply) => {
  req.log.error(err);
  reply.code(err.statusCode ?? 500).send({ error: err.statusCode ? err.message : 'internal_error' });
});
```
NestJS quando o time precisa de convenção forte (DI, módulos, decorators). Express só em legado.

## 4. Python — FastAPI + Pydantic v2 + SQLAlchemy 2
```python
from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select
from uuid import UUID

app = FastAPI(docs_url=None if settings.prod else "/docs")

class OrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")      # bloqueia mass assignment
    product_id: UUID
    qty: int = Field(gt=0, le=100)

@app.get("/orders/{order_id}")
async def get_order(order_id: UUID, user=Depends(current_user), db=Depends(get_db)):
    order = (await db.execute(
        select(Order).where(Order.id == order_id, Order.owner_id == user.id)   # parametrizado + authz
    )).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "not_found")
    return OrderOut.model_validate(order)
```
Django + DRF quando o admin pronto, ORM maduro e autenticação embutida economizam semanas. Use `uv` ou `poetry` com lockfile; `ruff` + `mypy`/`pyright`; `pytest` + `httpx.AsyncClient`.

## 5. Dados
- PostgreSQL como padrão. Migrations versionadas (Prisma Migrate, Drizzle Kit, Alembic, Django migrations); nunca alterar schema à mão em produção.
- Índices guiados por `EXPLAIN ANALYZE`; evite N+1 (include/joinedload/selectinload).
- Transações para invariantes de negócio; idempotency keys em pagamentos e webhooks.
- Row Level Security (RLS) no Postgres/Supabase como segunda linha de defesa multi-tenant.
- Dados pessoais (LGPD): minimização, base legal, retenção, criptografia em repouso, trilha de auditoria, direito de exclusão.

## 6. Filas, cache e jobs
- Jobs assíncronos: BullMQ (Node/Redis), Celery/Arq/RQ (Python), ou SQS/Cloud Tasks. Retry com backoff exponencial + dead-letter queue.
- Cache: Redis com TTL e invalidação por evento; cache HTTP (`Cache-Control`, `ETag`) na borda para conteúdo público.
- Webhooks recebidos: verifique assinatura HMAC com comparação em tempo constante, processe de forma idempotente.

## 7. Observabilidade
OpenTelemetry (traces + métricas + logs correlacionados por trace id), logs JSON estruturados, Sentry para erros de front e back, health checks (`/healthz` liveness, `/readyz` readiness), SLOs (ex.: 99,9% das requisições < 300 ms) com alertas sobre burn rate.

## 8. Deploy e infraestrutura
- Container mínimo (distroless ou `-slim`), usuário não-root, `HEALTHCHECK`, multi-stage build.
- CI: lint → typecheck → testes → build → scan (npm audit/pip-audit, Trivy, gitleaks) → deploy com preview por PR.
- IaC (Terraform/OpenTofu, Pulumi). Segredos em cofre (AWS Secrets Manager, GCP Secret Manager, Doppler, Vault), nunca no repositório.
- Hospedagem típica: Vercel/Netlify (front), Fly.io/Railway/Render (apps), AWS/GCP/Azure (escala/compliance), Cloudflare (CDN/WAF/edge).

## 9. Testes (pirâmide)
Unitários (regras de domínio) → integração (API + banco real via Testcontainers) → E2E (Playwright, fluxos críticos) → contrato (OpenAPI/Pact quando há consumidores externos) → carga (k6) antes de lançamentos.
