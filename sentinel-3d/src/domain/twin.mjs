// Agência DEMONSTRATIVA e FICTÍCIA, desenhada a partir do "Mapa de Ativos · Visão Conceitual"
// (planta baixa ilustrativa, sem escala) fornecido pelo cliente. Planta, posições de equipamentos e
// inventário NÃO representam nenhuma agência real; com plantas CAD/BIM autorizadas, substituir este arquivo.
// Coordenadas em metros: X = largura (0→36), Z = profundidade (0 = fundos, 20 = fachada), Y = altura.
//
// Desvio consciente do mapa conceitual: o mapa mostra uma câmera DENTRO dos sanitários. Câmera em
// sanitário viola a privacidade (LGPD); ela foi posicionada no corredor de acesso (CAM-022).

export const ORGANIZATION = { id: 'org-demo', name: 'Organização demonstrativa' };

const WALL_H = 3.2;
const W = 36, D = 20;

// num/desc seguem a legenda do mapa conceitual; ambientes auxiliares não têm número.
const ROOMS = [
  { id: 'suporte',     num: '06', tech: true, short: 'Suporte Técnico', name: 'Suporte Técnico', desc: 'Equipamentos de TI e infraestrutura', x0: 0,    z0: 0,    x1: 12.5, z1: 5,  restricted: true,  floor: 'tech' },
  { id: 'arquivo',     short: 'Arquivo',         name: 'Arquivo (back-office)', desc: 'Armários e documentos',               x0: 12.5, z0: 0,    x1: 16.5, z1: 5,  restricted: true,  floor: 'tile' },
  { id: 'restrita',    num: '07', short: 'Área Restrita',   name: 'Área Restrita',   desc: 'Back-office e áreas internas',        x0: 16.5, z0: 0,    x1: 29.5, z1: 5,  restricted: true,  floor: 'tile' },
  { id: 'admin',       short: 'Administrativo',  name: 'Administrativo',  desc: 'Escritório administrativo',                    x0: 29.5, z0: 0,    x1: 36,   z1: 5,  restricted: false, floor: 'wood' },
  { id: 'autoatend',   num: '01', short: 'Autoatendimento', name: 'Autoatendimento', desc: 'Caixas eletrônicos e serviços rápidos', x0: 0,  z0: 5,    x1: 11,   z1: 20, restricted: false, floor: 'stone' },
  { id: 'atendimento', num: '04', short: 'Atendimento',     name: 'Atendimento',     desc: 'Mesas de atendimento ao cliente',     x0: 11,   z0: 5,    x1: 29,   z1: 10.5, restricted: false, floor: 'tile' },
  { id: 'recepcao',    num: '02', short: 'Recepção',        name: 'Recepção',        desc: 'Acolhimento e totens de senha',       x0: 11,   z0: 10.5, x1: 19.5, z1: 18, restricted: false, floor: 'tile' },
  { id: 'espera',      num: '03', short: 'Espera',          name: 'Espera',          desc: 'Área de espera para clientes',        x0: 19.5, z0: 10.5, x1: 29,   z1: 18, restricted: false, floor: 'tile' },
  { id: 'circulacao',  short: 'Circulação',      name: 'Circulação',      desc: 'Corredor de acesso',                           x0: 29,   z0: 5,    x1: 30.5, z1: 18, restricted: false, floor: 'tile' },
  { id: 'gerencia',    num: '05', short: 'Gerência',        name: 'Gerência',        desc: 'Sala de gerência e reuniões',         x0: 30.5, z0: 5,    x1: 36,   z1: 11, restricted: false, floor: 'wood' },
  { id: 'reuniao',     short: 'Reunião',         name: 'Sala de reunião', desc: 'Reuniões com clientes',                        x0: 30.5, z0: 11,   x1: 36,   z1: 14.5, restricted: false, floor: 'wood' },
  { id: 'sanitarios',  num: '08', short: 'Sanitários',      name: 'Sanitários',      desc: 'Sanitário público (acessível)',       x0: 30.5, z0: 14.5, x1: 36,   z1: 18, restricted: false, floor: 'stone' },
  { id: 'entrada',     short: 'Entrada',         name: 'Entrada / Vestíbulo', desc: 'Acesso principal envidraçado',             x0: 11,   z0: 18,   x1: 36,   z1: 20, restricted: false, floor: 'stone' },
];

