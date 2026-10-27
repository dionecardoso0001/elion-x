// Agência DEMONSTRATIVA e FICTÍCIA. Planta, posições de equipamentos e inventário
// foram criados para a demonstração e NÃO representam nenhuma agência real.
// Coordenadas em metros: X = largura (0→32), Z = profundidade (0 = fundos, 22 = fachada), Y = altura.

export const ORGANIZATION = { id: 'org-demo', name: 'Organização demonstrativa' };

const WALL_H = 3.2;

const ROOMS = [
  { id: 'tec-cftv', short: 'CFTV / Rede',   name: 'Sala Técnica CFTV / Rede',  x0: 0,    z0: 0,  x1: 4.5, z1: 5,  restricted: true,  floor: 'tech' },
  { id: 'servidores', short: 'CPD', name: 'Sala de Servidores (CPD)',  x0: 4.5,  z0: 0,  x1: 9.5, z1: 5,  restricted: true,  floor: 'tech' },
  { id: 'tesouraria', short: 'Tesouraria', name: 'Área Restrita / Tesouraria', x0: 9.5,  z0: 0,  x1: 19.5, z1: 5, restricted: true,  floor: 'tile' },
  { id: 'admin', short: 'Administrativo',      name: 'Administrativo',            x0: 19.5, z0: 0,  x1: 32,  z1: 5,  restricted: false, floor: 'wood' },
  { id: 'autoatend', short: 'Autoatendimento',  name: 'Autoatendimento',           x0: 0,    z0: 5,  x1: 8,   z1: 22, restricted: false, floor: 'stone' },
  { id: 'atendimento', short: 'Atendimento',name: 'Atendimento / Guichês',     x0: 8,    z0: 5,  x1: 24,  z1: 11, restricted: false, floor: 'tile' },
  { id: 'gerencia', short: 'Gerência',   name: 'Gerência',                  x0: 24,   z0: 5,  x1: 32,  z1: 13, restricted: false, floor: 'wood' },
  { id: 'recepcao', short: 'Recepção',   name: 'Recepção',                  x0: 8,    z0: 11, x1: 16,  z1: 18, restricted: false, floor: 'tile' },
  { id: 'espera', short: 'Espera',     name: 'Espera',                    x0: 16,   z0: 11, x1: 24,  z1: 18, restricted: false, floor: 'tile' },
  { id: 'sanitarios', short: 'Sanitários', name: 'Sanitários',                x0: 24,   z0: 13, x1: 32,  z1: 18, restricted: false, floor: 'stone' },
  { id: 'entrada', short: 'Entrada',    name: 'Entrada / Fachada',         x0: 8,    z0: 18, x1: 32,  z1: 22, restricted: false, floor: 'stone' },
];

// Segmentos de parede (horizontais ou verticais). doors: posições ao longo do eixo do segmento.
const WALLS = [
  // externas
  { a: [0, 0], b: [32, 0], kind: 'wall' },
  { a: [0, 0], b: [0, 22], kind: 'wall' },
  { a: [32, 0], b: [32, 22], kind: 'wall' },
  { a: [0, 22], b: [32, 22], kind: 'glass', doors: [{ at: 4, w: 2 }, { at: 16, w: 3 }] },
  // fileira dos fundos
  { a: [0, 5], b: [32, 5], kind: 'wall', doors: [{ at: 2.2, w: 1.1 }, { at: 7, w: 1.1 }, { at: 13.2, w: 1.1 }, { at: 26, w: 1.4 }] },
  { a: [4.5, 0], b: [4.5, 5], kind: 'wall' },
  { a: [9.5, 0], b: [9.5, 5], kind: 'wall' },
  { a: [19.5, 0], b: [19.5, 5], kind: 'wall' },
  // autoatendimento separado por vidro, com passagem
  { a: [8, 5], b: [8, 22], kind: 'glass', doors: [{ at: 14, w: 2 }] },
  // lado direito
  { a: [24, 5], b: [24, 18], kind: 'wall', doors: [{ at: 9, w: 1.2 }, { at: 15.5, w: 1.2 }] },
  { a: [24, 13], b: [32, 13], kind: 'wall' },
  { a: [24, 18], b: [32, 18], kind: 'wall' },
  // divisória baixa entre recepção/espera e entrada
  { a: [8, 18], b: [13, 18], kind: 'low' },
  { a: [19, 18], b: [24, 18], kind: 'low' },
];

