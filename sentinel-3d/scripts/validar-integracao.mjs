// Validação de ponta a ponta do ACESSO DE INTEGRAÇÃO (modo integração, sem simulador).
// Sobe uma instância isolada, executa as verificações e gera o relatório de evidências.
//   node scripts/validar-integracao.mjs [docs/VALIDACAO-INTEGRACAO.md]
// O que este roteiro prova: o caminho gateway → plataforma é autenticado, valida e rejeita
// corretamente, não mistura dado sintético e reflete o dado real no estado e nos incidentes.
// O que ele NÃO prova: conectividade com equipamentos reais (exige homologação com o banco).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';
import { send } from './gateway-referencia.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function validate() {
  const results = [];
  const check = async (id, title, fn) => {
    const t0 = Date.now();
    try { const evidence = await fn(); results.push({ id, title, ok: true, evidence: evidence ?? '', ms: Date.now() - t0 }); }
    catch (e) { results.push({ id, title, ok: false, evidence: e.message, ms: Date.now() - t0 }); }
  };
  const must = (cond, msg) => { if (!cond) throw new Error(msg); };

  // V01 — partida recusada sem token forte
  await check('V01', 'Modo integração recusa iniciar sem token forte (≥ 32 caracteres)', async () => {
    let refused = false;
    try { const s = await createServer({ port: 0, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sv-')), mode: 'integracao', ingestToken: 'curto' }); await s.close(); }
    catch (e) { refused = /32 caracteres/.test(e.message); }
    must(refused, 'servidor iniciou com token fraco');
    return 'Erro na partida com token de 5 caracteres';
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-int-'));
  const token = crypto.randomBytes(32).toString('base64url');
  const srv = await createServer({ port: 0, dataDir: dir, tickMs: 250, mode: 'integracao', ingestToken: token });
  const base = `http://127.0.0.1:${srv.port}`;
  const ingest = (readings, auth = `Bearer ${token}`) => fetch(`${base}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify({ readings }) });
  let cookie = '';
  const login = async (role) => { const r = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sentinel-Csrf': '1' }, body: JSON.stringify({ role }) }); cookie = r.headers.get('set-cookie').split(';')[0]; };
  const get = async (u) => (await fetch(base + u, { headers: { cookie } })).json();
  const dev = async (id) => (await get(`/api/devices/${id}`)).device;

  try {
    await login('operador');

    await check('V02', 'Simulador desativado e modo identificado', async () => {
      const h = await get('/api/health');
      const c = await get('/api/connectors');
      must(h.mode === 'integracao' && h.demo === false, `health: ${JSON.stringify(h)}`);
      must(c.find((x) => x.id === 'simulador').runtimeStatus === 'desativado', 'simulador ativo');
      return `mode=${h.mode}; simulador=desativado; ingest-api=${c.find((x) => x.id === 'ingest-api').runtimeStatus}`;
    });

    await check('V03', 'Sem telemetria, nenhum equipamento aparece como operacional, não há dado sintético e equipamento não integrado não gera alarme', async () => {
      await sleep(11_000); // além da janela de confirmação (10 s): nenhum incidente pode surgir de ativos nunca integrados
      const s = await get('/api/state');
      const ok = s.devices.filter((d) => d.status === 'ok').length;
      const unknown = s.devices.filter((d) => d.status === 'unknown').length;
      const inc = await get('/api/incidents');
      const sum = await get('/api/metrics/summary?period=7d');
      must(ok === 0, `${ok} operacionais sem dado`);
      must(unknown === s.devices.length, 'há estados diferentes de "sem dados"');
      must(inc.length === 0, `${inc.length} incidentes pré-existentes`);
      must(!sum.series.some((p) => p.synthetic), 'série sintética presente');
      must(sum.upsTrend.synthetic === false, 'tendência sintética do UPS presente');
      return `${unknown}/${s.devices.length} "sem dados confiáveis"; 0 incidentes após 11 s; 0 pontos sintéticos`;
    });

    await check('V04', 'Ingestão sem token ou com token errado é recusada (401)', async () => {
      const a = await ingest([{ deviceId: 'TH-01', sourceTs: Date.now(), values: { tempC: 22 } }], null);
      const b = await ingest([{ deviceId: 'TH-01', sourceTs: Date.now(), values: { tempC: 22 } }], 'Bearer token-errado');
      must(a.status === 401 && b.status === 401, `status ${a.status}/${b.status}`);
      must((await dev('TH-01')).status === 'unknown', 'leitura não autenticada alterou o estado');
      return 'sem token: 401; token errado: 401; estado inalterado';
    });

    await check('V05', 'Leitura válida é aceita e o estado reflete exatamente o valor enviado', async () => {
      const r = await (await ingest([{ deviceId: 'TH-01', sourceTs: Date.now(), values: { tempC: 23.4, humidityPct: 47 } }])).json();
      must(r.accepted === 1, JSON.stringify(r));
      await sleep(600);
      const d = await dev('TH-01');
      must(d.status === 'ok', `estado ${d.status}`);
      must(d.values.tempC === 23.4 && d.values.humidityPct === 47, `valores ${JSON.stringify(d.values)}`);
      must(d.lastConnector === 'ingest-api', `conector ${d.lastConnector}`);
      return 'TH-01 → Operacional; tempC=23.4, humidityPct=47; origem ingest-api';
    });

    await check('V06', 'Dados inválidos são rejeitados com motivo; campos desconhecidos descartados', async () => {
      const r = await (await ingest([
        { deviceId: 'NAO-EXISTE-1', sourceTs: Date.now(), values: {} },
        { deviceId: 'TH-02', sourceTs: Date.now() + 3600_000, values: { tempC: 22 } },
        { deviceId: 'TH-02', sourceTs: Date.now(), values: { tempC: 22.1, comando: 'desligar' } },
      ])).json();
      must(r.accepted === 1 && r.rejected === 2, JSON.stringify(r));
      must(r.results[2].dropped.includes('comando'), 'campo desconhecido não descartado');
      return `aceitas=1, rejeitadas=2 (${r.results.filter((x) => !x.ok).map((x) => x.error).join('; ')}); descartado: comando`;
    });

    await check('V07', 'Valor crítico real gera incidente marcado como dado de conector (não sintético)', async () => {
      await ingest([{ deviceId: 'TH-01', sourceTs: Date.now(), values: { tempC: 35, humidityPct: 47 } }]);
      await sleep(4500); // janela de confirmação de sinais isolados (3 s)
      const d = await dev('TH-01');
      const inc = (await get('/api/incidents?status=active')).find((i) => i.rootDeviceId === 'TH-01');
      must(d.status === 'critical', `estado ${d.status}`);
      must(inc && inc.synthetic === false, `incidente: ${JSON.stringify(inc && { id: inc.id, synthetic: inc.synthetic })}`);
      return `TH-01 → Falha crítica; ${inc.id} "${inc.title}" (synthetic=false)`;
    });

    await check('V08', 'Sem novas leituras, o equipamento deixa de ser considerado atual (nunca "operacional")', async () => {
      await ingest([{ deviceId: 'TH-03', sourceTs: Date.now(), values: { tempC: 22, humidityPct: 45 } }]);
      await sleep(600);
      must((await dev('TH-03')).status === 'ok', 'não ficou operacional após leitura');
      await sleep(9800); // limite = 3 × intervalo (3 s)
      const d = await dev('TH-03');
      must(['offline', 'unknown'].includes(d.status), `estado ${d.status}`);
      return `TH-03 → ${d.status} após ${Math.round(d.ageMs / 1000)} s sem leitura`;
    });

    await check('V09', 'Simulador e cenários bloqueados no modo integração', async () => {
      const r = await fetch(`${base}/api/scenarios/A/start`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-Sentinel-Csrf': '1' }, body: '{}' });
      const list = await get('/api/scenarios');
      must(r.status === 409, `status ${r.status}`);
      must(list.scenarios.length === 0, 'cenários listados');
      return 'POST /api/scenarios/A/start → 409; lista vazia';
    });

    await check('V10', 'Gateway de referência entrega lote com sucesso', async () => {
      const readings = ['TH-01', 'TH-02', 'TH-03'].map((id, i) => ({ deviceId: id, sourceTs: Date.now(), values: { tempC: 22 + i, humidityPct: 45 } }));
      const r = await send(readings, { url: base, token, log: { warn() {} } });
      must(r.accepted === 3, JSON.stringify(r));
      return 'scripts/gateway-referencia.mjs: 3 aceitas, 0 rejeitadas';
    });

    await check('V11', 'Limite de requisições por origem na ingestão (429)', async () => {
      let first429 = null;
      for (let i = 1; i <= 260 && !first429; i += 1) {
        const s = (await ingest([{ deviceId: 'TH-02', sourceTs: Date.now(), values: { tempC: 22 } }])).status;
        if (s === 429) first429 = i;
      }
      must(first429, 'nenhum 429 em 260 requisições');
      return `429 a partir da requisição ${first429} na janela de 60 s (limite 240)`;
    });

    await check('V12', 'Sessão humana, CSRF e perfis continuam exigidos na API', async () => {
      const noSess = await fetch(`${base}/api/devices`);
      const noCsrf = await fetch(`${base}/api/devices/TH-01/maintenance`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{"on":true}' });
      await login('observador');
      const obs = await get('/api/devices');
      must(noSess.status === 401 && noCsrf.status === 403, `status ${noSess.status}/${noCsrf.status}`);
      must(!obs.some((d) => d.id === 'SW-03') && obs.every((d) => d.ip === undefined), 'observador vê ativo restrito/IP');
      return 'sem sessão: 401; sem CSRF: 403; observador sem ativos restritos e sem IP';
    });
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

export function report(results, when = new Date()) {
  const passed = results.filter((r) => r.ok).length;
  const lines = [
    '# Validação do acesso de integração — SENTINEL 3D',
    '',
    `Executado em ${when.toISOString()} com \`node scripts/validar-integracao.mjs\` (Node ${process.version}).`,
    '',
    `**Resultado: ${passed}/${results.length} verificações aprovadas.**`,
    '',
    '| ID | Verificação | Resultado | Evidência |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.title} | ${r.ok ? '✅ aprovado' : '❌ reprovado'} | ${String(r.evidence).replace(/\|/g, '\\|')} |`),
    '',
    '## Escopo desta validação',
    '',
    'Valida o **caminho de integração da plataforma**: gateway → `POST /api/ingest` → validação → estado → incidente, em modo integração (sem simulador). Uma instância isolada é criada e destruída a cada execução.',
    '',
    '**Não valida (depende do banco e dos fabricantes):**',
    '',
    '- conectividade e credenciais com equipamentos reais (SNMPv3, ONVIF, MQTT, BACnet, Modbus, centrais de alarme/incêndio);',
    '- autenticação corporativa (IdP/MFA) — o modo integração ainda usa autenticação de demonstração, aceitável apenas em laboratório isolado;',
    '- TLS/mTLS de ponta a ponta (fornecido pelo proxy reverso da infraestrutura);',
    '- autorização formal, análise de risco, LGPD e homologação de segurança.',
    '',
    '## Para uso oficial (checklist de liberação)',
    '',
    '1. Autorização formal do titular dos equipamentos e da marca.',
    '2. IdP corporativo com MFA integrado e `SENTINEL_DEMO_AUTH=0`.',
    '3. Proxy reverso com TLS (HSTS) e mTLS para o gateway; servidor só em rede segmentada.',
    '4. Adaptadores homologados por fabricante no gateway, com contas somente leitura.',
    '5. Piloto em 1 agência, somente leitura, com plano de rollback.',
    '6. Persistência gerenciada (PostgreSQL/TimescaleDB) e backup.',
    '',
  ];
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  const results = await validate();
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.id} ${r.title}${r.ok ? '' : ` — ${r.evidence}`}`);
  const md = report(results);
  if (out) { fs.writeFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', out), md); console.log(`\nRelatório: ${out}`); }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