// Segmentos de parede horizontais/verticais; doors: posição ao longo do eixo + largura.
const WALLS = [
  // externas
  { a: [0, 0], b: [W, 0], kind: 'wall' },
  { a: [0, 0], b: [0, D], kind: 'wall' },
  { a: [W, 0], b: [W, D], kind: 'wall' },
  { a: [0, D], b: [W, D], kind: 'glass', doors: [{ at: 7, w: 1.8 }, { at: 14.5, w: 3 }] },
  // fileira dos fundos (06 · arquivo · 07 · administrativo)
  { a: [0, 5], b: [W, 5], kind: 'wall', doors: [{ at: 11.8, w: 1.1 }, { at: 14.5, w: 1.1 }, { at: 22, w: 1.1 }, { at: 29.8, w: 0.9 }] },
  { a: [12.5, 0], b: [12.5, 5], kind: 'wall' },
  { a: [16.5, 0], b: [16.5, 5], kind: 'wall' },
  { a: [29.5, 0], b: [29.5, 5], kind: 'wall' },
  // 01 autoatendimento: vidro para o salão, porta 24 h própria na fachada
  { a: [11, 5], b: [11, 20], kind: 'glass', doors: [{ at: 7.5, w: 2 }] },
  // 04 atendimento | 02 recepção (parede da marca, com passagem)
  { a: [11, 10.5], b: [19.5, 10.5], kind: 'wall', doors: [{ at: 18.6, w: 1.6 }] },
  // 02 recepção | 03 espera: divisória baixa
  { a: [19.5, 10.5], b: [19.5, 13.5], kind: 'low' },
  // vestíbulo: vidro interno com porta (antecâmara)
  { a: [11, 18], b: [29, 18], kind: 'glass', doors: [{ at: 14.5, w: 2.2 }] },
  // circulação
  { a: [29, 5], b: [29, 18], kind: 'wall', doors: [{ at: 8, w: 1.4 }, { at: 15.5, w: 1.4 }] },
  { a: [30.5, 5], b: [30.5, 18], kind: 'wall', doors: [{ at: 8, w: 1 }, { at: 12.8, w: 1 }, { at: 16.2, w: 1 }] },
  { a: [30.5, 11], b: [W, 11], kind: 'wall' },
  { a: [30.5, 14.5], b: [W, 14.5], kind: 'wall' },
  { a: [29, 18], b: [W, 18], kind: 'wall', doors: [{ at: 29.75, w: 1.3 }] },
];