const FURNITURE = [
  // atendimento: 5 posições
  ...[10.5, 13.5, 16.5, 19.5, 22].map((x) => ({ kind: 'desk', x, z: 8, rot: 0 })),
  ...[10.5, 13.5, 16.5, 19.5, 22].map((x) => ({ kind: 'chair', x, z: 7.1, rot: 0 })),
  ...[10.5, 13.5, 16.5, 19.5, 22].map((x) => ({ kind: 'chair', x, z: 9.1, rot: Math.PI })),
  { kind: 'brandwall', x: 16, z: 5.06, rot: 0 },
  // recepção
  { kind: 'counter', x: 12, z: 14.5, rot: 0 },
  { kind: 'chair', x: 12, z: 13.6, rot: 0 },
  // espera
  { kind: 'sofa', x: 18.5, z: 15.8, rot: 0 },
  { kind: 'sofa', x: 21.5, z: 15.8, rot: 0 },
  { kind: 'sofa', x: 23.2, z: 13.2, rot: -Math.PI / 2 },
  { kind: 'table', x: 20, z: 13.8, rot: 0 },
  // gerência
  { kind: 'desk', x: 28, z: 7, rot: 0 }, { kind: 'chair', x: 28, z: 6.1, rot: 0 },
  { kind: 'meeting', x: 28, z: 10.8, rot: 0 },
  // administrativo
  ...[22, 25, 28.5].map((x) => ({ kind: 'desk', x, z: 2.2, rot: 0 })),
  ...[22, 25, 28.5].map((x) => ({ kind: 'chair', x, z: 1.3, rot: 0 })),
  // tesouraria
  { kind: 'desk', x: 17.5, z: 3.0, rot: 0 }, { kind: 'chair', x: 17.5, z: 2.1, rot: 0 },
  // sanitários
  { kind: 'stall', x: 26, z: 15.5, rot: 0 }, { kind: 'stall', x: 28, z: 15.5, rot: 0 }, { kind: 'stall', x: 30, z: 15.5, rot: 0 },
  // racks (estrutura física; equipamentos monitorados ficam dentro)
  { kind: 'rack', x: 1.4, z: 0.8, rot: 0 }, { kind: 'rack', x: 2.8, z: 0.8, rot: 0 }, { kind: 'rack', x: 5.6, z: 0.8, rot: 0 },
  // plantas
  ...[[9, 12], [15, 12], [17, 17], [23.3, 17.3], [8.7, 17.2], [9, 5.8], [23.2, 5.8], [31.3, 12.3], [7.3, 6], [7.3, 21]].map(([x, z]) => ({ kind: 'plant', x, z, rot: 0 })),
  // bancos externos / floreiras da fachada
  { kind: 'planter', x: 11, z: 22.7, rot: 0 }, { kind: 'planter', x: 24, z: 22.7, rot: 0 },
];

// Fábrica de dispositivos — metadados SINTÉTICOS. Fabricante/modelo ficam como
// "a definir" porque inventar marcas reais sugeriria integração que não existe.
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

