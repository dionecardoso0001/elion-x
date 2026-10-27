# Manual do operador — SENTINEL 3D (modo demonstração)

## Tela principal
- **Topo:** indicadores gerais (dispositivos, operacionais, instáveis, falhas, sem comunicação, incidentes, energia medida, conectores, última atualização), seletor de agência, assistente **SENTINEL AI** e perfil.
- **Esquerda:** menu de 12 seções, filtros de categoria e condição, e simulador de cenários.
- **Centro:** gêmeo digital. **Direita:** painel do equipamento ou incidente selecionado. **Rodapé:** linha do tempo (clique leva ao item).

## Estados
| Ícone | Estado | Significado |
|---|---|---|
| ✔ círculo verde | Operacional | todas as regras atendidas com telemetria recente |
| ▲ amarelo | Instável | limiar de alerta ou anomalia estatística |
| ◆ vermelho | Falha crítica | condição crítica reportada (anel e feixe pulsantes no 3D) |
| ○ cinza | Desconectado | sem comunicação, com o caminho de rede a montante funcionando |
| ■ azul | Manutenção | marcado por um operador |
| ? roxo | Sem dados confiáveis | o caminho de telemetria caiu; o estado físico é **desconhecido** |

## Navegação
- **Aérea:** arraste para girar, use a roda para zoom e o botão direito para deslocar. Clique num marcador para selecionar.
- **Primeira pessoa:** clique na cena para entrar. W A S D ou setas andam, Shift corre, o mouse olha, clique seleciona o que está na mira e Esc libera o cursor. Paredes e móveis bloqueiam a passagem.
- **Transparente:** paredes translúcidas, tetos ocultos e cabos/dependências visíveis.
- **Planta 2D:** alternativa leve e acessível por teclado (Tab + Enter).
- **Dependências:** mostra os cabos lógicos (ciano = rede/PoE, âmbar = energia, roxo = gateway, cinza = supervisão).
- **Desempenho:** mostra sobre cada equipamento o seu indicador principal ao vivo (fps da câmera, latência/banda do link, CPU e temperatura de servidores, carga/autonomia do nobreak, kW do quadro, temperatura dos sensores). Em primeira pessoa, só os equipamentos a até 9 m.
- **Ampliar:** o gêmeo ocupa quase toda a tela.
- **Painel "Mapa de ativos"** (direita, sem seleção): status Online/Instável/Offline, monitoramento geral por domínio (clique filtra o 3D), ambientes 01–08 (clique voa até o ambiente), mapa de ativos com contagens (expanda para ver cada equipamento) e indicadores de desempenho.
- **Ir até no 3D** (painel, alerta, assistente ou timeline): a câmera voa até o equipamento.

## Tratando um incidente
1. Clique no alerta (toast, lista ou timeline). O painel mostra evidências, hipótese, confiança e critérios, ações recomendadas e incertezas.
2. **Reconhecer** registra quem assumiu. Críticos sem reconhecimento escalam a cada 60 s (demonstração).
3. Quando a telemetria normaliza, o incidente vira "Normalizado — aguardando encerramento".
4. **Resolver** exige uma nota com a resolução e a evidência. Tudo fica na auditoria.

## Cenários de demonstração
| Cenário | O que observar |
|---|---|
| A — Falha de câmera | CAM-018 em vermelho; "Perda de vídeo"; a câmera responde à rede mas não é operacional |
| B — Falha em switch | SW-03 desconectado, 3 câmeras roxas, **um** incidente com causa raiz provável SW-03 (confiança alta) |
| C — Problema elétrico | MTR-01 crítico, UPS em bateria com autonomia caindo (acelerada 30×), terminais sem energia |
| D — Alarme de incêndio | Recepção destacada, P1, protocolo de escalonamento; nenhuma atuação física |
| E — Telemetria desatualizada | GW-IOT-01 desconectado; sensores roxos com a última leitura e sua idade |
| F — Estado do mapa conceitual | CAM-020 (Área Restrita) offline e cofre instável, como no mapa fornecido |
| G — Queda do link principal | RTR-01 cai; RTR-02 (4G) assume com latência maior; rede segue operacional; um incidente de failover |
| H — Degradação térmica | Climatização perde rendimento; temperaturas sobem gradualmente (~60 s); um único incidente térmico |

Encerre cada cenário pelo botão **Encerrar** ou por **Encerrar todos**.

## Perfis
- **Observador:** vê áreas públicas; áreas restritas aparecem trancadas e ocorrências restritas vêm redigidas.
- **Operador NOC:** vê tudo, abre vídeo (auditado), reconhece e resolve incidentes, marca manutenção e roda cenários.
- **Administrador:** acrescenta trilha de auditoria e retenção.