const FURNITURE = [
  // 06 Suporte Técnico — racks, bancada e armários
  { kind: 'rack', x: 6, z: 0.8 }, { kind: 'rack', x: 7.2, z: 0.8 }, { kind: 'rack', x: 8.4, z: 0.8 },
  { kind: 'lockers', x: 2.2, z: 0.45, w: 3.6 }, { kind: 'cabinets', x: 7.5, z: 4.55, w: 7 },
  { kind: 'desk', x: 2.6, z: 3.2 }, { kind: 'chair', x: 2.6, z: 2.3 }, { kind: 'person', x: 2.6, z: 2.3, pose: 'sit', color: 0x1e3a5f },
  // arquivo
  { kind: 'cabinets', x: 14.5, z: 0.45, w: 3.6 }, { kind: 'plant', x: 15.8, z: 3.9 },
  // 07 Área Restrita — mesas de back-office e armários
  { kind: 'cabinets', x: 21, z: 0.45, w: 6 }, { kind: 'desk', x: 19.5, z: 3 }, { kind: 'chair', x: 19.5, z: 2.1 },
  { kind: 'desk', x: 23, z: 3 }, { kind: 'chair', x: 23, z: 2.1 }, { kind: 'plant', x: 25.5, z: 4.2 },
  // administrativo
  { kind: 'desk', x: 33, z: 1.8 }, { kind: 'chair', x: 33, z: 0.9 }, { kind: 'person', x: 33, z: 0.9, pose: 'sit', color: 0x374151 },
  { kind: 'cabinets', x: 35.55, z: 2.5, w: 3, rot: Math.PI / 2 }, { kind: 'plant', x: 30.2, z: 4.3 },
  // 01 Autoatendimento — parede vermelha dos terminais, bancada, mesa redonda, bancos de ripas
  { kind: 'redwall', x: 0.08, z: 12.5, w: 11, rot: Math.PI / 2 },
  { kind: 'counter', x: 6.6, z: 7.5, w: 2.8 },
  { kind: 'bench', x: 5.0, z: 11.6, rot: Math.PI / 2 }, { kind: 'bench', x: 8.4, z: 11.6, rot: Math.PI / 2 },
  { kind: 'roundtable', x: 6.6, z: 14.5 }, { kind: 'person', x: 6.6, z: 13.8, pose: 'sit', color: 0x4b5563 },
  { kind: 'armchair', x: 5.6, z: 17.2 }, { kind: 'table', x: 6.8, z: 17.2 },
  ...[[2.5, 6], [9.8, 6.2], [4.6, 9.5], [9.8, 16.5], [3.5, 18.8]].map(([x, z]) => ({ kind: 'plant', x, z })),
  // 04 Atendimento — 5 posições com painel vermelho, painéis na parede de fundo
  ...[14.8, 17.6, 20.4, 23.2, 26].flatMap((x) => [
    { kind: 'desk', x, z: 8, front: true }, { kind: 'chair', x, z: 7.1 }, { kind: 'person', x, z: 7.1, pose: 'sit', color: 0x14532d },
    { kind: 'chair', x, z: 9.2, rot: Math.PI },
  ]),
  ...[17.4, 20.8, 24.6].map((x) => ({ kind: 'redpanel', x, z: 5.09 })),
  ...[[12, 5.8], [28.2, 5.8], [16.2, 9.9], [21.8, 9.9]].map(([x, z]) => ({ kind: 'plant', x, z })),
  // 02 Recepção — parede da marca, balcão, painéis de ripas
  { kind: 'brandwall', x: 15.2, z: 10.62 },
  { kind: 'counter', x: 15.2, z: 13.4, w: 5.5 }, { kind: 'chair', x: 14, z: 12.6 }, { kind: 'chair', x: 16.4, z: 12.6 },
  { kind: 'person', x: 14, z: 12.6, pose: 'sit', color: 0x991b1b },
  { kind: 'slats', x: 11.9, z: 11.4 }, { kind: 'slats', x: 18.6, z: 11.4 },
  ...[[12.3, 16.8], [18.6, 16.8], [18.7, 12.3]].map(([x, z]) => ({ kind: 'plant', x, z })),
  // 03 Espera — sofá vermelho, mesa redonda, poltronas, sofá cinza com clientes
  { kind: 'sofa', x: 21.5, z: 13.6, rot: Math.PI / 2 }, { kind: 'table', x: 23.6, z: 12.3 },
  { kind: 'armchair', x: 26.6, z: 12.2, color: 'dark' }, { kind: 'armchair', x: 27.8, z: 15.8, color: 'grey', rot: -Math.PI / 2 },
  { kind: 'sofa', x: 24, z: 16.6, color: 'grey' },
  { kind: 'person', x: 23.4, z: 16.6, pose: 'sofa', color: 0x1e40af }, { kind: 'person', x: 24.6, z: 16.6, pose: 'sofa', color: 0x334155 },
  ...[[20.4, 11.3], [20.4, 16.9], [28.3, 11.2], [28.3, 17.4]].map(([x, z]) => ({ kind: 'plant', x, z })),
  // poltronas vermelhas junto ao vidro interno
  ...[22, 23.4, 25.6, 27].map((x) => ({ kind: 'armchair', x, z: 17.35, rot: Math.PI })),
  // 05 Gerência — mesa do gerente e mesa de reunião
  { kind: 'desk', x: 33.3, z: 6.9 }, { kind: 'chair', x: 33.3, z: 6.0 }, { kind: 'person', x: 33.3, z: 6.0, pose: 'sit', color: 0x111827 },
  { kind: 'chair', x: 32.8, z: 7.9, rot: Math.PI }, { kind: 'chair', x: 33.8, z: 7.9, rot: Math.PI },
  { kind: 'meeting', x: 33.3, z: 9.6 }, { kind: 'plant', x: 35.4, z: 5.6 },
  // sala de reunião
  { kind: 'roundtable', x: 33.3, z: 12.8 }, { kind: 'plant', x: 35.4, z: 14 },
  // 08 Sanitários — cabines e sinalização de acessibilidade
  { kind: 'stall', x: 32, z: 16.3 }, { kind: 'stall', x: 34.2, z: 16.3 }, { kind: 'accessible', x: 30.62, z: 16.9 },
  // externo: floreiras, balizadores, capacho
  { kind: 'flowerbed', x: 5.2, z: 21.2, w: 9.5 }, { kind: 'flowerbed', x: 23.5, z: 21.2, w: 11 },
  ...[0.4, 10.6, 18.4, 29.6, 35.6].map((x) => ({ kind: 'lamp', x, z: 21.9 })),
  { kind: 'doormat', x: 14.5, z: 20.9 },
];