const R = 1.25; // face frontal do rack
const DEVICES = [
  // Sala técnica — rack de rede
  dev('RTR-01', 'Roteador / Link WAN', 'router', 'tec-cftv', [1.4, 1.75, R]),
  dev('FW-01', 'Firewall de borda', 'firewall', 'tec-cftv', [1.4, 1.58, R]),
  dev('SW-CORE-01', 'Switch de distribuição', 'switch', 'tec-cftv', [1.4, 1.41, R]),
  dev('SW-01', 'Switch PoE de acesso 01', 'switch', 'tec-cftv', [1.4, 1.24, R]),
  dev('SW-02', 'Switch PoE de acesso 02', 'switch', 'tec-cftv', [1.4, 1.07, R]),
  dev('SW-03', 'Switch PoE de acesso 03', 'switch', 'tec-cftv', [1.4, 0.90, R]),
  dev('GW-IOT-01', 'Gateway IoT supervisionado', 'gateway', 'tec-cftv', [1.4, 0.73, R]),
  dev('NVR-01', 'NVR de gravação', 'nvr', 'tec-cftv', [2.8, 1.2, R]),
  dev('MTR-01', 'Medidor inteligente do QDG', 'meter', 'tec-cftv', [0.12, 1.5, 3.5]),
  dev('TH-02', 'Sensor temp./umidade — Sala técnica', 'th', 'tec-cftv', [0.1, 2.2, 2.0]),
  dev('SD-01', 'Detector de fumaça — Sala técnica', 'smoke', 'tec-cftv', [2.2, 3.12, 2.5]),
  dev('CAM-021', 'Câmera dome — Sala técnica', 'camera', 'tec-cftv', [4.2, 2.9, 4.7], { camKind: 'dome' }),
  // CPD
  dev('SRV-01', 'Host de virtualização', 'server', 'servidores', [5.6, 1.5, R]),
  dev('VMS-01', 'Servidor VMS', 'vms', 'servidores', [5.6, 1.2, R]),
  dev('STG-01', 'Storage de gravações', 'storage', 'servidores', [5.6, 0.9, R]),
  dev('PDU-01', 'PDU monitorável', 'pdu', 'servidores', [6.05, 1.0, 0.8]),
  dev('UPS-01', 'Nobreak 01 — TI', 'ups', 'servidores', [7.3, 0.6, 0.9]),
  dev('UPS-02', 'Nobreak 02 — CFTV', 'ups', 'servidores', [8.4, 0.6, 0.9]),
  dev('HVAC-01', 'Climatização do CPD', 'hvac', 'servidores', [7.0, 2.6, 4.82]),
  dev('TH-01', 'Sensor temp./umidade — CPD', 'th', 'servidores', [9.38, 2.0, 2.5]),
  dev('LK-01', 'Sensor de vazamento — CPD', 'leak', 'servidores', [6.6, 0.03, 2.2]),
  dev('SD-02', 'Detector de fumaça — CPD', 'smoke', 'servidores', [7.0, 3.12, 2.5]),
  dev('DOOR-01', 'Contato magnético — porta CPD', 'sensor', 'servidores', [7.0, 2.15, 4.92], { sensorKind: 'contato' }),
  dev('CAM-022', 'Câmera dome — CPD', 'camera', 'servidores', [9.2, 2.9, 0.3], { camKind: 'dome' }),
  // Tesouraria
  dev('VAULT-01', 'Cofre instrumentado', 'vault', 'tesouraria', [14.5, 1.0, 0.95]),
  dev('VIB-01', 'Sensor de vibração do cofre', 'sensor', 'tesouraria', [15.35, 1.6, 0.95], { sensorKind: 'vibração' }),
  dev('ALM-01', 'Central de alarme', 'alarmpanel', 'tesouraria', [10.2, 1.5, 4.88]),
  dev('ACC-01', 'Controladora de acesso', 'access', 'tesouraria', [11.2, 1.8, 4.88]),
  dev('RDR-01', 'Leitora de credenciais — Tesouraria', 'reader', 'atendimento', [12.3, 1.3, 5.08]),
  dev('PIR-01', 'Sensor de presença — Tesouraria', 'sensor', 'tesouraria', [19.2, 2.8, 0.3], { sensorKind: 'presença' }),
  dev('SD-03', 'Detector de fumaça — Tesouraria', 'smoke', 'tesouraria', [14.5, 3.12, 3.0]),
  dev('CAM-020', 'Câmera PTZ — Tesouraria', 'camera', 'tesouraria', [9.8, 2.9, 0.3], { camKind: 'ptz' }),
  // Administrativo
  dev('FACP-01', 'Central de detecção de incêndio', 'facp', 'admin', [20.0, 1.5, 4.88]),
  dev('AP-02', 'Access Point — Administrativo', 'ap', 'admin', [26, 3.15, 2.5]),
  // Autoatendimento
  ...[8, 10.5, 13, 15.5].map((z, i) => dev(`ATM-0${i + 1}`, `Terminal de autoatendimento 0${i + 1}`, 'atm', 'autoatend', [0.45, 0.8, z])),
  dev('CAM-011', 'Câmera fixa — Autoatendimento fundo', 'camera', 'autoatend', [0.4, 2.9, 5.4], { camKind: 'bullet' }),
  dev('CAM-012', 'Câmera fixa — Autoatendimento entrada', 'camera', 'autoatend', [7.6, 2.9, 21.6], { camKind: 'bullet' }),
  dev('SD-05', 'Detector de fumaça — Autoatendimento', 'smoke', 'autoatend', [4, 3.12, 13]),
  // Atendimento
  dev('CAM-017', 'Câmera dome — Atendimento oeste', 'camera', 'atendimento', [8.4, 2.9, 5.4], { camKind: 'dome' }),
  dev('CAM-018', 'Câmera dome — Atendimento leste', 'camera', 'atendimento', [23.6, 2.9, 5.4], { camKind: 'dome' }),
  dev('AP-01', 'Access Point — Atendimento', 'ap', 'atendimento', [12, 3.15, 8]),
  dev('TH-03', 'Sensor temp./umidade — Atendimento', 'th', 'atendimento', [19.5, 2.2, 5.08]),
  dev('SD-06', 'Detector de fumaça — Atendimento', 'smoke', 'atendimento', [16, 3.12, 8.5]),
  // Recepção / Espera
  dev('CAM-014', 'Câmera dome — Recepção', 'camera', 'recepcao', [8.4, 2.9, 11.4], { camKind: 'dome' }),
  dev('CAM-015', 'Câmera dome — Recepção sul', 'camera', 'recepcao', [15.6, 2.9, 17.6], { camKind: 'dome' }),
  dev('CAM-016', 'Câmera dome — Espera', 'camera', 'espera', [23.6, 2.9, 17.6], { camKind: 'dome' }),
  dev('SD-04', 'Detector de fumaça — Recepção', 'smoke', 'recepcao', [12, 3.12, 14.5]),
  dev('TOT-01', 'Totem de senhas', 'totem', 'recepcao', [10, 0.8, 16.6]),
  // Gerência
  dev('CAM-019', 'Câmera dome — Gerência', 'camera', 'gerencia', [31.6, 2.9, 5.4], { camKind: 'dome' }),
  // Entrada
  dev('CAM-013', 'Câmera fixa — Entrada principal', 'camera', 'entrada', [13.5, 2.9, 21.6], { camKind: 'bullet' }),
  dev('MCP-01', 'Acionador manual de incêndio — Entrada', 'mcp', 'entrada', [18.3, 1.3, 21.85]),
];

