# Validação do acesso de integração — SENTINEL 3D

Executado em 2026-10-27T23:33:04.021Z com `node scripts/validar-integracao.mjs` (Node v22.22.0).

**Resultado: 12/12 verificações aprovadas.**

| ID | Verificação | Resultado | Evidência |
|---|---|---|---|
| V01 | Modo integração recusa iniciar sem token forte (≥ 32 caracteres) | ✅ aprovado | Erro na partida com token de 5 caracteres |
| V02 | Simulador desativado e modo identificado | ✅ aprovado | mode=integracao; simulador=desativado; ingest-api=aguardando dados |
| V03 | Sem telemetria, nenhum equipamento aparece como operacional, não há dado sintético e equipamento não integrado não gera alarme | ✅ aprovado | 53/53 "sem dados confiáveis"; 0 incidentes após 11 s; 0 pontos sintéticos |
| V04 | Ingestão sem token ou com token errado é recusada (401) | ✅ aprovado | sem token: 401; token errado: 401; estado inalterado |
| V05 | Leitura válida é aceita e o estado reflete exatamente o valor enviado | ✅ aprovado | TH-01 → Operacional; tempC=23.4, humidityPct=47; origem ingest-api |
| V06 | Dados inválidos são rejeitados com motivo; campos desconhecidos descartados | ✅ aprovado | aceitas=1, rejeitadas=2 (dispositivo não cadastrado: NAO-EXISTE-1; sourceTs fora da janela aceita (relógio do equipamento?)); descartado: comando |
| V07 | Valor crítico real gera incidente marcado como dado de conector (não sintético) | ✅ aprovado | TH-01 → Falha crítica; INC-20261027-0001 "Falha — TH-01 (Sensor temp./umidade — racks)" (synthetic=false) |
| V08 | Sem novas leituras, o equipamento deixa de ser considerado atual (nunca "operacional") | ✅ aprovado | TH-03 → unknown após 10 s sem leitura |
| V09 | Simulador e cenários bloqueados no modo integração | ✅ aprovado | POST /api/scenarios/A/start → 409; lista vazia |
| V10 | Gateway de referência entrega lote com sucesso | ✅ aprovado | scripts/gateway-referencia.mjs: 3 aceitas, 0 rejeitadas |
| V11 | Limite de requisições por origem na ingestão (429) | ✅ aprovado | 429 a partir da requisição 234 na janela de 60 s (limite 240) |
| V12 | Sessão humana, CSRF e perfis continuam exigidos na API | ✅ aprovado | sem sessão: 401; sem CSRF: 403; observador sem ativos restritos e sem IP |

## Escopo desta validação

Valida o **caminho de integração da plataforma**: gateway → `POST /api/ingest` → validação → estado → incidente, em modo integração (sem simulador). Uma instância isolada é criada e destruída a cada execução.

**Não valida (depende do banco e dos fabricantes):**

- conectividade e credenciais com equipamentos reais (SNMPv3, ONVIF, MQTT, BACnet, Modbus, centrais de alarme/incêndio);
- autenticação corporativa (IdP/MFA) — o modo integração ainda usa autenticação de demonstração, aceitável apenas em laboratório isolado;
- TLS/mTLS de ponta a ponta (fornecido pelo proxy reverso da infraestrutura);
- autorização formal, análise de risco, LGPD e homologação de segurança.

## Para uso oficial (checklist de liberação)

1. Autorização formal do titular dos equipamentos e da marca.
2. IdP corporativo com MFA integrado e `SENTINEL_DEMO_AUTH=0`.
3. Proxy reverso com TLS (HSTS) e mTLS para o gateway; servidor só em rede segmentada.
4. Adaptadores homologados por fabricante no gateway, com contas somente leitura.
5. Piloto em 1 agência, somente leitura, com plano de rollback.
6. Persistência gerenciada (PostgreSQL/TimescaleDB) e backup.