// Fábrica de dispositivos — metadados SINTÉTICOS. Fabricante/modelo "a definir" porque inventar
// marcas reais sugeriria integração que não existe.
let seq = 0;
function dev(id, name, type, room, pos, extra = {}) {
  seq += 1;
  return {
    id, name, type, room, pos,
    manufacturer: 'Fabricante a definir (demo)',
    model: 'Modelo genérico (demo)',
    serial: `DEMO-SN-${String(1000 + seq)}`,          // sensível: só perfis autorizados
    ip: `10.99.${Math.floor(seq / 50)}.${10 + (seq % 50)}`, // faixa fictícia, sensível
    owner: extra.owner || 'Equipe NOC (demo)',
    lastMaintenance: extra.lastMaintenance || '2026-08-15',
    source: { connector: 'simulador', protocol: 'SIMULADO', note: 'Telemetria sintética — nenhum equipamento físico conectado' },
    ...extra,
  };
}

const R = 1.25; // face frontal dos racks (z)
const rackY = (i) => 1.85 - i * 0.15;
const DEVICES = [
  // 06 Suporte Técnico — rack de rede (x = 6)
  ...[['RTR-01', 'Roteador — Link WAN principal', 'router'], ['RTR-02', 'Roteador — Link secundário (4G/LTE)', 'router'], ['FW-01', 'Firewall de borda', 'firewall'],
    ['SW-CORE-01', 'Switch de distribuição', 'switch'], ['SW-01', 'Switch PoE de acesso 01', 'switch'], ['SW-02', 'Switch PoE de acesso 02', 'switch'],
    ['SW-03', 'Switch PoE de acesso 03', 'switch'], ['GW-IOT-01', 'Gateway IoT supervisionado', 'gateway']]
    .map(([id, name, type], i) => dev(id, name, type, 'suporte', [6, rackY(i), R])),
  // rack de CFTV (x = 7.2) e de servidores (x = 8.4)
  dev('NVR-01', 'NVR 01 — gravação', 'nvr', 'suporte', [7.2, 1.35, R]),
  dev('NVR-02', 'NVR 02 — gravação', 'nvr', 'suporte', [7.2, 1.05, R]),
  dev('SRV-01', 'Host de virtualização', 'server', 'suporte', [8.4, 1.5, R]),
  dev('VMS-01', 'Servidor VMS', 'vms', 'suporte', [8.4, 1.2, R]),
  dev('STG-01', 'Storage de gravações', 'storage', 'suporte', [8.4, 0.9, R]),
  dev('PDU-01', 'PDU monitorável', 'pdu', 'suporte', [8.85, 1.0, 0.8]),
  dev('UPS-01', 'Nobreak 01 — TI', 'ups', 'suporte', [10.0, 0.6, 0.9]),
  dev('UPS-02', 'Nobreak 02 — CFTV', 'ups', 'suporte', [11.1, 0.6, 0.9]),
  dev('MTR-01', 'Medidor inteligente do QDG', 'meter', 'suporte', [0.12, 1.5, 3.2]),
  dev('HVAC-01', 'Climatização do Suporte Técnico', 'hvac', 'suporte', [9.2, 2.6, 4.82]),
  dev('TH-01', 'Sensor temp./umidade — racks', 'th', 'suporte', [12.38, 2.0, 2.4]),
  dev('TH-02', 'Sensor temp./umidade — Suporte Técnico', 'th', 'suporte', [0.1, 2.2, 1.6]),
  dev('SD-01', 'Detector de fumaça — Suporte Técnico', 'smoke', 'suporte', [6, 3.12, 2.8]),
  dev('DOOR-01', 'Contato magnético — porta do Suporte Técnico', 'sensor', 'suporte', [11.8, 2.15, 4.92], { sensorKind: 'contato' }),
  dev('CAM-021', 'Câmera dome — Suporte Técnico', 'camera', 'suporte', [0.4, 2.9, 0.4], { camKind: 'dome' }),
  // 07 Área Restrita
  dev('VAULT-01', 'Cofre instrumentado (status lógico)', 'vault', 'restrita', [27.6, 1.0, 0.95]),
  dev('VIB-01', 'Sensor de vibração do cofre', 'sensor', 'restrita', [28.45, 1.6, 0.95], { sensorKind: 'vibração' }),
  dev('ALM-01', 'Central de alarme', 'alarmpanel', 'restrita', [17.1, 1.5, 4.88]),
  dev('ACC-01', 'Controladora de acesso', 'access', 'restrita', [18.1, 1.8, 4.88]),
  dev('PIR-01', 'Sensor de presença — Área Restrita', 'sensor', 'restrita', [29.2, 2.8, 0.3], { sensorKind: 'presença' }),
  dev('SD-02', 'Detector de fumaça — Área Restrita', 'smoke', 'restrita', [23, 3.12, 2.5]),
  dev('CAM-020', 'Câmera PTZ — Área Restrita', 'camera', 'restrita', [17.3, 2.9, 0.4], { camKind: 'ptz' }),
  // administrativo
  dev('FACP-01', 'Central de detecção de incêndio', 'facp', 'admin', [30.2, 1.5, 4.88]),
  dev('AP-02', 'Access Point — Administrativo', 'ap', 'admin', [32.7, 3.15, 2.5]),
  // 01 Autoatendimento
  ...[9.5, 11.5, 13.5, 15.5].map((z, i) => dev(`ATM-0${i + 1}`, `Terminal de autoatendimento 0${i + 1}`, 'atm', 'autoatend', [0.55, 0.8, z])),
  dev('CAM-011', 'Câmera dome — Autoatendimento norte', 'camera', 'autoatend', [0.35, 2.9, 6.6], { camKind: 'dome' }),
  dev('CAM-012', 'Câmera dome — Autoatendimento sul', 'camera', 'autoatend', [0.35, 2.9, 17.6], { camKind: 'dome' }),
  // 04 Atendimento
  dev('CAM-017', 'Câmera dome — Atendimento oeste', 'camera', 'atendimento', [11.4, 2.9, 5.4], { camKind: 'dome' }),
  dev('CAM-018', 'Câmera dome — Atendimento leste', 'camera', 'atendimento', [28.6, 2.9, 5.4], { camKind: 'dome' }),
  dev('AP-01', 'Access Point — Atendimento', 'ap', 'atendimento', [16, 3.15, 7.6]),
  dev('TH-03', 'Sensor temp./umidade — Atendimento', 'th', 'atendimento', [19.5, 2.2, 5.08]),
  dev('SD-03', 'Detector de fumaça — Atendimento', 'smoke', 'atendimento', [21.5, 3.12, 8.6]),
  dev('RDR-01', 'Leitora de credenciais — Área Restrita', 'reader', 'atendimento', [21.2, 1.3, 5.08]),
  // 02 Recepção
  dev('CAM-014', 'Câmera dome — Recepção', 'camera', 'recepcao', [11.4, 2.9, 10.9], { camKind: 'dome' }),
  dev('SD-04', 'Detector de fumaça — Recepção', 'smoke', 'recepcao', [15.2, 3.12, 14.8]),
  dev('TOT-01', 'Totem de senhas', 'totem', 'recepcao', [11.9, 0.8, 15]),
  // 03 Espera
  dev('CAM-016', 'Câmera dome — Espera', 'camera', 'espera', [28.6, 2.9, 14.2], { camKind: 'dome' }),
  // 05 Gerência
  dev('CAM-019', 'Câmera dome — Gerência', 'camera', 'gerencia', [35.6, 2.9, 5.4], { camKind: 'dome' }),
  // circulação — câmera do acesso aos sanitários (fora do sanitário, por privacidade)
  dev('CAM-022', 'Câmera dome — Corredor dos sanitários', 'camera', 'circulacao', [29.75, 2.9, 17.6], { camKind: 'dome' }),
  // entrada / vestíbulo
  dev('CAM-013', 'Câmera dome — Entrada oeste', 'camera', 'entrada', [12.3, 2.9, 19.65], { camKind: 'dome' }),
  dev('CAM-015', 'Câmera dome — Entrada leste', 'camera', 'entrada', [16.9, 2.9, 19.65], { camKind: 'dome' }),
  dev('MCP-01', 'Acionador manual de incêndio — Entrada', 'mcp', 'entrada', [11.12, 1.3, 19.0]),
];