// Grafo de dependências. kind: 'conhecida' = cadastrada pela engenharia;
// relações inferidas são produzidas em tempo de execução pelo motor de correlação.
function edges(from, type, tos) { return tos.map((to) => ({ from, to, type, kind: 'conhecida' })); }
const CAMS = DEVICES.filter((d) => d.type === 'camera').map((d) => d.id);
const DEPENDENCIES = [
  ...edges('RTR-01', 'network', ['FW-01']),
  ...edges('FW-01', 'network', ['SW-CORE-01']),
  ...edges('SW-CORE-01', 'network', ['SW-01', 'SW-02', 'SW-03', 'SRV-01', 'VMS-01', 'STG-01', 'NVR-01', 'GW-IOT-01', 'ALM-01', 'ACC-01', 'FACP-01', 'ATM-01', 'ATM-02', 'ATM-03', 'ATM-04', 'TOT-01', 'UPS-01', 'UPS-02', 'PDU-01']),
  ...edges('SW-01', 'poe', ['CAM-011', 'CAM-012', 'CAM-013', 'CAM-021', 'CAM-022']),
  ...edges('SW-02', 'poe', ['CAM-017', 'CAM-018', 'CAM-019', 'CAM-020', 'AP-01', 'AP-02']),
  ...edges('SW-03', 'poe', ['CAM-014', 'CAM-015', 'CAM-016']),
  ...edges('VMS-01', 'managed-by', CAMS),
  ...edges('GW-IOT-01', 'data-path', ['TH-01', 'TH-02', 'TH-03', 'LK-01', 'HVAC-01', 'MTR-01']),
  ...edges('ALM-01', 'supervision', ['PIR-01', 'VIB-01', 'DOOR-01', 'VAULT-01']),
  ...edges('ACC-01', 'supervision', ['RDR-01']),
  ...edges('FACP-01', 'supervision', ['SD-01', 'SD-02', 'SD-03', 'SD-04', 'SD-05', 'SD-06', 'MCP-01']),
  // MTR-01 mede o QDG; as arestas "power" a partir dele representam os circuitos do quadro.
  // Centrais de alarme e de incêndio ficam no QDG mas possuem bateria própria (exigência normativa).
  ...edges('MTR-01', 'power', ['UPS-01', 'UPS-02', 'HVAC-01', 'ATM-01', 'ATM-02', 'ATM-03', 'ATM-04', 'TOT-01', 'FACP-01', 'ALM-01']),
  ...edges('UPS-01', 'power', ['RTR-01', 'FW-01', 'SW-CORE-01', 'SRV-01', 'STG-01', 'PDU-01', 'GW-IOT-01']),
  ...edges('UPS-02', 'power', ['SW-01', 'SW-02', 'SW-03', 'NVR-01', 'VMS-01']),
];

export const AGENCIES = [
  {
    id: 'AG-DEMO-001',
    name: 'Agência Demonstrativa 001',
    city: 'Cidade fictícia',
    timezone: 'America/Sao_Paulo',
    demo: true,
    disclaimer: 'Planta demonstrativa fictícia — não representa a arquitetura de nenhuma agência real.',
    floors: [{ id: 'T', name: 'Térreo', elevation: 0 }],
    bounds: { x: 32, z: 22, wallHeight: WALL_H },
    rooms: ROOMS.map((r) => ({ ...r, floorId: 'T' })),
    walls: WALLS,
    furniture: FURNITURE,
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
