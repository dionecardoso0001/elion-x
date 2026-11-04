// Matriz de conectores. Os protocolos são POSSIBILIDADES ARQUITETURAIS a validar com cada
// fabricante/modelo — nenhum destes conectores está conectado a equipamento real.

export const CONNECTORS = [
  {
    id: 'simulador', domain: 'Todos (demonstração)', protocol: 'Simulador interno', status: 'ativo',
    data: 'Telemetria sintética de todos os tipos do catálogo', auth: 'N/A (processo interno)',
    frequency: '2–3 s por dispositivo', limitations: 'Dados fictícios; não representam nenhum equipamento real',
    failure: 'Cenários A–E reproduzem falhas sob demanda', security: 'Sem acesso à rede',
  },
  {
    id: 'ingest-api', domain: 'Gateway de integração', protocol: 'HTTPS POST /api/ingest (JSON)', status: 'condicional',
    data: 'Leituras normalizadas no contrato docs/CONTRATOS.md', auth: 'Bearer token por gateway (SENTINEL_INGEST_TOKEN); mTLS recomendado em produção',
    frequency: 'Definida pelo gateway', limitations: 'Habilitado somente se o token estiver configurado',
    failure: 'Leitura inválida é rejeitada com motivo; sem dados ⇒ estado "sem comunicação"', security: 'Somente leitura no sentido gateway → plataforma',
  },
  {
    id: 'cftv-onvif', domain: 'CFTV', protocol: 'ONVIF (Profile S/T) e/ou API do VMS', status: 'não conectado',
    data: 'Disponibilidade de stream, eventos de adulteração, estado de gravação (conforme suporte do modelo)', auth: 'Conta de serviço somente leitura (WS-Security / API key do VMS)',
    frequency: 'Eventos push + verificação de stream a cada 30–60 s', limitations: 'Suporte a eventos varia por fabricante/firmware; homologação obrigatória',
    failure: 'Diferenciar câmera sem rede, sem vídeo e VMS indisponível', security: 'Rede de CFTV segmentada; nenhum acesso do navegador às câmeras',
  },
  {
    id: 'rede-snmp', domain: 'Rede', protocol: 'SNMPv3 (authPriv) + syslog', status: 'não conectado',
    data: 'Disponibilidade, interfaces, erros/descartes, CPU/memória, temperatura (se exposta)', auth: 'Usuário SNMPv3 com SHA/AES, view somente leitura',
    frequency: 'Polling 60 s; traps/syslog em tempo real', limitations: 'MIBs proprietárias variam; não usar SNMPv1/v2c',
    failure: 'Timeout de polling ⇒ sem comunicação; nunca operacional', security: 'Coletor no segmento de gerência autorizado; sem varredura de rede',
  },
  {
    id: 'servidores', domain: 'Servidores', protocol: 'API de monitoramento existente / agente / Redfish (BMC)', status: 'não conectado',
    data: 'CPU, memória, disco, temperatura, falhas de hardware, serviços', auth: 'Conta de serviço somente leitura',
    frequency: '30–60 s', limitations: 'Reaproveitar ferramenta de monitoramento já homologada pelo banco quando houver',
    failure: 'Agente parado ⇒ sem dados confiáveis', security: 'Credenciais em cofre de segredos',
  },
  {
    id: 'iot-mqtt', domain: 'IoT / sensores', protocol: 'MQTT sobre TLS (gateway supervisionado)', status: 'não conectado',
    data: 'Temperatura, umidade, vazamento, portas técnicas', auth: 'Certificado X.509 por gateway',
    frequency: '30–60 s ou por evento', limitations: 'Exige instrumentação adicional onde não há interface de rede',
    failure: 'Gateway sem comunicação ⇒ sensores em "sem dados confiáveis"', security: 'Broker interno; ACL por tópico',
  },
  {
    id: 'predial', domain: 'Automação predial / HVAC', protocol: 'BACnet/IP, BACnet/SC ou OPC UA', status: 'não conectado',
    data: 'Estado de equipamentos HVAC e controladores', auth: 'BACnet/SC (TLS) ou OPC UA com certificados',
    frequency: 'COV (change of value) ou 60 s', limitations: 'BACnet/IP legado não tem autenticação — isolar via gateway',
    failure: 'Perda do gateway ⇒ sem dados confiáveis', security: 'Somente leitura (sem WriteProperty)',
  },
  {
    id: 'energia', domain: 'Energia', protocol: 'Modbus TCP/RTU via gateway, SNMP do UPS ou API do medidor', status: 'não conectado',
    data: 'Tensão, corrente, kW, kWh, FP, estado do UPS, autonomia', auth: 'Modbus não possui autenticação — acesso somente via gateway isolado',
    frequency: '5–60 s', limitations: 'Granularidade limitada aos pontos efetivamente medidos (quadro, circuito ou PDU)',
    failure: 'Sem leitura ⇒ sem dados; não estimar consumo', security: 'Somente leitura; nenhum comando de desligamento',
  },
  {
    id: 'alarmes', domain: 'Alarmes, acesso e incêndio', protocol: 'API/gateway homologado pelo fabricante da central', status: 'não conectado',
    data: 'Eventos e estados reportados pela central (alarme, falha, supervisão)', auth: 'Definido pelo fabricante; somente leitura',
    frequency: 'Por evento', limitations: 'Plataforma é camada complementar: não substitui sistemas certificados',
    failure: 'Perda de comunicação com a central ⇒ alerta de supervisão', security: 'Sem comandos de armar/desarmar, abrir cofres ou liberar portas',
  },
];