// Grafo de dependências. kind: 'conhecida' = cadastrada pela engenharia;
// relações inferidas são produzidas em tempo de execução pelo motor de correlação.
function edges(from, type, tos, extra = {}) { return tos.map((to) => ({ from, to, type, kind: 'conhecida', ...extra })); }
const CAMS = DEVICES.filter((d) => d.type === 'camera').map((d) => d.id);
const DEPENDENCIES = [
  // links redundantes: o firewall só perde caminho se AMBOS caírem
  ...edges('RTR-01', 'network', ['FW-01'], { redundant: true }),
  ...edges('RTR-02', 'network', ['FW-01'], { redundant: true }),
  ...edges('FW-01', 'network', ['SW-CORE-01']),
  ...edges('SW-CORE-01', 'network', ['SW-01', 'SW-02', 'SW-03', 'SRV-01', 'VMS-01', 'STG-01', 'NVR-01', 'NVR-02', 'GW-IOT-01', 'ALM-01', 'ACC-01', 'FACP-01', 'ATM-01', 'ATM-02', 'ATM-03', 'ATM-04', 'TOT-01', 'UPS-01', 'UPS-02', 'PDU-01']),
  ...edges('SW-01', 'poe', ['CAM-011', 'CAM-012', 'CAM-013', 'CAM-021', 'CAM-022']),
  ...edges('SW-02', 'poe', ['CAM-017', 'CAM-018', 'CAM-019', 'CAM-020', 'AP-01', 'AP-02']),
  ...edges('SW-03', 'poe', ['CAM-014', 'CAM-015', 'CAM-016']),
  ...edges('VMS-01', 'managed-by', CAMS),
  ...edges('GW-IOT-01', 'data-path', ['TH-01', 'TH-02', 'TH-03', 'HVAC-01', 'MTR-01']),
  ...edges('ALM-01', 'supervision', ['PIR-01', 'VIB-01', 'DOOR-01', 'VAULT-01']),
  ...edges('ACC-01', 'supervision', ['RDR-01']),
  ...edges('FACP-01', 'supervision', ['SD-01', 'SD-02', 'SD-03', 'SD-04', 'MCP-01']),
  // MTR-01 mede o QDG; arestas "power" a partir dele representam os circuitos do quadro.
  // Centrais de alarme e de incêndio possuem bateria própria (exigência normativa).
  ...edges('MTR-01', 'power', ['UPS-01', 'UPS-02', 'HVAC-01', 'ATM-01', 'ATM-02', 'ATM-03', 'ATM-04', 'TOT-01', 'FACP-01', 'ALM-01']),
  ...edges('UPS-01', 'power', ['RTR-01', 'RTR-02', 'FW-01', 'SW-CORE-01', 'SRV-01', 'STG-01', 'PDU-01', 'GW-IOT-01']),
  ...edges('UPS-02', 'power', ['SW-01', 'SW-02', 'SW-03', 'NVR-01', 'NVR-02', 'VMS-01']),
  // arrefecimento: equipamentos e sensores na zona térmica da climatização do Suporte Técnico
  ...edges('HVAC-01', 'cooling', ['SRV-01', 'STG-01', 'VMS-01', 'NVR-01', 'NVR-02', 'SW-CORE-01', 'FW-01', 'UPS-01', 'UPS-02', 'TH-01', 'TH-02']),
];

