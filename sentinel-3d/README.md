# SENTINEL 3D — Digital Twin Intelligence Platform

> **MODO DEMONSTRAÇÃO — DADOS SIMULADOS.** Planta e inventário fictícios. Nenhum equipamento físico está conectado,
> e a planta não representa a arquitetura de nenhuma agência real. Não está pronto para produção.

Gêmeo digital 3D de uma agência bancária demonstrativa, com planta, numeração de ambientes e inventário seguindo o **Mapa de Ativos · Visão Conceitual** fornecido, com monitoramento de CFTV, rede, servidores, energia, alarmes e incêndio. O núcleo é um motor de regras, correlação por grafo de dependências e diagnóstico explicável (fatos, hipótese, confiança por critérios, recomendações e incertezas).

## Como abrir (3 formas)

| Forma | Como | Quando usar |
|---|---|---|
| **1. Arquivo único (mais simples)** | Baixe `standalone/sentinel-3d.html` e abra com **duplo clique** no Chrome, Edge ou Firefox | Demonstração em qualquer computador, sem instalar nada e sem internet |
| **2. Servidor local** | `npm install && npm start` → http://localhost:8730 | Persistência em disco, ingestão de gateway real, auditoria em arquivo |
| **3. Link hospedado** | Página privada no claude.ai (o dono compartilha pelo menu *Share*) | Abrir no navegador ou no celular sem baixar |

> **Não abra `public/index.html` diretamente**: aquele arquivo é a interface do *servidor* e, aberto
> por duplo clique, o navegador bloqueia os módulos (tela vazia). Para duplo clique use o item 1.
> No GitHub, um `.html` aparece como código-fonte: use **Download raw** e abra o arquivo baixado.

A versão de arquivo único roda o **mesmo núcleo** do servidor (`src/http/api.mjs`, motor, regras, RBAC) dentro do
navegador. Os dados vivem enquanto a aba estiver aberta. Gerar de novo após alterar o código: `npm run build:standalone`.

## Modo integração (telemetria real via gateway)

O modo padrão é **demonstração** (simulador + dados sintéticos rotulados). Para receber dados de um gateway real,
o servidor roda em **modo integração**: simulador desligado, nenhum dado sintético, cenários bloqueados, cada leitura
marcada com o conector de origem e equipamento ainda não integrado mostrado como "sem dados" **sem gerar alarme**.

```bash
cd sentinel-3d && npm install
cp .env.example .env    # preencha o token (o servidor não lê .env sozinho: exporte as variáveis)
export SENTINEL_MODE=integracao
export SENTINEL_INGEST_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
npm start                                 # recusa iniciar sem token de ≥ 32 caracteres

# no gateway (segmento autorizado da agência):
SENTINEL_URL=https://<servidor> SENTINEL_INGEST_TOKEN=<mesmo token> node scripts/gateway-referencia.mjs leituras.ndjson
```

**Validação do acesso:** `npm run validar:integracao` executa 12 verificações de ponta a ponta numa instância isolada e
grava as evidências em [docs/VALIDACAO-INTEGRACAO.md](docs/VALIDACAO-INTEGRACAO.md). Isso valida a **plataforma**;
conectar equipamentos reais exige ainda a liberação descrita no relatório (autorização, IdP com MFA, TLS/mTLS,
adaptadores homologados por fabricante, piloto somente leitura).

## Executar (servidor)
```bash
cd sentinel-3d
npm install        # única dependência: three@0.185.1
npm start          # http://127.0.0.1:8730
npm test           # 32 testes: motor, cenários A–H, mapa, regressões, API, autorização, build autônomo, integração
npm run build:standalone   # gera standalone/sentinel-3d.html (arquivo único)
```
Requer Node.js ≥ 20. A sessão inicia como **Operador NOC**; troque o perfil no topo.

| Variável | Padrão | Efeito |
|---|---|---|
| `PORT` | 8730 | porta HTTP (escuta só em 127.0.0.1) |
| `SENTINEL_INGEST_TOKEN` | vazio | habilita `POST /api/ingest` para gateway real |
| `SENTINEL_DEMO_AUTH` | 1 | `0` desativa a escolha livre de perfil (exigir IdP) |
| `SENTINEL_MODE` | demo | `integracao`: sem simulador e sem dados sintéticos; exige token ≥ 32 caracteres |
| `HOST` | 127.0.0.1 | interface de escuta (em produção, atrás de proxy TLS) |

Os dados de execução (incidentes, eventos, auditoria) ficam em `sentinel-3d/data/`, fora do versionamento. Para recomeçar do zero, apague essa pasta.

## Primeira demonstração (3 min)
1. Gêmeo 3D na visão aérea: gire, aproxime e clique num marcador.
2. Simulador → **B · Falha em switch**. Em ~8 s, o SW-03 fica desconectado, as câmeras ficam roxas e abre **um** incidente com causa raiz provável e confiança alta; a câmera voa até o switch.
3. **Transparente** + **Dependências**: veja os cabos afetados em vermelho.
4. **Primeira pessoa**: entre pela porta e caminhe até a recepção.
5. **SENTINEL AI** → "Qual a provável causa da falha das câmeras da recepção?"
6. Perfil **Observador**: áreas restritas trancadas e ocorrência redigida.

## O que foi verificado
- `npm test`: **32/32** aprovados
- `npm run validar:integracao`: **12/12** verificações do acesso de integração (ver relatório), incluindo testes de regressão que **falham sem a correção** de incidentes transitórios.
- Chromium (Playwright), em todos os modos de navegação, nas 12 seções e na troca de perfil: **sem erros de console**, tanto pelo servidor quanto abrindo `standalone/sentinel-3d.html` via `file://` (duplo clique), incluindo cenários, assistente, download de relatório e perfil Observador.
- FPS: **não verificado em GPU real.** O ambiente de desenvolvimento só tem renderização por software (1–5 FPS). A interface mostra o FPS medido na máquina do operador.

## Documentação
- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): requisitos, componentes, decisões, modelo de dados, regras, segurança, critérios de aceitação.
- [docs/CONTRATOS.md](docs/CONTRATOS.md): API, ingestão, eventos, diagnóstico.
- [docs/OPERADOR.md](docs/OPERADOR.md): manual do operador.

## Limitações conhecidas
- Geometria procedural (blockout PBR), não modelos do Blender. Caminho: GLB com Draco/KTX2 mantendo o `deviceId`.
- Persistência em arquivos locais; produção exige PostgreSQL + TimescaleDB.
- Autenticação de demonstração; produção exige IdP corporativo com MFA.
- Nível 3 de IA por templates determinísticos; integração com LLM desativada (guardrails em ARQUITETURA §8).
- Uma agência; a comparação entre agências exige ao menos duas cadastradas.
- Logotipo: nenhum ativo de marca foi usado. Para exibi-lo, coloque o arquivo oficial autorizado em `public/brand/logo.png` (ver `public/brand/README.md`).
- O mapa conceitual mostra uma câmera dentro dos sanitários; isso **não** foi reproduzido (privacidade/LGPD). A câmera fica no corredor de acesso.
- Descarga do UPS acelerada 30× e recarga instantânea ao encerrar o cenário C (simplificação de demonstração).

## Implantação e rollback (proposta)
1. Homologação em ambiente isolado, com gateway conectado somente em leitura a 1 agência piloto.
2. Implantar atrás de proxy TLS (HSTS) e IdP com `SENTINEL_DEMO_AUTH=0`.
3. Rollback: a plataforma é somente leitura e complementar. Desligar o serviço não afeta nenhum sistema de segurança física; basta restaurar a versão anterior e o diretório `data/`.
