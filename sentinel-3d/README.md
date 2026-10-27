# SENTINEL 3D — Digital Twin Intelligence Platform

> **MODO DEMONSTRAÇÃO — DADOS SIMULADOS.** Planta e inventário fictícios. Nenhum equipamento físico está conectado,
> e a planta não representa a arquitetura de nenhuma agência real. Não está pronto para produção.

Gêmeo digital 3D de uma agência bancária demonstrativa com monitoramento de CFTV, rede, servidores, energia, alarmes e incêndio. O núcleo é um motor de regras, correlação por grafo de dependências e diagnóstico explicável (fatos, hipótese, confiança por critérios, recomendações e incertezas).

## Executar
```bash
cd sentinel-3d
npm install        # única dependência: three@0.185.1
npm start          # http://127.0.0.1:8730
npm test           # 23 testes: motor, cenários A–E, regressão, API, autorização
```
Requer Node.js ≥ 20. A sessão inicia como **Operador NOC**; troque o perfil no topo.

| Variável | Padrão | Efeito |
|---|---|---|
| `PORT` | 8730 | porta HTTP (escuta só em 127.0.0.1) |
| `SENTINEL_INGEST_TOKEN` | vazio | habilita `POST /api/ingest` para gateway real |
| `SENTINEL_DEMO_AUTH` | 1 | `0` desativa a escolha livre de perfil (exigir IdP) |

Os dados de execução (incidentes, eventos, auditoria) ficam em `sentinel-3d/data/`, fora do versionamento. Para recomeçar do zero, apague essa pasta.

## Primeira demonstração (3 min)
1. Gêmeo 3D na visão aérea: gire, aproxime e clique num marcador.
2. Simulador → **B · Falha em switch**. Em ~8 s, o SW-03 fica desconectado, as câmeras ficam roxas e abre **um** incidente com causa raiz provável e confiança alta; a câmera voa até o switch.
3. **Transparente** + **Dependências**: veja os cabos afetados em vermelho.
4. **Primeira pessoa**: entre pela porta e caminhe até a recepção.
5. **SENTINEL AI** → "Qual a provável causa da falha das câmeras da recepção?"
6. Perfil **Observador**: áreas restritas trancadas e ocorrência redigida.

## O que foi verificado
- `npm test`: **23/23** aprovados, incluindo os testes de regressão que **falham sem a correção** de incidentes transitórios.
- Chromium (Playwright), em todos os modos de navegação, nas 12 seções e na troca de perfil: **sem erros de console**.
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
- Logotipo: nenhum ativo de marca foi usado. A identidade visual oficial só pode entrar com ativos autorizados.
- Descarga do UPS acelerada 30× e recarga instantânea ao encerrar o cenário C (simplificação de demonstração).

## Implantação e rollback (proposta)
1. Homologação em ambiente isolado, com gateway conectado somente em leitura a 1 agência piloto.
2. Implantar atrás de proxy TLS (HSTS) e IdP com `SENTINEL_DEMO_AUTH=0`.
3. Rollback: a plataforma é somente leitura e complementar. Desligar o serviço não afeta nenhum sistema de segurança física; basta restaurar a versão anterior e o diretório `data/`.