// Agrupamentos do "Mapa de Ativos" e do "Monitoramento Geral" do mapa conceitual.
export const ASSET_GROUPS = [
  { id: 'cameras', label: 'Câmeras IP', types: ['camera'] },
  { id: 'nvr', label: 'NVR / DVR', types: ['nvr'] },
  { id: 'switches', label: 'Switches / Wi-Fi', types: ['switch', 'ap'] },
  { id: 'routers', label: 'Roteador / Links', types: ['router'] },
  { id: 'ups', label: 'Nobreak / Energia', types: ['ups'] },
  { id: 'smoke', label: 'Detecção de fumaça', types: ['smoke'] },
  { id: 'env', label: 'Sensores ambientais', types: ['th'] },
  { id: 'atm', label: 'ATMs', types: ['atm'] },
  { id: 'vault', label: 'Cofres (status lógico)', types: ['vault'] },
];
export const MONITOR_DOMAINS = [
  { id: 'cftv', label: 'CFTV', categories: ['cftv'] },
  { id: 'rede', label: 'Rede', categories: ['rede'] },
  { id: 'energia', label: 'Energia', categories: ['energia'] },
  { id: 'clima', label: 'Climatização', categories: ['ambiente'] },
  { id: 'incendio', label: 'Incêndio', categories: ['incendio'] },
  { id: 'seguranca', label: 'Segurança', categories: ['seguranca'] },
  { id: 'servidor', label: 'Servidores', categories: ['servidor'] },
  { id: 'autoatend', label: 'Autoatend.', categories: ['autoatend'] },
];

export const AGENCIES = [
  {
    id: 'AG-DEMO-001',
    name: 'Agência Demonstrativa 001',
    city: 'Cidade fictícia',
    timezone: 'America/Sao_Paulo',
    demo: true,
    disclaimer: 'Planta demonstrativa fictícia baseada no mapa conceitual (sem escala) — não representa a arquitetura de nenhuma agência real.',
    floors: [{ id: 'T', name: 'Térreo', elevation: 0 }],
    bounds: { x: W, z: D, wallHeight: WALL_H },
    rooms: ROOMS.map((r) => ({ ...r, floorId: 'T' })),
    walls: WALLS,
    furniture: FURNITURE,
    assetGroups: ASSET_GROUPS,
    monitorDomains: MONITOR_DOMAINS,
  },
];

export function buildTwin() {
  // cópias profundas: o estado de runtime nunca altera a definição de referência
  const devices = structuredClone(DEVICES).map((d) => ({ ...d, agencyId: 'AG-DEMO-001', floorId: 'T' }));
  return {
    organization: ORGANIZATION,
    agencies: structuredClone(AGENCIES),
    devices,
    dependencies: structuredClone(DEPENDENCIES),
  };
}
