// Catálogo de tipos de equipamento: categoria, métricas, limiares e intervalo de coleta.
// Os limiares são valores de referência DEMONSTRATIVOS — em produção vêm da política
// de cada agência/fabricante e ficam versionados junto com as regras.

export const CATEGORIES = {
  cftv:     { label: 'CFTV e Videomonitoramento' },
  rede:     { label: 'Redes e Conectividade' },
  servidor: { label: 'Servidores e Armazenamento' },
  seguranca:{ label: 'Alarmes e Controle de Acesso' },
  incendio: { label: 'Sistemas de Incêndio' },
  energia:  { label: 'Energia Elétrica' },
  ambiente: { label: 'Ambiente e Predial' },
  autoatend:{ label: 'Autoatendimento' },
};

// op: 'gt' => falha quando valor > limiar; 'lt' => falha quando valor < limiar;
// 'eq' => falha quando valor === limiar (booleanos/estados)
export const TYPES = {
  camera: {
    category: 'cftv', label: 'Câmera IP', intervalMs: 2000,
    metrics: [
      { key: 'videoOk', label: 'Vídeo válido', crit: { op: 'eq', v: false }, msg: 'Sem vídeo válido (equipamento responde à rede)' },
      { key: 'tamper', label: 'Adulteração/obstrução', crit: { op: 'eq', v: true }, msg: 'Evento de adulteração ou obstrução' },
      { key: 'fps', label: 'FPS', unit: 'fps', warn: { op: 'lt', v: 10 } },
      { key: 'bitrateKbps', label: 'Bitrate', unit: 'kbps' },
      { key: 'packetLossPct', label: 'Perda de pacotes', unit: '%', warn: { op: 'gt', v: 2 }, crit: { op: 'gt', v: 8 } },
      { key: 'latencyMs', label: 'Latência', unit: 'ms', warn: { op: 'gt', v: 80 } },
      { key: 'recording', label: 'Gravando', warn: { op: 'eq', v: false }, msg: 'Gravação interrompida' },
    ],
  },
  nvr: {
    category: 'cftv', label: 'NVR', intervalMs: 3000,
    metrics: [
      { key: 'storageUsedPct', label: 'Armazenamento', unit: '%', warn: { op: 'gt', v: 85 }, crit: { op: 'gt', v: 95 } },
      { key: 'channelsRecording', label: 'Canais gravando' },
      { key: 'cpuPct', label: 'CPU', unit: '%', warn: { op: 'gt', v: 85 } },
    ],
  },
  vms: {
    category: 'cftv', label: 'Servidor VMS', intervalMs: 3000,
    metrics: [
      { key: 'cpuPct', label: 'CPU', unit: '%', warn: { op: 'gt', v: 85 }, crit: { op: 'gt', v: 97 } },
      { key: 'memPct', label: 'Memória', unit: '%', warn: { op: 'gt', v: 85 } },
      { key: 'servicesOk', label: 'Serviços críticos', crit: { op: 'eq', v: false }, msg: 'Serviço de VMS parado' },
    ],
  },
  router: {
    category: 'rede', label: 'Roteador / Link WAN', intervalMs: 2000,
    metrics: [
      { key: 'wanUp', label: 'Link WAN', crit: { op: 'eq', v: false }, msg: 'Link WAN indisponível' },
      { key: 'latencyMs', label: 'Latência WAN', unit: 'ms', warn: { op: 'gt', v: 120 }, crit: { op: 'gt', v: 400 } },
      { key: 'packetLossPct', label: 'Perda de pacotes', unit: '%', warn: { op: 'gt', v: 1 }, crit: { op: 'gt', v: 5 } },
      { key: 'bandwidthMbps', label: 'Banda em uso', unit: 'Mbps', stat: true },
      { key: 'cpuPct', label: 'CPU', unit: '%', warn: { op: 'gt', v: 85 } },
    ],
  },
  firewall: {
    category: 'rede', label: 'Firewall', intervalMs: 2000,
    metrics: [
      { key: 'cpuPct', label: 'CPU', unit: '%', warn: { op: 'gt', v: 80 }, crit: { op: 'gt', v: 95 } },
      { key: 'memPct', label: 'Memória', unit: '%', warn: { op: 'gt', v: 85 } },
      { key: 'sessions', label: 'Sessões ativas' },
    ],
  },
  switch: {
    category: 'rede', label: 'Switch', intervalMs: 2000,
    metrics: [
      { key: 'cpuPct', label: 'CPU', unit: '%', warn: { op: 'gt', v: 85 } },
      { key: 'tempC', label: 'Temperatura', unit: '°C', warn: { op: 'gt', v: 60 }, crit: { op: 'gt', v: 75 } },
      { key: 'portsUp', label: 'Portas ativas' },
      { key: 'portsDownUnexpected', label: 'Portas inativas inesperadas', warn: { op: 'gt', v: 0 }, msg: 'Porta inativa inesperada' },
      { key: 'ifErrorsPerMin', label: 'Erros de interface/min', warn: { op: 'gt', v: 20 } },
      { key: 'poeBudgetPct', label: 'Uso do orçamento PoE', unit: '%', warn: { op: 'gt', v: 90 } },
    ],
  },
  ap: {
    category: 'rede', label: 'Access Point', intervalMs: 3000,
    metrics: [
      { key: 'clients', label: 'Clientes' },
      { key: 'channelUtilPct', label: 'Utilização do canal', unit: '%', warn: { op: 'gt', v: 80 } },
    ],
  },
  gateway: {
    category: 'rede', label: 'Gateway IoT', intervalMs: 2000,
    metrics: [
      { key: 'cpuPct', label: 'CPU', unit: '%', warn: { op: 'gt', v: 85 } },
      { key: 'queueDepth', label: 'Fila de mensagens', warn: { op: 'gt', v: 500 } },
      { key: 'sensorsReporting', label: 'Sensores reportando' },
    ],
  },
  server: {
    category: 'servidor', label: 'Servidor', intervalMs: 3000,
    metrics: [
      { key: 'cpuPct', label: 'CPU', unit: '%', warn: { op: 'gt', v: 85 }, crit: { op: 'gt', v: 97 } },
      { key: 'memPct', label: 'Memória', unit: '%', warn: { op: 'gt', v: 88 } },
      { key: 'diskPct', label: 'Disco', unit: '%', warn: { op: 'gt', v: 85 }, crit: { op: 'gt', v: 95 } },
      { key: 'tempC', label: 'Temperatura', unit: '°C', warn: { op: 'gt', v: 70 }, crit: { op: 'gt', v: 85 } },
      { key: 'servicesOk', label: 'Serviços críticos', crit: { op: 'eq', v: false }, msg: 'Serviço crítico parado' },
      { key: 'hwFault', label: 'Falha de hardware', crit: { op: 'eq', v: true }, msg: 'Falha de hardware reportada' },
    ],
  },
  storage: {
    category: 'servidor', label: 'Storage', intervalMs: 3000,
    metrics: [
      { key: 'usedPct', label: 'Capacidade usada', unit: '%', warn: { op: 'gt', v: 85 }, crit: { op: 'gt', v: 95 } },
      { key: 'diskHealthOk', label: 'Saúde dos discos', crit: { op: 'eq', v: false }, msg: 'Disco degradado' },
      { key: 'tempC', label: 'Temperatura', unit: '°C', warn: { op: 'gt', v: 55 } },
    ],
  },
  ups: {
    category: 'energia', label: 'Nobreak (UPS)', intervalMs: 2000,
    metrics: [
      { key: 'onBattery', label: 'Operando em bateria', warn: { op: 'eq', v: true }, msg: 'UPS operando em bateria (sem rede elétrica)' },
      { key: 'batteryPct', label: 'Carga da bateria', unit: '%', warn: { op: 'lt', v: 60 }, crit: { op: 'lt', v: 30 } },
      { key: 'runtimeMin', label: 'Autonomia estimada', unit: 'min', warn: { op: 'lt', v: 20 }, crit: { op: 'lt', v: 8 } },
      { key: 'loadPct', label: 'Carga', unit: '%', warn: { op: 'gt', v: 80 }, crit: { op: 'gt', v: 95 } },
      { key: 'batteryHealthPct', label: 'Saúde da bateria', unit: '%', warn: { op: 'lt', v: 80 }, trend: true },
      { key: 'inputV', label: 'Tensão de entrada', unit: 'V' },
    ],
  },
  meter: {
    category: 'energia', label: 'Medidor inteligente (QDG)', intervalMs: 2000,
    metrics: [
      { key: 'voltageV', label: 'Tensão', unit: 'V', crit: { op: 'lt', v: 100 }, warn: { op: 'lt', v: 198 }, msg: 'Tensão de entrada fora da faixa' },
      { key: 'currentA', label: 'Corrente', unit: 'A' },
      { key: 'kW', label: 'Potência ativa', unit: 'kW', stat: true },
      { key: 'kWhToday', label: 'Consumo do dia', unit: 'kWh' },
      { key: 'pf', label: 'Fator de potência', warn: { op: 'lt', v: 0.92 } },
    ],
  },
  pdu: {
    category: 'energia', label: 'PDU monitorável', intervalMs: 3000,
    metrics: [
      { key: 'kW', label: 'Potência', unit: 'kW' },
      { key: 'loadPct', label: 'Carga', unit: '%', warn: { op: 'gt', v: 80 }, crit: { op: 'gt', v: 95 } },
    ],
  },
  smoke: {
    category: 'incendio', label: 'Detector de fumaça', intervalMs: 3000,
    metrics: [
      { key: 'state', label: 'Estado', crit: { op: 'eq', v: 'alarme' }, warn: { op: 'in', v: ['falha', 'supervisao'] }, msg: 'Sinal de alarme de incêndio recebido da central' },
    ],
  },
  mcp: {
    category: 'incendio', label: 'Acionador manual', intervalMs: 3000,
    metrics: [
      { key: 'state', label: 'Estado', crit: { op: 'eq', v: 'alarme' }, warn: { op: 'in', v: ['falha', 'supervisao'] } },
    ],
  },
  facp: {
    category: 'incendio', label: 'Central de detecção de incêndio', intervalMs: 2000,
    metrics: [
      { key: 'state', label: 'Estado', crit: { op: 'eq', v: 'alarme' }, warn: { op: 'in', v: ['falha', 'supervisao'] }, msg: 'Central reporta alarme de incêndio' },
      { key: 'zonesInAlarm', label: 'Zonas em alarme' },
      { key: 'acPowerOk', label: 'Alimentação AC', warn: { op: 'eq', v: false }, msg: 'Central sem alimentação AC (em bateria própria)' },
    ],
  },
  alarmpanel: {
    category: 'seguranca', label: 'Central de alarme', intervalMs: 2000,
    metrics: [
      { key: 'armed', label: 'Situação reportada' },
      { key: 'tamper', label: 'Tamper', crit: { op: 'eq', v: true }, msg: 'Tamper na central de alarme' },
      { key: 'acPowerOk', label: 'Alimentação AC', warn: { op: 'eq', v: false } },
      { key: 'monitoringLinkOk', label: 'Comunicação com central de monitoramento', crit: { op: 'eq', v: false }, msg: 'Sem comunicação com a central de monitoramento' },
    ],
  },
  sensor: {
    category: 'seguranca', label: 'Sensor de segurança', intervalMs: 3000,
    metrics: [
      { key: 'state', label: 'Estado reportado', crit: { op: 'eq', v: 'violado' }, warn: { op: 'eq', v: 'falha' } },
    ],
  },
  access: {
    category: 'seguranca', label: 'Controladora de acesso', intervalMs: 3000,
    metrics: [
      { key: 'doorForced', label: 'Porta forçada', crit: { op: 'eq', v: true }, msg: 'Evento de porta forçada' },
      { key: 'readersOk', label: 'Leitoras OK', warn: { op: 'eq', v: false } },
    ],
  },
  reader: {
    category: 'seguranca', label: 'Leitora de credenciais', intervalMs: 3000,
    metrics: [{ key: 'online', label: 'Leitora operante', crit: { op: 'eq', v: false } }],
  },
  vault: {
    category: 'seguranca', label: 'Cofre instrumentado (status lógico)', intervalMs: 3000,
    metrics: [
      { key: 'sensorState', label: 'Estado reportado pelo sensor' },
      { key: 'alarm', label: 'Alarme associado', crit: { op: 'eq', v: true }, msg: 'Alarme associado ao cofre' },
      { key: 'powerOk', label: 'Alimentação do controlador', warn: { op: 'eq', v: false } },
    ],
  },
  th: {
    category: 'ambiente', label: 'Sensor de temperatura/umidade', intervalMs: 3000,
    metrics: [
      { key: 'tempC', label: 'Temperatura', unit: '°C', warn: { op: 'gt', v: 27 }, crit: { op: 'gt', v: 32 }, stat: true },
      { key: 'humidityPct', label: 'Umidade', unit: '%', warn: { op: 'gt', v: 70 } },
    ],
  },
  leak: {
    category: 'ambiente', label: 'Sensor de vazamento', intervalMs: 3000,
    metrics: [{ key: 'wet', label: 'Água detectada', crit: { op: 'eq', v: true }, msg: 'Vazamento de água detectado' }],
  },
  hvac: {
    category: 'ambiente', label: 'HVAC (climatização)', intervalMs: 3000,
    metrics: [
      { key: 'running', label: 'Em operação', crit: { op: 'eq', v: false }, msg: 'Climatização parada' },
      { key: 'supplyTempC', label: 'Temp. de insuflamento', unit: '°C', warn: { op: 'gt', v: 18 } },
    ],
  },
  atm: {
    category: 'autoatend', label: 'Terminal de autoatendimento', intervalMs: 3000,
    metrics: [
      { key: 'inService', label: 'Em serviço', crit: { op: 'eq', v: false }, msg: 'Terminal fora de serviço' },
      { key: 'deviceFaults', label: 'Falhas de periféricos', warn: { op: 'gt', v: 0 } },
    ],
  },
  totem: {
    category: 'autoatend', label: 'Totem de senhas', intervalMs: 3000,
    metrics: [{ key: 'inService', label: 'Em serviço', crit: { op: 'eq', v: false } }],
  },
};

export const STATUSES = {
  ok:          { label: 'Operacional',         color: '#22c55e', rank: 0 },
  maintenance: { label: 'Manutenção',          color: '#3b82f6', rank: 1 },
  degraded:    { label: 'Instável',            color: '#eab308', rank: 2 },
  unknown:     { label: 'Sem dados confiáveis', color: '#a855f7', rank: 3 },
  offline:     { label: 'Desconectado',        color: '#9ca3af', rank: 4 },
  critical:    { label: 'Falha crítica',       color: '#ef4444', rank: 5 },
};

// Arestas pelas quais a TELEMETRIA trafega. Se um ancestral nesse caminho cair,
// o dispositivo fica "sem dados confiáveis" — e não "com defeito".
export const DATA_PATH_EDGES = new Set(['network', 'poe', 'data-path', 'supervision', 'managed-by']);

export const EDGE_LABELS = {
  network: 'Conectividade de rede',
  poe: 'Alimentação e dados PoE',
  'data-path': 'Caminho de telemetria (gateway)',
  supervision: 'Supervisão pela central',
  'managed-by': 'Gerenciado por',
  power: 'Alimentação elétrica',
  cooling: 'Arrefecimento (climatização)',
};
