/* ═══════════════════════════════════════════════════════════════════
   ELION-X · CYBER DEFENSE GRID
   Console tático de detecção e rastreio de ameaças.

   DOIS MODOS, sempre rotulados na interface:
     · SIMULAÇÃO  — cenário tático gerado localmente (padrão). Nada do que
                    aparece corresponde a um evento real. Eventos levam a tag SIM.
     · REAL       — telemetria defensiva da PRÓPRIA máquina, via /api/cyber
                    (conexões externas geolocalizadas, portas expostas,
                    tentativas de ataque contra o servidor, indícios de malware).
                    Eventos reais levam a tag REAL.

   Nada aqui ataca, varre ou toca em sistemas de terceiros — é leitura local
   e teatro tático. O rastreio de origem em modo SIM é fictício por construção.
═══════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

/* ══════════════════ UTIL ══════════════════ */
const $  = id => document.getElementById(id);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const rnd  = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const hex = n => Math.floor(Math.random() * n).toString(16).toUpperCase();
const nowHMS = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmtN = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'G' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const ipRand = () => `${rndi(11, 223)}.${rndi(0, 255)}.${rndi(0, 255)}.${rndi(1, 254)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ══════════════════ GEOGRAFIA — contornos simplificados (lon,lat) ══════════════════
   Polígonos grosseiros só para a silhueta dos continentes. Precisão cartográfica
   não é o objetivo; posicionamento por lat/lon dos eventos é exato. */
const LAND = [
  /* América do Norte + Central */[-168,66,-158,71,-130,70,-125,69,-115,69,-100,68,-95,72,-85,70,-80,73,-70,66,-64,60,-56,52,-66,45,-70,42,-75,36,-81,31,-80,25,-84,30,-90,29,-97,26,-97,22,-95,18,-92,15,-88,16,-84,10,-79,9,-83,8,-87,13,-92,14,-95,16,-105,20,-110,24,-114,28,-117,32,-122,37,-124,42,-125,48,-131,54,-140,60,-150,59,-160,55,-165,60],
  /* América do Sul */[-81,-4,-79,2,-77,8,-72,12,-62,11,-60,8,-51,4,-50,0,-44,-3,-38,-5,-35,-8,-39,-16,-48,-25,-53,-34,-58,-38,-62,-40,-65,-45,-68,-50,-71,-54,-75,-52,-73,-45,-73,-37,-71,-30,-70,-23,-70,-18,-75,-14,-79,-8],
  /* África */[-17,15,-16,21,-13,28,-9,32,-6,36,0,36,10,37,20,32,25,32,32,31,35,28,38,22,43,12,51,12,48,5,41,-2,40,-10,35,-20,32,-26,28,-33,20,-35,18,-33,14,-23,12,-17,9,-1,5,4,-4,5,-8,4,-13,8],
  /* Eurásia */[-9,43,-9,38,-6,36,0,38,3,42,8,44,12,45,14,41,16,38,18,40,20,40,24,38,28,41,30,41,36,36,35,31,38,22,43,13,48,14,52,17,57,23,56,26,60,25,62,25,67,24,72,20,73,16,77,8,80,13,84,19,87,21,90,22,92,21,95,16,98,10,100,7,104,1,105,8,107,11,109,16,108,21,114,22,117,23,120,30,122,37,126,40,129,43,131,46,135,48,141,53,143,54,140,58,150,59,155,58,160,61,163,60,170,63,172,66,180,66,180,70,170,70,160,71,150,73,140,73,130,72,120,74,110,76,100,77,90,76,80,74,70,73,60,71,52,70,45,68,40,66,35,67,33,70,28,71,24,71,20,70,16,68,14,66,12,64,10,60,8,58,10,57,12,56,10,54,7,53,4,52,2,51,0,49,-2,48,-4,48,-2,44],
  /* Austrália */[113,-22,114,-27,116,-32,119,-34,125,-33,131,-32,135,-35,138,-35,141,-38,145,-38,147,-38,150,-37,153,-32,153,-27,151,-24,149,-21,146,-19,142,-11,137,-12,132,-11,130,-13,126,-14,122,-17,117,-20],
  /* Groenlândia */[-45,60,-52,64,-55,68,-58,72,-55,76,-45,80,-30,82,-20,78,-22,72,-28,68,-38,64],
  /* Reino Unido */[-5,50,-3,54,-5,58,-2,58,0,53,1,51],
  /* Irlanda */[-10,52,-10,55,-6,55,-6,52],
  /* Japão */[130,32,135,34,138,35,141,39,142,43,145,44,141,42,140,38,136,36,132,34],
  /* Madagascar */[43,-16,44,-12,49,-13,50,-16,47,-25,45,-22],
  /* Nova Zelândia */[166,-46,168,-44,171,-42,174,-41,175,-37,173,-35,172,-40,170,-45],
  /* Sumatra */[95,5,98,2,102,-2,106,-6,104,-6,100,0],
  /* Bornéu */[109,2,114,4,118,1,117,-3,110,-3],
  /* Java */[105,-6,114,-7,114,-8,106,-7],
  /* Filipinas */[120,18,124,18,126,13,123,10,120,13],
  /* Islândia */[-24,65,-22,66,-14,66,-14,64,-21,63],
  /* Cuba */[-84,22,-78,22,-74,20,-80,20],
  /* Sri Lanka */[80,10,82,8,81,6,80,8],
  /* Nova Guiné */[131,-1,140,-3,147,-6,150,-10,143,-9,136,-8,131,-4],
];
const LAT_TOP = 83, LAT_BOT = -57;
const projX = (lon, W) => (lon + 180) / 360 * W;
const projY = (lat, H) => (LAT_TOP - clamp(lat, LAT_BOT, LAT_TOP)) / (LAT_TOP - LAT_BOT) * H;

function inPoly(lon, lat, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const onLand = (lon, lat) => LAND.some(p => inPoly(lon, lat, p));

/* ══════════════════ CATÁLOGOS ══════════════════ */
const ORIGINS = [
  ['Moscou','RU',55.75,37.61],['São Paulo','BR',-23.55,-46.63],['Pequim','CN',39.90,116.40],
  ['Lagos','NG',6.52,3.37],['Amsterdã','NL',52.37,4.90],['Kiev','UA',50.45,30.52],
  ['Teerã','IR',35.69,51.39],['Seul','KR',37.57,126.98],['Mumbai','IN',19.08,72.88],
  ['Jacarta','ID',-6.21,106.85],['Istambul','TR',41.01,28.98],['Bucareste','RO',44.43,26.10],
  ['Hanói','VN',21.03,105.85],['Cairo','EG',30.04,31.24],['Cidade do Panamá','PA',8.98,-79.52],
  ['Sydney','AU',-33.87,151.21],['Toronto','CA',43.65,-79.38],['Chicago','US',41.88,-87.63],
  ['Frankfurt','DE',50.11,8.68],['Paris','FR',48.86,2.35],['Londres','GB',51.51,-0.13],
  ['Singapura','SG',1.35,103.82],['Hong Kong','HK',22.32,114.17],['Dubai','AE',25.20,55.27],
  ['Joanesburgo','ZA',-26.20,28.05],['Buenos Aires','AR',-34.60,-58.38],['Bogotá','CO',4.71,-74.07],
  ['Cidade do México','MX',19.43,-99.13],['Varsóvia','PL',52.23,21.01],['Sófia','BG',42.70,23.32],
  ['Riga','LV',56.95,24.11],['Tel Aviv','IL',32.09,34.78],['Karachi','PK',24.86,67.01],
  ['Daca','BD',23.81,90.41],['Manila','PH',14.60,120.98],['Bangkok','TH',13.76,100.50],
  ['Kuala Lumpur','MY',3.14,101.69],['Santiago','CL',-33.45,-70.67],['Lima','PE',-12.05,-77.04],
  ['Casablanca','MA',33.57,-7.59],['Nairóbi','KE',-1.29,36.82],['Tashkent','UZ',41.30,69.24],
  ['Almaty','KZ',43.24,76.89],['Novosibirsk','RU',55.01,82.94],['Vladivostok','RU',43.12,131.89],
  ['Osaka','JP',34.69,135.50],['Taipé','TW',25.03,121.57],['Auckland','NZ',-36.85,174.76],
  ['Los Angeles','US',34.05,-118.24],['Ashburn','US',39.04,-77.49],['Reykjavík','IS',64.15,-21.94],
];
/* Operadores fictícios — nenhuma organização real é acusada de nada aqui. */
const ASNS = [
  'AS-ORION TELECOM','BLACKNET HOSTING','AS-VULPES CLOUD','GHOSTRACK IX','NULLROUTE LTD',
  'AS-KRYPTON NET','SHADOWLINK BV','AS-PHANTOM DC','IRONVEIL HOSTING','AS-CIPHERWAVE',
  'DARKPEAK TRANSIT','AS-NOCTURNE ISP','REDSHIFT NETWORKS','AS-BASILISK TELECOM','VOIDPORT CLOUD',
];
const ACTORS = ['SCARLET MANTIS','COBALT WRAITH','SILENT HYDRA','IRON JACKAL','PALE VULTURE','CRIMSON ORACLE','FROSTBYTE','NULL SERPENT','BLACK LANTERN','GRAY WIDOW'];

const KINDS = {
  DDOS:  { lab:'DDoS',            color:'#ff2a4a', ico:'⚡', sensor:'ddos' },
  DB:    { lab:'INVASÃO DE BD',   color:'#ff8a00', ico:'▤', sensor:'db' },
  RANSOM:{ lab:'RANSOMWARE',      color:'#c04bff', ico:'⧉', sensor:'ransom' },
  VULN:  { lab:'VULNERABILIDADE', color:'#ffd23f', ico:'◱', sensor:'vuln' },
  RECON: { lab:'RECONHECIMENTO',  color:'#00e5ff', ico:'◎', sensor:'recon' },
};

const PLAYBOOK = {
  DDOS: [
    { n:'FLOOD SYN VOLUMÉTRICO',      sev:'ALTA',    d:() => `${rnd(12,340).toFixed(1)} Gbps · ${rnd(2,48).toFixed(1)} Mpps · SYN sem ACK` },
    { n:'AMPLIFICAÇÃO DNS',           sev:'ALTA',    d:() => `fator ${rndi(28,54)}x · ${rndi(400,9000)} resolvers abertos` },
    { n:'AMPLIFICAÇÃO NTP/memcached', sev:'CRÍTICA', d:() => `fator ${rndi(500,51000)}x · UDP/${pick([123,11211])}` },
    { n:'HTTP FLOOD L7',              sev:'MÉDIA',   d:() => `${fmtN(rndi(9000,240000))} req/s em /api/* · UA rotativo` },
    { n:'SLOWLORIS',                  sev:'MÉDIA',   d:() => `${rndi(2000,18000)} sessões meio-abertas · pool exaurido` },
    { n:'ENXAME BOTNET IoT',          sev:'CRÍTICA', d:() => `${fmtN(rndi(12000,480000))} nós · variante tipo-Mirai` },
    { n:'FLOOD UDP MULTIVETOR',       sev:'ALTA',    d:() => `${rndi(3,7)} vetores simultâneos · portas aleatórias` },
  ],
  DB: [
    { n:'SQL INJECTION — UNION',      sev:'CRÍTICA', d:() => `' UNION SELECT usuario,senha_hash FROM usuarios--` },
    { n:'SQLi CEGA POR TEMPO',        sev:'ALTA',    d:() => `1' AND SLEEP(${rndi(3,9)})-- · ${rndi(40,900)} sondas` },
    { n:'EXFILTRAÇÃO DE REGISTROS',   sev:'CRÍTICA', d:() => `SELECT * FROM clientes · ${fmtN(rndi(4000,2400000))} linhas em trânsito` },
    { n:'ESCALADA DE PRIVILÉGIO',     sev:'CRÍTICA', d:() => `xp_cmdshell habilitado · contexto sysadmin` },
    { n:'FORÇA BRUTA DE CREDENCIAL',  sev:'MÉDIA',   d:() => `${fmtN(rndi(800,64000))} tentativas · usuário '${pick(['sa','root','postgres','admin','dbadmin'])}'` },
    { n:'NoSQL INJECTION',            sev:'ALTA',    d:() => `{"$ne":null} em filtro de autenticação` },
    { n:'DUMP DE SCHEMA',             sev:'MÉDIA',   d:() => `information_schema.tables · ${rndi(12,240)} tabelas mapeadas` },
  ],
  RANSOM: [
    { n:'CRIPTOGRAFIA EM MASSA',      sev:'CRÍTICA', d:() => `${fmtN(rndi(300,92000))} arquivos · AES-256 + RSA-2048 · .${pick(['lokd','x7z','cryp','elx0'])}` },
    { n:'EXCLUSÃO DE SHADOW COPIES',  sev:'CRÍTICA', d:() => `vssadmin delete shadows /all /quiet` },
    { n:'BEACON C2 — DUPLA EXTORSÃO', sev:'CRÍTICA', d:() => `batimento a cada ${rndi(30,300)}s · TLS sobre :${pick([443,8443,53])}` },
    { n:'NOTA DE RESGATE GRAVADA',    sev:'ALTA',    d:() => `COMO_RECUPERAR_SEUS_ARQUIVOS.txt · ${rndi(2,180)} BTC` },
    { n:'DESATIVAÇÃO DE DEFESAS',     sev:'CRÍTICA', d:() => `serviços de EDR/antivírus interrompidos · ${rndi(2,9)} alvos` },
    { n:'MOVIMENTO LATERAL SMB',      sev:'ALTA',    d:() => `SMB :445 · ${rndi(2,40)} hosts alcançados` },
    { n:'EXFILTRAÇÃO PRÉ-CIFRAGEM',   sev:'CRÍTICA', d:() => `${rnd(0.4,340).toFixed(1)} GB para host externo` },
  ],
  VULN: [
    { n:'PORTA EXPOSTA — RDP',        sev:'ALTA',    d:() => `TCP/3389 acessível pela borda · sem NLA` },
    { n:'SERVIÇO SEM PATCH',          sev:'CRÍTICA', d:() => `RCE não autenticado · exploração pública disponível` },
    { n:'TLS OBSOLETO',               sev:'MÉDIA',   d:() => `TLS 1.0 aceito · cifras ${pick(['RC4','3DES','CBC legado'])}` },
    { n:'CREDENCIAL PADRÃO',          sev:'ALTA',    d:() => `${pick(['admin:admin','root:toor','admin:1234'])} aceito no painel` },
    { n:'ARMAZENAMENTO PÚBLICO',      sev:'ALTA',    d:() => `bucket listável · ${rndi(3,4200)} objetos expostos` },
    { n:'SEGREDO EM REPOSITÓRIO',     sev:'CRÍTICA', d:() => `chave de API válida em histórico de commits` },
    { n:'DESERIALIZAÇÃO INSEGURA',    sev:'ALTA',    d:() => `objeto não confiável em endpoint público` },
  ],
  RECON: [
    { n:'VARREDURA DE PORTAS SYN',    sev:'BAIXA',   d:() => `${fmtN(rndi(200,65535))} portas em ${rndi(2,40)}s · half-open` },
    { n:'FINGERPRINT DE SERVIÇO',     sev:'BAIXA',   d:() => `banner grabbing em ${rndi(3,28)} serviços` },
    { n:'ENUMERAÇÃO DE DIRETÓRIOS',   sev:'BAIXA',   d:() => `${fmtN(rndi(2000,90000))} caminhos testados · wordlist comum` },
    { n:'FORÇA BRUTA SSH',            sev:'MÉDIA',   d:() => `${fmtN(rndi(300,42000))} tentativas · TCP/22` },
    { n:'SONDAGEM DE ARQUIVOS',       sev:'MÉDIA',   d:() => `${pick(['/.env','/.git/config','/wp-login.php','/actuator/env','/.aws/credentials'])}` },
    { n:'ENUMERAÇÃO DE SUBDOMÍNIOS',  sev:'BAIXA',   d:() => `${rndi(40,3000)} nomes resolvidos passivamente` },
  ],
};

const SEV = {
  BAIXA:   { w:1,  c:'#00e5ff' },
  MÉDIA:   { w:3,  c:'#ffd23f' },
  ALTA:    { w:7,  c:'#ff8a00' },
  CRÍTICA: { w:14, c:'#ff2a4a' },
};

/* ══════════════════ CYBER KILL CHAIN + MITRE ATT&CK ══════════════════
   Toda ameaça percorre um subconjunto da cadeia de morte (Lockheed Martin).
   O ELION reconstrói em que estágio o atacante está e prevê o próximo. */
const KC = [
  { k:'RECON',   lab:'RECON',    full:'Reconhecimento' },
  { k:'ARMA',    lab:'ARMA',     full:'Armamento' },
  { k:'ENTREGA', lab:'ENTREGA',  full:'Entrega' },
  { k:'EXPLOR',  lab:'EXPLORAR', full:'Exploração' },
  { k:'INSTALL', lab:'INSTALAR', full:'Instalação' },
  { k:'C2',      lab:'C2',       full:'Comando & Controle' },
  { k:'ACAO',    lab:'AÇÃO',     full:'Ações no Objetivo' },
];
const KC_IDX = Object.fromEntries(KC.map((s, i) => [s.k, i]));
const KC_PATH = {
  RECON:  ['RECON'],
  DDOS:   ['RECON','ARMA','ENTREGA','ACAO'],
  DB:     ['RECON','ENTREGA','EXPLOR','C2','ACAO'],
  RANSOM: ['RECON','ARMA','ENTREGA','EXPLOR','INSTALL','C2','ACAO'],
  VULN:   ['RECON','ARMA','ENTREGA','EXPLOR'],
};
const MITRE = {
  RECON:  [['T1595','Active Scanning'],['T1590','Gather Victim Network Info'],['T1046','Network Service Discovery'],['T1110','Brute Force']],
  DDOS:   [['T1498','Network Denial of Service'],['T1499','Endpoint Denial of Service'],['T1498.002','Reflection Amplification']],
  DB:     [['T1190','Exploit Public-Facing Application'],['T1213','Data from Information Repositories'],['T1005','Data from Local System']],
  RANSOM: [['T1486','Data Encrypted for Impact'],['T1490','Inhibit System Recovery'],['T1021.002','SMB/Windows Admin Shares'],['T1567','Exfiltration to Cloud']],
  VULN:   [['T1190','Exploit Public-Facing Application'],['T1210','Exploitation of Remote Services'],['T1078','Valid Accounts']],
};
/* base de raciocínio local (blue-team) — usada quando o núcleo cognitivo online
   está indisponível, e como leitura instantânea antes da resposta do Claude */
const ATTACK_KB = {
  DDOS: {
    mecanismo: 'O atacante satura o alvo com tráfego forjado — SYN sem handshake, respostas de amplificação (DNS/NTP/memcached de fator alto) ou floods L7 contra endpoints caros — até esgotar banda, tabela de conexões ou CPU. Frequentemente é cortina de fumaça para uma intrusão simultânea.',
    proximo: ['escalar para multivetor, somando volumétrico L3/4 a flood L7','concentrar no endpoint mais caro (login, busca, checkout)','usar o flood como distração enquanto tenta exfiltrar por outro vetor'],
    atribuicao: ['botnet de IoT alugada (stresser/booter) — baixa sofisticação, alto volume','origens residenciais coordenadas: perfil hacktivista','extorsão: DDoS seguido de pedido de resgate (RDoS)'],
    contramedida: ['ativar SCRUBBING e desviar o prefixo por anycast/BGP','rate-limit adaptativo por origem + desafio no L7','acionar upstream/CDN para absorver o volume na borda'],
  },
  DB: {
    mecanismo: 'O atacante injeta comando na camada de dados — SQLi (UNION/cego por tempo), NoSQL ou abuso de credencial — para ler, alterar ou exfiltrar registros. O sucesso costuma escalar de leitura de schema para dump completo e, então, execução de comando no host do banco.',
    proximo: ['passar de enumeração de schema para dump completo das tabelas de credenciais','tentar escalar via xp_cmdshell / stacked queries para RCE no host do banco','estabelecer C2 para exfiltrar de forma contínua e discreta'],
    atribuicao: ['ator financeiro atrás de dados de cartão/PII para revenda','operador de acesso inicial (IAB) preparando venda do acesso','automação de massa (sqlmap) varrendo alvos vulneráveis'],
    contramedida: ['bloquear a origem no WAF e forçar prepared statements/parametrização','rotacionar credenciais do banco e revogar sessões ativas','isolar o APP-TIER do DB e auditar as últimas queries anômalas'],
  },
  RANSOM: {
    mecanismo: 'Após acesso inicial, o operador move-se lateralmente (SMB/RDP), desativa defesas e sombras (vssadmin), rouba dados para dupla extorsão e dispara criptografia em massa (AES+RSA). A entropia dos arquivos dispara — essa é a assinatura que o FIM detecta.',
    proximo: ['excluir shadow copies e backups para impedir recuperação','exfiltrar dados sensíveis antes de cifrar (dupla extorsão)','propagar por SMB para o máximo de hosts antes de detonar'],
    atribuicao: ['afiliado de RaaS (Ransomware-as-a-Service) — playbook padronizado','intrusão via acesso comprado de um IAB','grupo com dupla extorsão e site de vazamento próprio'],
    contramedida: ['ISOLAR imediatamente os hosts afetados da rede (contenção)','ENCERRAR a árvore de processos maliciosa e cortar o C2','RESTAURAR de snapshot íntegro offline; preservar evidência para perícia'],
  },
  VULN: {
    mecanismo: 'O atacante localiza um serviço exposto e sem patch (RDP/SMB, painel com credencial padrão, RCE público) e o transforma em ponto de entrada. É o elo mais barato: uma única falha na superfície externa vira acesso ao interior.',
    proximo: ['armar um exploit público contra o serviço e obter execução','usar a falha para plantar um implante e estabelecer persistência','pivotar do host exposto para a rede interna'],
    atribuicao: ['varredura oportunista em massa por exploit recém-publicado (n-day)','acesso dirigido a um serviço específico da sua borda','commodity: kit automatizado testando falhas conhecidas'],
    contramedida: ['aplicar o patch ou tirar o serviço da borda AGORA (reduzir superfície)','fechar a porta no firewall e exigir VPN+MFA para o acesso','trocar credenciais padrão e habilitar NLA/2FA no serviço'],
  },
  RECON: {
    mecanismo: 'O atacante mapeia a superfície antes de agir — varredura de portas, fingerprint de serviços, enumeração de diretórios/subdomínios e brute force leve. Sozinho não causa dano, mas é o aviso: alguém está desenhando a planta do seu perímetro.',
    proximo: ['converter o mapa em ataque dirigido ao serviço mais fraco encontrado','tentar credenciais padrão/vazadas nos serviços expostos','voltar com um exploit específico para a versão identificada'],
    atribuicao: ['varredura de fundo da internet (Shodan-like) — ainda não dirigida','pré-ataque dirigido: alguém escolheu você como alvo','coleta automatizada por bot de commodity'],
    contramedida: ['negar o scanner por reputação e reduzir banners/versões expostas','fechar portas desnecessárias e esconder o que não precisa estar público','marcar a origem para vigilância — o recon precede o ataque real'],
  },
};

/* ativos defendidos (destino dos arcos no mapa) */
const ASSETS = [
  { id:'ELX-CORE-01',  lab:'NÚCLEO SP',   lat:-23.55, lon:-46.63 },
  { id:'ELX-DB-PRIME', lab:'BD SANTOS',   lat:-23.96, lon:-46.33 },
  { id:'ELX-EDGE-NY',  lab:'BORDA NY',    lat: 40.71, lon:-74.00 },
  { id:'ELX-EDGE-FRA', lab:'BORDA FRA',   lat: 50.11, lon:  8.68 },
  { id:'ELX-EDGE-SIN', lab:'BORDA SIN',   lat:  1.35, lon:103.82 },
  { id:'ELX-BKP-DUB',  lab:'BACKUP DUB',  lat: 53.35, lon: -6.26 },
];

/* topologia interna */
const NODE_DEF = [
  { id:'WAN',    lab:'BORDA/WAN',   kind:'edge', x:.50, y:.08 },
  { id:'FW',     lab:'FIREWALL',    kind:'fw',   x:.50, y:.26 },
  { id:'IPS',    lab:'IPS/WAF',     kind:'fw',   x:.24, y:.36 },
  { id:'VPN',    lab:'VPN-GW',      kind:'net',  x:.76, y:.36 },
  { id:'SW',     lab:'CORE-SW',     kind:'net',  x:.50, y:.46 },
  { id:'WEB1',   lab:'WEB-01',      kind:'srv',  x:.18, y:.63 },
  { id:'WEB2',   lab:'WEB-02',      kind:'srv',  x:.36, y:.70 },
  { id:'APP',    lab:'APP-TIER',    kind:'srv',  x:.55, y:.63 },
  { id:'DB1',    lab:'DB-PRIME',    kind:'db',   x:.74, y:.62 },
  { id:'DB2',    lab:'DB-REPLICA',  kind:'db',   x:.88, y:.74 },
  { id:'NAS',    lab:'STORAGE',     kind:'sto',  x:.62, y:.86 },
  { id:'BKP',    lab:'BACKUP',      kind:'sto',  x:.40, y:.90 },
  { id:'DNS',    lab:'DNS',         kind:'net',  x:.10, y:.44 },
];
const LINKS = [['WAN','FW'],['FW','IPS'],['FW','VPN'],['FW','SW'],['IPS','SW'],['VPN','SW'],['SW','WEB1'],['SW','WEB2'],['SW','APP'],['SW','DNS'],['APP','DB1'],['DB1','DB2'],['APP','NAS'],['NAS','BKP'],['WEB1','APP'],['WEB2','APP']];

/* ══════════════════ ESTADO ══════════════════ */
const S = {
  t0: Date.now(),
  running: false,
  paused: false,
  real: false,
  audio: false,
  lockdown: false,
  defcon: 5,
  threats: [],          // ameaças vivas na lista
  selected: null,
  arcs: [],
  impacts: [],
  blips: [],
  nodes: [],
  cves: [],
  counts: { ddos:0, db:0, ransom:0, vuln:0, recon:0 },
  blocked: 0,
  activeCount: 0,
  rateWindow: [],       // timestamps p/ ataques/min
  traffic: [],          // {ok,bad,drop}
  entropy: [],
  pps: 0, conns: 0, dropPct: 0, ent: 3.9, writes: 12,
  seq: 1,
  realTimer: null,
  realSeen: new Set(),
  history: [], histIdx: -1,
};

/* ══════════════════ ÁUDIO TÁTICO ══════════════════ */
const Audio_ = {
  ctx: null, master: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.12;
    this.master.connect(this.ctx.destination);
  },
  tone(freq, dur = .08, type = 'square', vol = 1) {
    if (!S.audio) return;
    this.init(); if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + .008);
    g.gain.exponentialRampToValueAtTime(.0001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + dur + .02);
  },
  blip()   { this.tone(rnd(900, 1500), .05, 'square', .5); },
  detect() { this.tone(680, .07, 'triangle', .8); setTimeout(() => this.tone(880, .06, 'triangle', .6), 70); },
  alarm()  { this.tone(220, .18, 'sawtooth', 1); setTimeout(() => this.tone(180, .22, 'sawtooth', 1), 190); },
  ok()     { this.tone(520, .06, 'sine', .7); setTimeout(() => this.tone(780, .09, 'sine', .7), 60); },
  key()    { this.tone(rnd(1400, 2000), .015, 'square', .18); },
};

/* ══════════════════ TERMINAL ══════════════════ */
const Term = {
  box: null, max: 300,
  line(txt, cls = '', stamp = true) {
    if (!this.box) this.box = $('term');
    const n = el('div', 'l ' + cls);
    n.innerHTML = (stamp ? `<span class="ts">[${nowHMS()}]</span> ` : '') + txt;
    const stick = this.box.scrollTop + this.box.clientHeight >= this.box.scrollHeight - 30;
    this.box.appendChild(n);
    while (this.box.childElementCount > this.max) this.box.removeChild(this.box.firstChild);
    if (stick) this.box.scrollTop = this.box.scrollHeight;
  },
  async type(txt, cls = '', speed = 12) {
    if (!this.box) this.box = $('term');
    const n = el('div', 'l ' + cls);
    n.innerHTML = `<span class="ts">[${nowHMS()}]</span> `;
    this.box.appendChild(n);
    const head = n.innerHTML;
    for (let i = 1; i <= txt.length; i++) {
      n.innerHTML = head + txt.slice(0, i);
      this.box.scrollTop = this.box.scrollHeight;
      if (i % 3 === 0) await sleep(speed);
    }
    while (this.box.childElementCount > this.max) this.box.removeChild(this.box.firstChild);
  },
  clear() { if (!this.box) this.box = $('term'); this.box.innerHTML = ''; },
};

/* ══════════════════ TOAST ══════════════════ */
function toast(msg, color = '#00e5ff', ms = 3800) {
  const t = el('div', 'toast', msg);
  t.style.setProperty('--c', color);
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}

/* ══════════════════ CANVAS HELPER ══════════════════ */
function fitCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv._w === w && cv._h === h && cv._dpr === dpr) return false;
  cv._w = w; cv._h = h; cv._dpr = dpr;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

/* ══════════════════ CHUVA DE CÓDIGO ══════════════════ */
const Rain = {
  cv: null, ctx: null, cols: [], size: 15,
  init() {
    this.cv = $('rain'); this.ctx = this.cv.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },
  resize() {
    this.cv.width = window.innerWidth; this.cv.height = window.innerHeight;
    const n = Math.ceil(this.cv.width / this.size);
    this.cols = Array.from({ length: n }, () => Math.random() * -60);
  },
  draw() {
    const c = this.ctx;
    c.fillStyle = 'rgba(1,6,12,0.09)';
    c.fillRect(0, 0, this.cv.width, this.cv.height);
    c.font = `${this.size}px 'Share Tech Mono', monospace`;
    for (let i = 0; i < this.cols.length; i++) {
      const y = this.cols[i] * this.size;
      if (y > 0) {
        const ch = String.fromCharCode(0x30A0 + Math.random() * 96 | 0);
        c.fillStyle = Math.random() < .04 ? '#c9ffe6' : '#00c97b';
        c.fillText(ch, i * this.size, y);
      }
      this.cols[i] = (y > this.cv.height && Math.random() > .975) ? 0 : this.cols[i] + 1;
    }
  },
};

/* ══════════════════ MAPA GLOBAL ══════════════════ */
const WorldMap = {
  cv: null, ctx: null, base: null, W: 0, H: 0,
  init() { this.cv = $('mapCv'); this.ctx = this.cv.getContext('2d'); },
  buildBase() {
    const W = this.W = this.cv._w, H = this.H = this.cv._h;
    const b = this.base = document.createElement('canvas');
    const dpr = this.cv._dpr;
    b.width = Math.round(W * dpr); b.height = Math.round(H * dpr);
    const c = b.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    // grade de paralelos / meridianos
    c.strokeStyle = 'rgba(0,229,255,0.055)'; c.lineWidth = 1;
    for (let lat = -60; lat <= 80; lat += 20) {
      const y = projY(lat, H); c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
    }
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = projX(lon, W); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
    }
    // equador destacado
    c.strokeStyle = 'rgba(0,229,255,0.14)';
    const eq = projY(0, H); c.beginPath(); c.moveTo(0, eq); c.lineTo(W, eq); c.stroke();

    // massas de terra em pontos
    const step = W > 700 ? 4 : 5;
    for (let px = 0; px < W; px += step) {
      const lon = px / W * 360 - 180;
      for (let py = 0; py < H; py += step) {
        const lat = LAT_TOP - py / H * (LAT_TOP - LAT_BOT);
        if (!onLand(lon, lat)) continue;
        const a = .22 + Math.random() * .22;
        c.fillStyle = `rgba(0,229,255,${a})`;
        c.fillRect(px, py, 1.7, 1.7);
      }
    }
    // contorno suave
    c.strokeStyle = 'rgba(0,229,255,0.12)'; c.lineWidth = 1;
    for (const p of LAND) {
      c.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const x = projX(p[i], W), y = projY(p[i + 1], H);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.closePath(); c.stroke();
    }
  },
  xy(lat, lon) { return { x: projX(lon, this.W), y: projY(lat, this.H) }; },

  addArc(fromLat, fromLon, toLat, toLon, color, kind, real) {
    const a = this.xy(fromLat, fromLon), b = this.xy(toLat, toLon);
    // mão curta: se cruzar a antimeridiano, ainda desenha reto (aceitável no estilo HUD)
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const lift = clamp(d * .32, 18, 130);
    const nx = -dy / (d || 1), ny = dx / (d || 1);
    S.arcs.push({
      x0:a.x, y0:a.y, x1:b.x, y1:b.y,
      cx: mx - nx * lift, cy: my - ny * lift,
      t: 0, sp: rnd(.010, .019), color, kind, real, life: 1,
    });
    S.blips.push({ x:a.x, y:a.y, r:0, max:rnd(14,24), color, life:1 });
  },
  bez(a, t) {
    const u = 1 - t;
    return {
      x: u * u * a.x0 + 2 * u * t * a.cx + t * t * a.x1,
      y: u * u * a.y0 + 2 * u * t * a.cy + t * t * a.y1,
    };
  },
  draw(dt) {
    // mantém W/H sempre atuais — projeções dependem deles mesmo antes do rebuild da base
    const c = this.ctx, W = this.W = this.cv._w, H = this.H = this.cv._h;
    c.clearRect(0, 0, W, H);
    if (this.base) c.drawImage(this.base, 0, 0, W, H);

    // ativos defendidos
    const pulse = (Math.sin(Date.now() / 420) + 1) / 2;
    for (const a of ASSETS) {
      const p = this.xy(a.lat, a.lon);
      c.strokeStyle = `rgba(0,255,157,${.25 + pulse * .35})`; c.lineWidth = 1;
      c.beginPath(); c.arc(p.x, p.y, 6 + pulse * 4, 0, 7); c.stroke();
      c.fillStyle = '#00ff9d'; c.beginPath(); c.arc(p.x, p.y, 2.4, 0, 7); c.fill();
      if (W > 620) {
        c.font = "8px 'Share Tech Mono', monospace";
        c.fillStyle = 'rgba(0,255,157,0.55)';
        c.fillText(a.lab, p.x + 9, p.y + 3);
      }
    }

    // arcos
    for (let i = S.arcs.length - 1; i >= 0; i--) {
      const a = S.arcs[i];
      if (!S.paused) a.t += a.sp * dt;
      if (a.t >= 1) {
        a.life -= .04 * dt;
        if (a.life <= 0) {
          S.impacts.push({ x:a.x1, y:a.y1, r:0, color:a.color, life:1 });
          S.arcs.splice(i, 1); continue;
        }
      }
      const head = Math.min(a.t, 1);
      const tail = Math.max(0, head - .34);
      c.lineWidth = a.real ? 1.7 : 1.2;
      c.strokeStyle = a.color;
      c.globalAlpha = .16 * a.life;
      // rastro fraco do caminho completo
      c.beginPath();
      c.moveTo(a.x0, a.y0); c.quadraticCurveTo(a.cx, a.cy, a.x1, a.y1);
      c.stroke();
      // cabeça brilhante
      c.globalAlpha = a.life;
      c.beginPath();
      const N = 16;
      for (let k = 0; k <= N; k++) {
        const p = this.bez(a, tail + (head - tail) * (k / N));
        k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y);
      }
      c.shadowBlur = 10; c.shadowColor = a.color;
      c.stroke(); c.shadowBlur = 0;
      const hp = this.bez(a, head);
      c.fillStyle = '#fff'; c.beginPath(); c.arc(hp.x, hp.y, a.real ? 2.6 : 2, 0, 7); c.fill();
      c.globalAlpha = 1;
    }

    // origem piscando
    for (let i = S.blips.length - 1; i >= 0; i--) {
      const b = S.blips[i];
      if (!S.paused) { b.r += .55 * dt; b.life -= .022 * dt; }
      if (b.life <= 0 || b.r > b.max) { S.blips.splice(i, 1); continue; }
      c.globalAlpha = b.life * .8; c.strokeStyle = b.color; c.lineWidth = 1;
      c.beginPath(); c.arc(b.x, b.y, b.r, 0, 7); c.stroke();
      c.globalAlpha = 1;
    }

    // impactos
    for (let i = S.impacts.length - 1; i >= 0; i--) {
      const m = S.impacts[i];
      if (!S.paused) { m.r += 1.1 * dt; m.life -= .028 * dt; }
      if (m.life <= 0) { S.impacts.splice(i, 1); continue; }
      c.globalAlpha = m.life; c.strokeStyle = m.color; c.lineWidth = 2 * m.life;
      c.beginPath(); c.arc(m.x, m.y, m.r, 0, 7); c.stroke();
      c.globalAlpha = m.life * .5;
      c.beginPath(); c.arc(m.x, m.y, m.r * .55, 0, 7); c.stroke();
      c.globalAlpha = 1;
    }
  },
};

/* ══════════════════ RADAR ══════════════════ */
const Radar = {
  cv: null, ctx: null, ang: 0, contacts: [],
  init() { this.cv = $('radarCv'); this.ctx = this.cv.getContext('2d'); },
  ping(threat) {
    this.contacts.push({
      a: Math.random() * Math.PI * 2,
      d: rnd(.25, .95),
      color: KINDS[threat.kind].color,
      life: 1, lab: threat.kind,
    });
    if (this.contacts.length > 26) this.contacts.shift();
  },
  draw(dt) {
    const c = this.ctx, W = this.cv._w, H = this.cv._h;
    c.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 8;
    if (R <= 0) return;
    if (!S.paused) this.ang += .016 * dt;

    // anéis
    c.strokeStyle = 'rgba(0,229,255,0.14)'; c.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { c.beginPath(); c.arc(cx, cy, R * i / 4, 0, 7); c.stroke(); }
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke();
    }
    c.font = "7px 'Share Tech Mono', monospace"; c.fillStyle = 'rgba(0,229,255,0.35)';
    c.fillText('N', cx - 3, cy - R + 8); c.fillText('S', cx - 3, cy + R - 2);
    c.fillText('L', cx + R - 8, cy + 3); c.fillText('O', cx - R + 3, cy + 3);

    // varredura
    const g = c.createConicGradient ? c.createConicGradient(this.ang, cx, cy) : null;
    if (g) {
      g.addColorStop(0, 'rgba(0,255,157,0.30)');
      g.addColorStop(.10, 'rgba(0,255,157,0.05)');
      g.addColorStop(.35, 'rgba(0,255,157,0)');
      g.addColorStop(1, 'rgba(0,255,157,0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill();
    }
    c.strokeStyle = 'rgba(0,255,157,0.75)'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(this.ang) * R, cy + Math.sin(this.ang) * R); c.stroke();

    // contatos
    for (let i = this.contacts.length - 1; i >= 0; i--) {
      const k = this.contacts[i];
      if (!S.paused) k.life -= .0035 * dt;
      if (k.life <= 0) { this.contacts.splice(i, 1); continue; }
      const x = cx + Math.cos(k.a) * R * k.d, y = cy + Math.sin(k.a) * R * k.d;
      // brilha quando o feixe passa por cima
      let diff = Math.abs(((this.ang % (Math.PI * 2)) - k.a + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      const flash = clamp(1 - diff / .45, 0, 1);
      c.globalAlpha = clamp(k.life * .55 + flash * .8, 0, 1);
      c.fillStyle = k.color;
      c.beginPath(); c.arc(x, y, 2.4 + flash * 2.6, 0, 7); c.fill();
      if (flash > .3) { c.globalAlpha = flash * .5; c.beginPath(); c.arc(x, y, 7 + flash * 6, 0, 7); c.strokeStyle = k.color; c.lineWidth = 1; c.stroke(); }
      c.globalAlpha = 1;
    }
    c.fillStyle = 'rgba(0,255,157,0.9)'; c.beginPath(); c.arc(cx, cy, 2.6, 0, 7); c.fill();
  },
};

/* ══════════════════ TOPOLOGIA ══════════════════ */
const Topo = {
  cv: null, ctx: null, pkts: [],
  init() {
    this.cv = $('topoCv'); this.ctx = this.cv.getContext('2d');
    S.nodes = NODE_DEF.map(n => ({ ...n, state:'ok', load: rnd(.15, .5), hit: 0, iso: false }));
  },
  node(id) { return S.nodes.find(n => n.id === id); },
  compromise(id, level = 'warn') {
    const n = this.node(id); if (!n) return;
    if (n.state === 'crit') return;
    n.state = level; n.hit = 1;
  },
  packet(fromId, toId, color) {
    const a = this.node(fromId), b = this.node(toId);
    if (!a || !b) return;
    this.pkts.push({ a, b, t: 0, sp: rnd(.02, .045), color });
    if (this.pkts.length > 90) this.pkts.shift();
  },
  attackPath(kind) {
    const paths = {
      DDOS:   ['WAN','FW','SW','WEB1'],
      DB:     ['WAN','FW','SW','APP','DB1'],
      RANSOM: ['WAN','VPN','SW','NAS','BKP'],
      VULN:   ['WAN','FW','IPS'],
      RECON:  ['WAN','FW','DNS'],
    };
    return paths[kind] || ['WAN','FW','SW'];
  },
  runAttack(threat) {
    const path = this.attackPath(threat.kind);
    const color = KINDS[threat.kind].color;
    path.forEach((id, i) => {
      if (i === 0) return;
      setTimeout(() => this.packet(path[i - 1], id, color), i * 190);
    });
    const last = path[path.length - 1];
    setTimeout(() => {
      if (threat.status === 'ATIVO') this.compromise(last, threat.sev === 'CRÍTICA' ? 'crit' : 'warn');
      else this.node(last) && (this.node(last).hit = 1);
    }, path.length * 200);
  },
  healAll() { S.nodes.forEach(n => { n.state = 'ok'; n.iso = false; }); },
  draw(dt) {
    const c = this.ctx, W = this.cv._w, H = this.cv._h;
    c.clearRect(0, 0, W, H);
    const P = n => ({ x: 14 + n.x * (W - 28), y: 12 + n.y * (H - 24) });

    // enlaces
    for (const [a, b] of LINKS) {
      const na = this.node(a), nb = this.node(b); if (!na || !nb) continue;
      const pa = P(na), pb = P(nb);
      const bad = na.state !== 'ok' || nb.state !== 'ok';
      c.strokeStyle = na.iso || nb.iso ? 'rgba(255,210,63,0.35)'
                    : bad ? 'rgba(255,42,74,0.35)' : 'rgba(0,229,255,0.16)';
      c.lineWidth = 1;
      if (na.iso || nb.iso) c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
      c.setLineDash([]);
    }

    // pacotes
    for (let i = this.pkts.length - 1; i >= 0; i--) {
      const p = this.pkts[i];
      if (!S.paused) p.t += p.sp * dt;
      if (p.t >= 1) { this.pkts.splice(i, 1); continue; }
      const pa = P(p.a), pb = P(p.b);
      const x = pa.x + (pb.x - pa.x) * p.t, y = pa.y + (pb.y - pa.y) * p.t;
      c.fillStyle = p.color; c.shadowBlur = 7; c.shadowColor = p.color;
      c.fillRect(x - 1.6, y - 1.6, 3.2, 3.2); c.shadowBlur = 0;
    }

    // nós
    const t = Date.now() / 300;
    for (const n of S.nodes) {
      const p = P(n);
      if (!S.paused && n.hit > 0) n.hit = Math.max(0, n.hit - .012 * dt);
      const col = n.iso ? '#ffd23f' : n.state === 'crit' ? '#ff2a4a' : n.state === 'warn' ? '#ff8a00' : '#00e5ff';
      const r = 5 + n.hit * 3;
      if (n.state !== 'ok' || n.iso) {
        const bl = (Math.sin(t * 2.4) + 1) / 2;
        c.globalAlpha = .18 + bl * .3; c.fillStyle = col;
        c.beginPath(); c.arc(p.x, p.y, r + 7 + bl * 4, 0, 7); c.fill(); c.globalAlpha = 1;
      }
      c.strokeStyle = col; c.lineWidth = 1.3;
      c.fillStyle = 'rgba(1,10,18,0.92)';
      c.beginPath();
      if (n.kind === 'db')      { c.rect(p.x - r, p.y - r, r * 2, r * 2); }
      else if (n.kind === 'fw') { c.moveTo(p.x, p.y - r - 1); c.lineTo(p.x + r + 1, p.y); c.lineTo(p.x, p.y + r + 1); c.lineTo(p.x - r - 1, p.y); c.closePath(); }
      else                      { c.arc(p.x, p.y, r, 0, 7); }
      c.fill(); c.stroke();
      if (n.kind === 'sto') { c.beginPath(); c.arc(p.x, p.y, r * .45, 0, 7); c.stroke(); }

      if (W > 200) {
        c.font = "7px 'Share Tech Mono', monospace";
        c.fillStyle = n.state === 'ok' && !n.iso ? 'rgba(140,200,225,0.55)' : col;
        c.textAlign = 'center';
        c.fillText(n.lab, p.x, p.y + r + 9);
        c.textAlign = 'left';
      }
    }
    const bad = S.nodes.filter(n => n.state !== 'ok').length;
    const tag = $('topoTag');
    if (tag) {
      tag.textContent = `${bad}/${S.nodes.length} COMPROMETIDOS`;
      tag.style.color = bad ? '#ff2a4a' : '';
    }
  },
};

/* ══════════════════ GRÁFICOS DE LINHA ══════════════════ */
function drawSeries(cv, series, opts = {}) {
  const c = cv.getContext('2d'), W = cv._w, H = cv._h;
  c.clearRect(0, 0, W, H);
  // grade
  c.strokeStyle = 'rgba(0,229,255,0.07)'; c.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = H * i / 4; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  const n = series[0]?.data.length || 0;
  if (n < 2) return;
  const max = opts.max ?? Math.max(1, ...series.flatMap(s => s.data));
  for (const s of series) {
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * W, y = H - clamp(s.data[i] / max, 0, 1) * (H - 4) - 2;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    if (s.fill) {
      c.lineTo(W, H); c.lineTo(0, H); c.closePath();
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, s.fill); g.addColorStop(1, 'transparent');
      c.fillStyle = g; c.fill();
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1) * W, y = H - clamp(s.data[i] / max, 0, 1) * (H - 4) - 2;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
    }
    c.strokeStyle = s.color; c.lineWidth = s.w || 1.3;
    c.shadowBlur = s.glow ? 8 : 0; c.shadowColor = s.color;
    c.stroke(); c.shadowBlur = 0;
  }
  if (opts.threshold != null) {
    const y = H - clamp(opts.threshold / max, 0, 1) * (H - 4) - 2;
    c.setLineDash([4, 4]); c.strokeStyle = 'rgba(255,42,74,0.5)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); c.setLineDash([]);
  }
}

/* ══════════════════ SENSORES (painel esquerdo) ══════════════════ */
const SENSOR_DEF = [
  { k:'ddos',   kind:'DDOS',   name:'NEGAÇÃO DE SERVIÇO', unit:'VETORES' },
  { k:'db',     kind:'DB',     name:'INVASÃO DE BANCO',   unit:'TENTATIVAS' },
  { k:'ransom', kind:'RANSOM', name:'RANSOMWARE',         unit:'INDÍCIOS' },
  { k:'vuln',   kind:'VULN',   name:'VULNERABILIDADES',   unit:'ACHADOS' },
  { k:'recon',  kind:'RECON',  name:'RECONHECIMENTO',     unit:'SONDAGENS' },
];
function buildSensors() {
  const box = $('sensors'); box.innerHTML = '';
  for (const s of SENSOR_DEF) {
    const K = KINDS[s.kind];
    const n = el('div', 'sensor');
    n.style.setProperty('--c', K.color);
    n.id = 'sensor-' + s.k;
    n.innerHTML = `
      <div class="s-ico">${K.ico}</div>
      <div><div class="s-name">${s.name}</div><div class="s-state" id="st-${s.k}">perímetro limpo</div></div>
      <div class="s-n"><span id="n-${s.k}">0</span><small>${s.unit}</small></div>
      <i class="s-bar" id="bar-${s.k}"></i>`;
    box.appendChild(n);
  }
}
function bumpSensor(kind, txt) {
  const key = KINDS[kind].sensor;
  S.counts[key]++;
  const n = $('n-' + key), st = $('st-' + key), bar = $('bar-' + key), card = $('sensor-' + key);
  if (n) n.textContent = S.counts[key];
  if (st) st.textContent = txt;
  if (bar) bar.style.width = clamp(S.counts[key] * 4, 4, 100) + '%';
  if (card) { card.classList.add('hot'); setTimeout(() => card.classList.remove('hot'), 520); }
}

/* ══════════════════ FLUXO DE AMEAÇAS ══════════════════ */
function renderThreat(th) {
  const K = KINDS[th.kind], sv = SEV[th.sev];
  const n = el('div', 'ev');
  n.style.setProperty('--c', sv.c);
  n.dataset.id = th.id;
  n.innerHTML = `
    <div class="ev-top">
      <span class="ev-sev">${th.sev}</span>
      <span class="ev-kind">${K.ico} ${th.name}</span>
      <span class="ev-src">${nowHMS(new Date(th.t))}</span>
    </div>
    <div class="ev-desc">${th.desc}</div>
    <div class="ev-foot">
      <span class="ev-ip">${th.ip}</span>
      <span class="ev-geo">${th.geo.city} · ${th.geo.cc}</span>
      <span class="ev-tag ${th.real ? 'real' : ''}">${th.real ? 'REAL' : 'SIM'}</span>
      <span class="ev-st st-${th.status === 'ATIVO' ? 'active' : th.status === 'NEUTRALIZADO' ? 'block' : 'detect'}" id="st-ev-${th.id}">${th.status}</span>
    </div>`;
  n.onclick = () => selectThreat(th.id);
  const feed = $('feed');
  feed.insertBefore(n, feed.firstChild);
  while (feed.childElementCount > 60) feed.removeChild(feed.lastChild);
}
function updateThreatRow(th) {
  const st = $('st-ev-' + th.id);
  if (!st) return;
  st.textContent = th.status;
  st.className = 'ev-st st-' + (th.status === 'ATIVO' ? 'active' : th.status === 'NEUTRALIZADO' ? 'block' : 'detect');
}

/* ══════════════════ NÚCLEO COGNITIVO · ANÁLISE ══════════════════ */
const wescB = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]));

function selectThreat(id) {
  const th = S.threats.find(t => t.id === id);
  if (!th) return;
  S.selected = th;
  document.querySelectorAll('.ev.sel').forEach(n => n.classList.remove('sel'));
  const row = document.querySelector(`.ev[data-id="${id}"]`);
  if (row) row.classList.add('sel');
  renderAnalysis(th);
}

function renderAnalysis(th) {
  $('anEmpty').hidden = true;
  $('anCard').hidden = false;
  const K = KINDS[th.kind], sv = SEV[th.sev];
  $('anHead').innerHTML = `
    <div class="an-h-top">
      <span class="an-ico" style="color:${K.color}">${K.ico}</span>
      <span class="an-name">${wescB(th.name)}</span>
      <span class="an-sev" style="background:${sv.c}">${th.sev}</span>
      <span class="an-tag ${th.real ? 'real' : ''}">${th.real ? 'REAL' : 'SIM'}</span>
    </div>
    <div class="an-h-sub">${th.ip} · ${wescB(th.geo.city)}/${th.geo.cc} · ${wescB(th.geo.asn)} → ${th.target.id}</div>`;
  renderKillchain(th);
  $('mitreLine').innerHTML = `MITRE ATT&CK · <b>${th.mitre[0]}</b> · ${wescB(th.mitre[1])}`;
  renderCognition(th);
  traceThreat(th);
}

function renderKillchain(th) {
  const box = $('killchain');
  const path = th.chain || ['RECON'];
  box.innerHTML = '';
  KC.forEach((st, i) => {
    const inPath = path.includes(st.k);
    const reachedIdx = inPath ? path.indexOf(st.k) : -1;
    let cls = 'kc-step';
    if (!inPath) cls += ' na';
    else if (reachedIdx < th.chainIdx) cls += ' done';
    else if (reachedIdx === th.chainIdx) cls += ' cur';
    else cls += ' pend';
    if (th.status === 'NEUTRALIZADO' && reachedIdx <= th.chainIdx && inPath) cls = 'kc-step done';
    const cell = el('div', cls);
    cell.innerHTML = `<i>${pad(i + 1)}</i><span>${st.lab}</span>`;
    cell.title = st.full;
    box.appendChild(cell);
  });
  const cur = KC[KC_IDX[path[th.chainIdx]]];
  $('kcStageTxt').textContent = th.status === 'NEUTRALIZADO' ? 'contido' : (cur ? cur.full : '—');
}

function renderCognition(th) {
  const box = $('cognition');
  const kb = ATTACK_KB[th.kind] || ATTACK_KB.RECON;
  const stage = (KC[KC_IDX[th.chain[th.chainIdx]]] || {}).full || '—';
  const b = th.brief || {
    leitura: `${th.name} contra ${th.target.id}, origem ${th.geo.city}/${th.geo.cc}. Estágio da cadeia: ${stage}.`,
    mecanismo: kb.mecanismo,
    proximo: pick(kb.proximo),
    atribuicao: pick(kb.atribuicao),
    contramedida: pick(kb.contramedida),
  };
  paintBrief(box, b);
  $('cogSrc').textContent = th.brief ? (th.briefSrc || 'Claude') : 'local · heurística';
  $('cogSrc').className = th.brief ? 'ok' : '';
  fetchBrief(th);
}

function paintBrief(box, b) {
  const row = (ic, lab, txt, cls = '') => txt ? `<div class="cog ${cls}"><span class="cog-ic">${ic}</span><div><b>${lab}</b>${wescB(txt)}</div></div>` : '';
  box.innerHTML =
    row('◎', 'LEITURA', b.leitura, 'lead') +
    row('⚙', 'MECANISMO', b.mecanismo) +
    row('➤', 'PRÓXIMO PASSO', b.proximo, 'next') +
    row('◈', 'ATRIBUIÇÃO', b.atribuicao) +
    row('⛨', 'CONTRAMEDIDA', b.contramedida, 'ctr');
}

let briefInFlight = false, lastBriefAt = 0;
async function fetchBrief(th, opts = {}) {
  if (th.brief && !opts.force) return;        // já temos raciocínio profundo
  if (briefInFlight) return;
  briefInFlight = true;
  const src = $('cogSrc');
  if (S.selected === th) { src.textContent = 'consultando núcleo…'; src.className = 'wait'; }
  try {
    const r = await fetch('/api/cyber-brief', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(briefContext(th)), signal: AbortSignal.timeout(78000),
    });
    const j = await r.json();
    if (j && j.ok && j.brief) {
      th.brief = normBrief(j.brief);
      th.briefSrc = 'Claude · núcleo cognitivo';
      lastBriefAt = Date.now();
      if (S.selected === th) { paintBrief($('cognition'), th.brief); src.textContent = th.briefSrc; src.className = 'ok'; }
      Term.line(`⊛ análise cognitiva de <b>${th.ip}</b> concluída — ${wescB(th.brief.leitura)}`, 'ok');
    } else if (S.selected === th) {
      src.textContent = (j && j.reason === 'no_key') ? 'local (defina ANTHROPIC_API_KEY p/ IA)' : 'local · heurística';
      src.className = '';
    }
  } catch {
    if (S.selected === th) { src.textContent = 'local · heurística'; src.className = ''; }
  } finally { briefInFlight = false; }
}
function normBrief(b) {
  return {
    leitura: b.leitura || b.reading || '',
    mecanismo: b.mecanismo || b.mechanism || '',
    proximo: b.proximo || b.next || '',
    atribuicao: b.atribuicao || b.attribution || '',
    contramedida: b.contramedida || b.counter || '',
  };
}
function briefContext(th) {
  return {
    ameaca: {
      tipo: KINDS[th.kind].lab, tecnica: th.name, severidade: th.sev, mitre: th.mitre, descricao: th.desc,
      estagio_kill_chain: (KC[KC_IDX[th.chain[th.chainIdx]]] || {}).full,
      ip_origem: th.ip, origem: `${th.geo.city}/${th.geo.country}`, asn: th.geo.asn,
      alvo: th.target.id, real: th.real,
    },
    perimetro: {
      defcon: S.defcon, ativas: S.threats.filter(t => t.status === 'ATIVO').length,
      nos_comprometidos: S.nodes.filter(n => n.state !== 'ok').map(n => n.lab), lockdown: S.lockdown,
    },
    fonte: th.real ? 'telemetria real da máquina do operador' : 'cenário de simulação tática',
  };
}
function maybeAutoBrief(th) {
  if (Date.now() - lastBriefAt < 14000) return;   // no máx. ~1 análise online por 14s
  fetchBrief(th);
}

async function traceThreat(th) {
  const box = $('trace'), tag = $('analystTag');
  tag.textContent = 'RASTREANDO…'; tag.style.color = '#ffd23f';
  box.innerHTML = `<div class="hop"><span class="hop-n">›</span><span class="hop-w">traçando rota até a origem…</span></div>`;
  await sleep(240);
  if (S.selected !== th) return;
  box.innerHTML = '';
  const n = rndi(6, 11);
  for (let i = 1; i <= n; i++) {
    if (S.selected !== th) return;
    const final = i === n;
    const lat = (rnd(1, 14) + i * rnd(3, 12)).toFixed(1);
    const w = final ? `${th.geo.asn} · ${th.geo.city}` : pick(['ix-transit','core-rtr','bb1','edge-agg','peer-gw','tier1-bb','submarine-lnk','pop-rtr']) + `-${rndi(1,44)}.${pick(['gru','mia','nyc','ams','fra','sin','lhr','jnb'])}`;
    const hop = el('div', 'hop' + (final ? ' final' : ''));
    hop.innerHTML = `<span class="hop-n">${pad(i)}</span><span class="hop-ip">${final ? th.ip : ipRand()}</span><span class="hop-w">${wescB(w)}</span><span class="hop-ms">${lat}ms</span>`;
    box.appendChild(hop);
    Audio_.blip();
    await sleep(rndi(60, 150));
  }
  tag.textContent = 'ORIGEM LOCALIZADA'; tag.style.color = '#00ff9d';
  Audio_.ok();
}

/* ══════════════════ DOSSIÊ · DENÚNCIA · DOUTRINA (defesa ativa legal) ══════════════════ */
function sha() { return Array.from({ length: 8 }, () => hex(65536)).join('').toLowerCase(); }
function buildDossier(t) {
  const kb = ATTACK_KB[t.kind] || ATTACK_KB.RECON;
  const seenMin = rndi(3, 180);
  Term.line('┌─ DOSSIÊ DE ATRIBUIÇÃO ──────────────────────────', 'info', false);
  Term.line(`│ ORIGEM           : ${t.ip}  (${t.real ? 'REAL' : 'simulada'})`, 'dim', false);
  Term.line(`│ GEO              : ${t.geo.city}, ${t.geo.country} (${t.geo.cc})  ${(+t.geo.lat).toFixed(3)},${(+t.geo.lon).toFixed(3)}`, 'dim', false);
  Term.line(`│ ASN/OPERADOR     : ${t.geo.asn}`, 'dim', false);
  Term.line(`│ VETOR            : ${t.name}  ·  MITRE ${t.mitre[0]} (${t.mitre[1]})`, 'dim', false);
  Term.line(`│ ESTÁGIO          : ${(KC[KC_IDX[t.chain[t.chainIdx]]] || {}).full}  ·  ALVO: ${t.target.id}`, 'dim', false);
  Term.line(`│ 1ª OBSERVAÇÃO    : há ${seenMin} min  ·  TENTATIVAS CORRELATAS: ${rndi(3, 900)}`, 'dim', false);
  Term.line(`│ HIPÓTESE         : ${pick(kb.atribuicao)}`, 'dim', false);
  Term.line(`│ CONFIANÇA        : ${pick(['MÉDIA','MÉDIA-ALTA','ALTA'])}  ·  EVIDÊNCIA: logs+netflow+assinatura`, 'dim', false);
  Term.line(`│ HASH EVIDÊNCIA   : sha256:${sha()}`, 'dim', false);
  Term.line('└─ pronto para "denunciar" ao provedor/CERT — NÃO contra-ataque a origem', 'ok', false);
}
function buildAbuseReport(t) {
  const cert = { BR:'CERT.br (cert@cert.br)', US:'US-CERT/CISA', RU:'CERT.gov.ru', CN:'CNCERT/CC', DE:'CERT-Bund', GB:'NCSC', FR:'CERT-FR', NL:'NCSC-NL' }[t.geo.cc] || 'CERT nacional da origem';
  const dom = String(t.geo.asn || 'operador').toLowerCase().replace(/[^a-z0-9]+/g, '');
  Term.line('┌─ RELATÓRIO DE ABUSO (rascunho para envio) ──────', 'info', false);
  Term.line(`│ Para   : abuse@${dom}.net ; ${cert}`, 'dim', false);
  Term.line(`│ Assunto: Atividade maliciosa originada em ${t.ip}`, 'dim', false);
  Term.line(`│ Registramos ${t.name} (MITRE ${t.mitre[0]}) originada de ${t.ip}`, 'dim', false);
  Term.line(`│ (${t.geo.city}/${t.geo.cc}, ${t.geo.asn}) contra nossa infraestrutura.`, 'dim', false);
  Term.line('│ Anexos: logs com timestamp (UTC), evidência de atribuição e hash.', 'dim', false);
  Term.line('│ Solicitamos investigação e cessação conforme sua política de uso.', 'dim', false);
  Term.line('└─ canal LEGAL de resposta — encaminhado. Nenhum acesso à máquina de origem.', 'ok', false);
}
function printDoctrine() {
  Term.line('DOUTRINA DE DEFESA ATIVA — como o ELION responde a um atacante (dentro da lei):', 'info');
  [
    ['DETECTAR', 'sensores + kill chain: identificar o vetor e o estágio do atacante'],
    ['ATRIBUIR', 'geolocalizar a origem, mapear ASN/TTPs e montar o dossiê de evidência'],
    ['ENGANAR', 'honeypot, sinkhole/tarpit e canary tokens: prender e expor o intruso na SUA rede'],
    ['CONTER', 'blackhole do prefixo, isolar o nó, encerrar processo, restaurar de snapshot'],
    ['DENUNCIAR', 'reportar ao provedor de origem (abuse@) e ao CERT/autoridade competente'],
    ['ENDURECER', 'fechar a superfície explorada para o mesmo ataque não voltar'],
  ].forEach(([k, v]) => Term.line(`  <b>${k.padEnd(9)}</b> ${v}`, 'dim', false));
  Term.line('Tudo acontece DENTRO do seu perímetro. Nada toca a máquina do atacante.', 'ok');
}
function printCounterOffensivePolicy(cmd) {
  Term.line(`⛔ "${cmd}": contra-atacar/invadir/monitorar máquinas de terceiros está DESABILITADO por princípio.`, 'crit');
  Term.line('Acessar, varrer ou derrubar a máquina de quem ataca é acesso não autorizado — crime (Lei 12.737/2012 + Marco Civil) — e te expõe: a origem quase sempre é uma vítima intermediária (proxy/botnet), não o autor real.', 'warn');
  if (/monitor|espion/i.test(cmd))
    Term.line('Vigilância legítima: o modo <b>real</b> monitora a SUA própria máquina/rede; OSINT reúne só informação pública. Sistemas de terceiros sem autorização, não.', 'info');
  Term.line('A resposta que funciona e é legal:', 'info');
  Term.line('  · <b>analisar</b> — entende o ataque inteiro (kill chain + previsão)', 'dim', false);
  Term.line('  · <b>dossie</b> / <b>denunciar</b> — atribui a origem e reporta ao provedor/CERT', 'dim', false);
  Term.line('  · <b>honeypot</b> / <b>sinkhole</b> / <b>engano</b> — prende e expõe o atacante na SUA rede', 'dim', false);
  Term.line('  · <b>lockdown</b> — fecha o perímetro imediatamente', 'dim', false);
  Term.line('Digite <b>doutrina</b> para a cadeia completa de defesa ativa.', 'ok');
}

/* ══════════════════ CVE / SUPERFÍCIE EXPOSTA ══════════════════ */
function addCve(cve) {
  if (S.cves.some(c => c.id === cve.id && c.where === cve.where)) return;
  S.cves.unshift(cve);
  S.cves = S.cves.slice(0, 40);
  renderCves();
}
function renderCves() {
  const box = $('cves');
  if (!S.cves.length) { box.innerHTML = '<div class="cves-empty">nenhum achado — execute <b>varredura</b></div>'; }
  else {
    box.innerHTML = '';
    for (const c of S.cves) {
      const col = c.score >= 9 ? '#ff2a4a' : c.score >= 7 ? '#ff8a00' : c.score >= 4 ? '#ffd23f' : '#00e5ff';
      const n = el('div', 'cve');
      n.style.setProperty('--c', col);
      n.innerHTML = `<div class="cve-score">${c.score.toFixed(1)}</div>
        <div><div class="cve-id">${c.id}</div><div class="cve-d">${c.desc}</div></div>
        <div class="cve-p">${c.where}</div>`;
      box.appendChild(n);
    }
  }
  const tag = $('cveTag');
  tag.textContent = `${S.cves.length} ACHADOS`;
  tag.style.color = S.cves.some(c => c.score >= 9) ? '#ff2a4a' : '';
}
const CVE_POOL = [
  { desc:'execução remota de código não autenticada', score:[8.8, 10] },
  { desc:'desvio de autenticação em endpoint administrativo', score:[8.1, 9.6] },
  { desc:'travessia de diretório em upload de arquivo', score:[6.5, 8.4] },
  { desc:'injeção de SQL em parâmetro de busca', score:[7.5, 9.8] },
  { desc:'estouro de buffer em parser de protocolo', score:[7.0, 9.2] },
  { desc:'escalada de privilégio local via serviço', score:[6.8, 8.2] },
  { desc:'exposição de informação sensível em log', score:[3.5, 5.9] },
  { desc:'negação de serviço por consumo de memória', score:[5.0, 7.5] },
  { desc:'desserialização de dados não confiáveis', score:[8.0, 9.8] },
  { desc:'validação de certificado ausente', score:[4.8, 7.4] },
];
function synthCve() {
  const p = pick(CVE_POOL);
  return {
    id: `CVE-${rndi(2023, 2026)}-${rndi(1000, 49999)}`,
    desc: p.desc,
    score: rnd(p.score[0], p.score[1]),
    where: pick(['WEB-01','WEB-02','APP-TIER','DB-PRIME','VPN-GW','CORE-SW','STORAGE','DNS']),
  };
}

/* ══════════════════ DEFCON ══════════════════ */
function recomputeDefcon() {
  let score = 0;
  for (const th of S.threats) {
    if (th.status === 'ATIVO') score += SEV[th.sev].w;
    else if (th.status === 'DETECTADO') score += SEV[th.sev].w * .4;
  }
  score += S.nodes.filter(n => n.state === 'crit').length * 4;
  score += S.nodes.filter(n => n.state === 'warn').length * 1.5;
  const lv = score >= 60 ? 1 : score >= 34 ? 2 : score >= 16 ? 3 : score >= 5 ? 4 : 5;
  setDefcon(lv);
}
const DEFCON_TXT = {
  5: 'PERÍMETRO ESTÁVEL', 4: 'VIGILÂNCIA AUMENTADA', 3: 'AMEAÇA CONFIRMADA',
  2: 'DEFESA ATIVA', 1: 'COMPROMETIMENTO EM CURSO',
};
function setDefcon(lv) {
  lv = clamp(lv, 1, 5);
  if (lv === S.defcon) return;
  const worse = lv < S.defcon;
  S.defcon = lv;
  const d = $('defcon');
  d.dataset.lv = lv;
  $('defconVal').textContent = lv;
  $('defconTxt').textContent = DEFCON_TXT[lv];
  document.body.classList.toggle('critical', lv <= 2);
  if (worse) {
    Term.line(`<b>DEFCON ${lv}</b> — ${DEFCON_TXT[lv]}`, lv <= 2 ? 'crit' : 'warn');
    flash(); if (lv <= 2) Audio_.alarm(); else Audio_.detect();
    if (lv <= 2) toast(`⚠ DEFCON ${lv} — ${DEFCON_TXT[lv]}`, '#ff2a4a', 5000);
  } else {
    Term.line(`DEFCON restabelecido em <b>${lv}</b> — ${DEFCON_TXT[lv]}`, 'ok');
  }
}
function flash() {
  const f = $('alertFlash');
  f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 130);
}
function glitch() {
  document.body.classList.add('glitch');
  setTimeout(() => document.body.classList.remove('glitch'), 460);
}

/* ══════════════════ GERAÇÃO DE AMEAÇAS ══════════════════ */
function makeGeo() {
  const o = pick(ORIGINS);
  return {
    city: o[0], cc: o[1], country: o[0], lat: o[2] + rnd(-1.2, 1.2), lon: o[3] + rnd(-1.2, 1.2),
    asn: pick(ASNS),
  };
}
function spawnThreat(opts = {}) {
  const kind = opts.kind || weightedKind();
  const tpl = opts.tpl || pick(PLAYBOOK[kind]);
  const geo = opts.geo || makeGeo();
  const target = opts.target || pick(ASSETS);
  const th = {
    id: S.seq++,
    kind, name: tpl.n, sev: opts.sev || tpl.sev,
    desc: opts.desc || tpl.d(),
    ip: opts.ip || ipRand(),
    geo, target, actor: opts.actor || pick(ACTORS),
    t: Date.now(),
    status: 'DETECTADO',
    real: !!opts.real,
  };
  // cadeia de ataque + técnica MITRE
  th.chain = KC_PATH[kind] || ['RECON'];
  th.chainIdx = 0;
  th.mitre = opts.mitre || pick(MITRE[kind] || MITRE.RECON);
  th.nextStageAt = th.t + rndi(3200, 6400);
  S.threats.unshift(th);
  S.threats = S.threats.slice(0, 120);
  S.rateWindow.push(th.t);

  const K = KINDS[kind];
  renderThreat(th);
  bumpSensor(kind, tpl.n.toLowerCase());
  Radar.ping(th);
  WorldMap.addArc(geo.lat, geo.lon, target.lat, target.lon, SEV[th.sev].c, kind, th.real);
  Topo.runAttack(th);

  const tagSrc = th.real ? '<b>[REAL]</b> ' : '';
  Term.line(`${tagSrc}${K.ico} <b>${th.name}</b> · ${th.desc} · origem ${th.ip} (${geo.city}/${geo.cc}) → ${target.id}`,
    th.sev === 'CRÍTICA' ? 'crit' : th.sev === 'ALTA' ? 'warn' : 'info');

  // defesa automática — quanto menor a severidade, maior a chance de bloqueio imediato
  const autoP = { BAIXA:.98, MÉDIA:.93, ALTA:.82, 'CRÍTICA':.58 }[th.sev];
  if (S.lockdown || Math.random() < autoP) {
    setTimeout(() => neutralize(th, S.lockdown ? 'LOCKDOWN' : pick(['WAF','IPS','SCRUBBING','ACL DE BORDA','HEURÍSTICA EDR'])), rndi(500, 2100));
  } else {
    th.status = 'ATIVO';
    // se o operador não agir, o playbook automatizado fecha a brecha — mas devagar
    th.autoFix = th.t + rndi(24000, 46000);
    updateThreatRow(th);
    Audio_.alarm(); flash(); glitch();
    Term.line(`⚠ <b>${th.name}</b> NÃO contido pela defesa automática — ação do operador requerida (contramedidas à direita)`, 'crit');
    toast(`⚠ ${K.lab} ativo — ${th.geo.city}/${th.geo.cc}`, SEV[th.sev].c, 6000);
    if (kind === 'RANSOM') { S.ent = Math.min(7.95, S.ent + rnd(1.4, 2.6)); S.writes += rndi(400, 3000); }
    if (kind === 'DDOS') S.ddosBoost = (S.ddosBoost || 0) + rnd(.6, 1.6);
    // ── núcleo cognitivo fala: leitura + previsão do próximo passo ──
    const kb = ATTACK_KB[kind];
    if (kb) Term.line(`⊛ <b>ELION</b> [${th.mitre[0]} ${th.mitre[1]}] — atribuição: ${pick(kb.atribuicao)} · <b>próximo provável:</b> ${pick(kb.proximo)}`, 'info');
    // ameaça crítica ativa dispara análise cognitiva automática (limitada no tempo)
    if (th.sev === 'CRÍTICA') maybeAutoBrief(th);
  }
  if (kind === 'VULN' && Math.random() < .6) addCve(synthCve());
  recomputeDefcon();
  return th;
}
function weightedKind() {
  const r = Math.random();
  if (r < .34) return 'RECON';
  if (r < .58) return 'DDOS';
  if (r < .76) return 'DB';
  if (r < .90) return 'VULN';
  return 'RANSOM';
}
function neutralize(th, how = 'WAF') {
  if (!th || th.status === 'NEUTRALIZADO') return;
  th.status = 'NEUTRALIZADO';
  S.blocked++;
  updateThreatRow(th);
  Term.line(`✓ ${th.name} neutralizado por <b>${how}</b> · origem ${th.ip} em quarentena`, 'ok');
  Audio_.ok();
  if (S.selected === th) {
    const tag = $('analystTag'); if (tag) { tag.textContent = 'NEUTRALIZADO'; tag.style.color = '#00ff9d'; }
    renderKillchain(th);
  }
  recomputeDefcon();
}

/* ══════════════════ CONTRAMEDIDAS ══════════════════ */
const CM = {
  async run(action, btn) {
    if (btn) btn.classList.add('busy');
    const done = () => btn && btn.classList.remove('busy');
    const actives = S.threats.filter(t => t.status === 'ATIVO');
    const sel = S.selected && S.selected.status === 'ATIVO' ? S.selected : actives[0];

    switch (action) {
      case 'mitigate': {
        const targets = actives.filter(t => t.kind === 'DDOS');
        if (!targets.length && !sel) { Term.line('nenhuma ameaça ativa para mitigar', 'dim'); break; }
        await this.seq(['ativando centro de scrubbing…','desviando prefixo para depuração BGP…','aplicando rate-limit adaptativo por origem…','revalidando sessões legítimas…']);
        (targets.length ? targets : [sel]).forEach(t => neutralize(t, 'SCRUBBING + RATE-LIMIT'));
        S.ddosBoost = 0; S.dropPct = 0;
        toast('✓ Mitigação aplicada — tráfego depurado na borda', '#00ff9d');
        break;
      }
      case 'blackhole': {
        if (!sel) { Term.line('selecione uma ameaça ativa no fluxo antes de descartar o prefixo', 'dim'); break; }
        const pre = sel.ip.split('.').slice(0, 3).join('.') + '.0/24';
        await this.seq([`resolvendo prefixo de ${sel.ip}…`, `anunciando ${pre} como blackhole (RTBH)…`, 'propagando para trânsitos upstream…']);
        S.threats.filter(t => t.status === 'ATIVO' && t.ip.startsWith(sel.ip.split('.').slice(0, 3).join('.'))).forEach(t => neutralize(t, 'BLACKHOLE RTBH'));
        toast(`⊘ ${pre} descartado na borda`, '#00ff9d');
        break;
      }
      case 'isolate': {
        const bad = S.nodes.filter(n => n.state !== 'ok' && !n.iso);
        if (!bad.length) { Term.line('nenhum nó comprometido para isolar', 'dim'); break; }
        await this.seq(bad.slice(0, 3).map(n => `movendo <b>${n.lab}</b> para VLAN de quarentena…`));
        bad.forEach(n => { n.iso = true; n.state = 'warn'; });
        S.threats.filter(t => t.status === 'ATIVO' && t.kind !== 'DDOS').forEach(t => neutralize(t, 'ISOLAMENTO DE SEGMENTO'));
        toast(`⧈ ${bad.length} nó(s) isolado(s) em quarentena`, '#ffd23f');
        break;
      }
      case 'kill': {
        const pid = rndi(1200, 9800);
        await this.seq([`enumerando processos suspeitos…`, `assinatura maliciosa em PID ${pid}…`, `encerrando árvore de processos ${pid}…`, 'removendo persistência (tarefas/serviços)…']);
        S.threats.filter(t => t.status === 'ATIVO' && (t.kind === 'RANSOM' || t.kind === 'DB')).forEach(t => neutralize(t, `KILL PID ${pid}`));
        S.ent = 3.9; S.writes = 12;
        toast(`✖ Processo ${pid} encerrado e persistência removida`, '#00ff9d');
        break;
      }
      case 'rollback': {
        await this.seq(['localizando último snapshot íntegro…','validando hash das cópias sombra…','revertendo volumes afetados…','reindexando arquivos restaurados…']);
        S.threats.filter(t => t.status === 'ATIVO' && t.kind === 'RANSOM').forEach(t => neutralize(t, 'ROLLBACK DE SNAPSHOT'));
        S.ent = 3.9; S.writes = 12;
        S.nodes.forEach(n => { if (n.kind === 'sto') { n.state = 'ok'; n.iso = false; } });
        toast('↺ Volumes restaurados a partir de snapshot íntegro', '#00ff9d');
        break;
      }
      case 'honeypot': {
        await this.seq(['instanciando serviço-isca em segmento cego…','reescrevendo rota do atacante para a isca…','iniciando captura de TTPs…']);
        actives.filter(t => t.kind !== 'DDOS').forEach(t => neutralize(t, 'DESVIO PARA HONEYPOT'));
        Term.line(`isca coletando: ${rndi(3,28)} comandos, ${rndi(1,9)} binários, ${rndi(2,14)} credenciais falsas usadas`, 'info');
        toast('◈ Atacante desviado para honeypot — coletando TTPs', '#00e5ff');
        break;
      }
      case 'sinkhole': {
        if (!sel && !actives.length) { Term.line('selecione uma ameaça ativa para drenar a sessão', 'dim'); break; }
        const ip = (sel || actives[0]).ip;
        await this.seq([`redirecionando ${ip} para o sinkhole controlado…`, 'aplicando tarpit: respostas propositalmente lentas prendem a conexão', 'mantendo o socket aberto para exaurir o recurso do atacante']);
        (actives.length ? actives : [sel]).filter(t => t.kind !== 'RANSOM').forEach(t => neutralize(t, 'SINKHOLE/TARPIT'));
        toast('⇲ Origem drenada no sinkhole — sessão presa', '#00ff9d');
        break;
      }
      case 'deception': {
        await this.seq(['semeando canary tokens em compartilhamentos e credenciais falsas…', 'instrumentando documentos-isca com callback de alerta…', 'qualquer toque nas iscas identifica o intruso na hora']);
        actives.filter(t => t.kind === 'DB' || t.kind === 'RECON' || t.kind === 'RANSOM').forEach(t => neutralize(t, 'TOKENS DE ENGANO — intruso exposto'));
        Term.line(`malha de engano ativa: ${rndi(6,40)} canary tokens · ${rndi(2,12)} credenciais falsas · ${rndi(1,8)} documentos rastreáveis`, 'info');
        toast('❖ Engano ativo — o próximo acesso denuncia o intruso', '#00e5ff');
        break;
      }
      case 'dossier': {
        const t = sel || S.selected || S.threats[0];
        if (!t) { Term.line('nenhuma ameaça para documentar', 'dim'); break; }
        await this.seq([`consolidando evidência de ${t.ip}…`, 'correlacionando TTPs com o histórico de origem…', 'gerando hash para cadeia de custódia…']);
        buildDossier(t);
        toast('▤ Dossiê de atribuição gerado', '#00ff9d');
        break;
      }
      case 'abuse': {
        const t = sel || S.selected || S.threats[0];
        if (!t) { Term.line('selecione a ameaça a denunciar', 'dim'); break; }
        await this.seq([`resolvendo contato de abuse do ASN ${t.geo.asn}…`, 'anexando logs, timestamps (UTC) e evidência de atribuição…', 'encaminhando ao provedor de origem e ao CERT nacional…']);
        buildAbuseReport(t);
        toast('✉ Denúncia formal encaminhada ao provedor/CERT', '#00ff9d');
        break;
      }
      case 'lockdown': {
        S.lockdown = !S.lockdown;
        document.body.classList.toggle('lockdown', S.lockdown);
        if (S.lockdown) {
          await this.seq(['elevando política de firewall para NEGAR-TUDO…','encerrando sessões externas estabelecidas…','forçando MFA em todos os acessos administrativos…','congelando alterações de configuração…']);
          actives.forEach(t => neutralize(t, 'LOCKDOWN'));
          Topo.healAll();
          toast('⛔ LOCKDOWN ATIVO — perímetro fechado', '#ff2a4a', 6000);
          Term.line('<b>LOCKDOWN TOTAL ATIVO</b> — nenhuma sessão externa é aceita. Detecção continua ativa.', 'crit');
        } else {
          await this.seq(['reabrindo perímetro de forma escalonada…','restaurando política padrão de firewall…']);
          toast('Lockdown desfeito — perímetro reaberto', '#00e5ff');
        }
        break;
      }
    }
    recomputeDefcon();
    if (btn) done();
    $('cmTag').textContent = 'PRONTO';
  },
  async seq(steps) {
    $('cmTag').textContent = 'EXECUTANDO…';
    for (const s of steps) {
      Term.line(`❯ ${s}`, 'dim');
      Audio_.blip();
      await sleep(rndi(230, 520));
    }
  },
};

/* ══════════════════ COMANDOS DO CONSOLE ══════════════════ */
const HELP = [
  ['ajuda',              'esta lista'],
  ['varredura',          'varredura completa do perímetro e dos ativos'],
  ['ameacas',            'lista as ameaças vivas com id e status'],
  ['rastrear &lt;ip|id&gt;',  'rastreia a origem (geo + rota de saltos)'],
  ['analisar [ip|id]',   'núcleo cognitivo: kill chain + MITRE + previsão do próximo passo'],
  ['killchain',          'mostra os estágios da cadeia de ataque da ameaça'],
  ['mitigar [id|tudo]',  'aplica scrubbing/rate-limit'],
  ['bloquear &lt;ip&gt;',     'descarta o prefixo da origem (blackhole)'],
  ['isolar [nó]',        'quarentena de um nó comprometido'],
  ['matar &lt;pid&gt;',       'encerra processo malicioso'],
  ['restaurar',          'reverte volumes a snapshot íntegro'],
  ['honeypot',           'desvia o atacante para isca'],
  ['sinkhole / engano',  'defesa ativa: drena/prende e expõe o atacante'],
  ['dossie',             'monta o dossiê de atribuição da origem'],
  ['denunciar',          'gera a denúncia ao provedor/CERT da origem'],
  ['doutrina',           'a doutrina completa de defesa ativa (legal)'],
  ['lockdown',           'liga/desliga o fechamento total do perímetro'],
  ['nmap &lt;host&gt;',       'varredura de portas do ativo interno'],
  ['nos',                'estado da topologia interna'],
  ['defcon [1-5]',       'consulta ou força o nível de prontidão'],
  ['real / sim',         'alterna telemetria real da máquina / simulação'],
  ['status',             'resumo do console'],
  ['limpar',             'limpa o console'],
  ['sair',               'encerra e volta à central'],
];
let cmdBusy = false;
async function runCommand(raw) {
  const line = raw.trim();
  if (!line) return;
  if (cmdBusy) { Term.line('aguarde — comando anterior ainda em execução', 'warn'); return; }
  cmdBusy = true;
  try { await execCommand(line); } finally { cmdBusy = false; }
}
async function execCommand(line) {
  Term.line(`<span style="color:#00ff9d">root@elion-x</span>:~# ${line}`, 'echo', false);
  S.history.unshift(line); S.history = S.history.slice(0, 60); S.histIdx = -1;
  const [cmd, ...args] = line.split(/\s+/);
  const a = args.join(' ');
  const c = cmd.toLowerCase().replace(/[áà]/g, 'a').replace(/ç/g, 'c').replace(/ó/g, 'o');

  switch (c) {
    case 'ajuda': case 'help': case '?':
      Term.line('COMANDOS DISPONÍVEIS:', 'info');
      HELP.forEach(([k, d]) => Term.line(`  <b>${k}</b> — ${d}`, 'dim', false));
      break;

    case 'varredura': case 'scan': case 'sweep': {
      Term.line('iniciando varredura ativa do perímetro…', 'info');
      $('radarTag').textContent = 'VARRENDO…';
      const steps = ['descoberta de hosts (ARP/ICMP)','mapeamento de portas TCP/UDP','fingerprint de serviços','checagem de versões e patches','avaliação de configuração TLS','revisão de exposição na borda'];
      for (let i = 0; i < steps.length; i++) {
        await Term.type(`[${pad(i + 1)}/${pad(steps.length)}] ${steps[i]}…`, 'dim', 6);
        Audio_.blip();
        await sleep(rndi(180, 420));
      }
      const found = rndi(2, 6);
      for (let i = 0; i < found; i++) addCve(synthCve());
      const exposed = rndi(1, 4);
      Term.line(`varredura concluída — <b>${S.nodes.length}</b> hosts, <b>${found}</b> achados de vulnerabilidade, <b>${exposed}</b> serviço(s) exposto(s) na borda`, found > 3 ? 'warn' : 'ok');
      $('radarTag').textContent = 'SWEEP 360°';
      if (found >= 4) spawnThreat({ kind:'VULN' });
      recomputeDefcon();
      break;
    }

    case 'ameacas': case 'threats': case 'lista': {
      const live = S.threats.slice(0, 14);
      if (!live.length) { Term.line('nenhuma ameaça registrada', 'dim'); break; }
      Term.line(`${S.threats.length} ameaça(s) no registro · ${S.threats.filter(t => t.status === 'ATIVO').length} ativa(s):`, 'info');
      live.forEach(t => Term.line(`  #${pad(t.id, 3)} [${t.status.padEnd(13)}] ${t.sev.padEnd(8)} ${t.name} · ${t.ip} (${t.geo.cc})`, t.status === 'ATIVO' ? 'crit' : 'dim', false));
      break;
    }

    case 'rastrear': case 'trace': case 'traceroute':
    case 'analisar': case 'analyze': case 'brief': {
      let th = a ? (/^\d+$/.test(a) ? S.threats.find(t => t.id === +a) : S.threats.find(t => t.ip === a)) : null;
      if (!th && !a) th = S.selected || S.threats.find(t => t.status === 'ATIVO') || S.threats[0];
      if (!th && a) {
        th = { id: 0, ip: a, name: 'ORIGEM DESCONHECIDA', sev: 'MÉDIA', kind: 'RECON',
               geo: makeGeo(), target: ASSETS[0], actor: 'NÃO ATRIBUÍDO', status: 'DETECTADO', real: false, t: Date.now(),
               chain: KC_PATH.RECON, chainIdx: 0, mitre: pick(MITRE.RECON) };
      }
      if (!th) { Term.line('nenhuma ameaça para analisar — aguarde uma detecção ou rode varredura', 'dim'); break; }
      S.selected = th;
      document.querySelectorAll('.ev.sel').forEach(n => n.classList.remove('sel'));
      document.querySelector(`.ev[data-id="${th.id}"]`)?.classList.add('sel');
      Term.line(`acionando núcleo cognitivo sobre <b>${th.ip}</b> (${th.name})…`, 'info');
      renderAnalysis(th);
      if (c === 'analisar' || c === 'analyze' || c === 'brief') fetchBrief(th, { force: true });
      break;
    }

    case 'killchain': case 'cadeia': {
      const th = S.selected || S.threats.find(t => t.status === 'ATIVO') || S.threats[0];
      if (!th) { Term.line('nenhuma ameaça ativa', 'dim'); break; }
      Term.line(`CADEIA DE ATAQUE · ${th.name} (${th.ip}) — MITRE ${th.mitre[0]}:`, 'info');
      th.chain.forEach((k, i) => Term.line(`  ${i <= th.chainIdx ? '▣' : '▢'} ${pad(i + 1)} ${(KC[KC_IDX[k]] || {}).full}${i === th.chainIdx ? '   ← estágio atual' : ''}`, i <= th.chainIdx ? 'warn' : 'dim', false));
      break;
    }

    case 'dossie': case 'dossier': {
      const t = S.selected || S.threats.find(x => x.status === 'ATIVO') || S.threats[0];
      if (!t) { Term.line('nenhuma ameaça para documentar', 'dim'); break; }
      buildDossier(t); break;
    }
    case 'denunciar': case 'abuse': case 'reportar': {
      const t = S.selected || S.threats.find(x => x.status === 'ATIVO') || S.threats[0];
      if (!t) { Term.line('selecione a ameaça a denunciar', 'dim'); break; }
      buildAbuseReport(t); break;
    }
    case 'sinkhole': case 'tarpit': await CM.run('sinkhole'); break;
    case 'engano': case 'deception': case 'canary': await CM.run('deception'); break;
    case 'doutrina': case 'contrainteligencia': case 'contra-inteligencia': printDoctrine(); break;
    case 'hackback': case 'hack-back': case 'atacar': case 'contratacar': case 'contra-atacar':
    case 'invadir': case 'revidar': case 'espionar': case 'monitorar-alvo':
      printCounterOffensivePolicy(c); break;

    case 'mitigar': case 'mitigate': await CM.run('mitigate'); break;
    case 'bloquear': case 'block': {
      if (a) {
        const th = S.threats.find(t => t.ip === a);
        if (th) S.selected = th;
        else { Term.line(`${a} não consta no registro — descartando prefixo mesmo assim`, 'warn'); S.selected = { ip:a, status:'ATIVO' }; }
      }
      await CM.run('blackhole'); break;
    }
    case 'isolar': case 'isolate': await CM.run('isolate'); break;
    case 'matar': case 'kill': await CM.run('kill'); break;
    case 'restaurar': case 'rollback': await CM.run('rollback'); break;
    case 'honeypot': await CM.run('honeypot'); break;
    case 'lockdown': await CM.run('lockdown'); break;

    case 'nmap': {
      const host = a || pick(S.nodes).lab;
      Term.line(`varredura de portas em <b>${host}</b> (somente ativos internos deste cenário)…`, 'info');
      await sleep(400);
      const ports = [[22,'ssh','OpenSSH 9.6'],[80,'http','nginx 1.27'],[443,'https','nginx 1.27 (TLS1.3)'],[3306,'mysql','MySQL 8.0'],[5432,'postgresql','PostgreSQL 16'],[3389,'ms-wbt','Terminal Services'],[445,'microsoft-ds','SMB 3.1.1'],[6379,'redis','Redis 7.2'],[27017,'mongodb','MongoDB 7.0'],[8080,'http-proxy','—']];
      const open = ports.filter(() => Math.random() < .45).slice(0, 6);
      Term.line('PORTA      ESTADO   SERVIÇO       VERSÃO', 'dim', false);
      for (const [p, s, v] of open) {
        await sleep(rndi(60, 160));
        const risky = [3389, 445, 6379, 27017, 3306].includes(p);
        Term.line(`${String(p + '/tcp').padEnd(11)}${'aberta'.padEnd(9)}${s.padEnd(14)}${v}${risky ? '   ← exposição relevante' : ''}`, risky ? 'warn' : '', false);
        Audio_.blip();
      }
      Term.line(`${open.length} porta(s) aberta(s) de ${ports.length} testadas em ${host}`, 'info');
      if (open.some(([p]) => [3389, 445, 6379].includes(p))) addCve({ id:`EXPO-${rndi(100,999)}`, desc:'serviço de alto risco acessível na rede', score:rnd(7.2,9.1), where:host });
      break;
    }

    case 'nos': case 'nodes': {
      Term.line('TOPOLOGIA INTERNA:', 'info');
      S.nodes.forEach(n => Term.line(`  ${n.lab.padEnd(12)} ${n.iso ? 'QUARENTENA' : n.state === 'crit' ? 'COMPROMETIDO' : n.state === 'warn' ? 'SUSPEITO' : 'ÍNTEGRO'}`,
        n.state === 'crit' ? 'crit' : n.state === 'warn' ? 'warn' : 'dim', false));
      break;
    }

    case 'defcon': {
      if (a && /^[1-5]$/.test(a)) { S.defcon = 6; setDefcon(+a); }
      else Term.line(`DEFCON <b>${S.defcon}</b> — ${DEFCON_TXT[S.defcon]}`, S.defcon <= 2 ? 'crit' : 'info');
      break;
    }

    case 'real': await setRealMode(true); break;
    case 'sim': case 'simulacao': await setRealMode(false); break;

    case 'status': {
      const up = fmtUptime();
      Term.line(`fonte: <b>${S.real ? 'TELEMETRIA REAL (/api/cyber)' : 'SIMULAÇÃO TÁTICA'}</b> · uptime ${up} · DEFCON ${S.defcon}`, 'info');
      Term.line(`ameaças: ${S.threats.length} registradas · ${S.threats.filter(t => t.status === 'ATIVO').length} ativas · ${S.blocked} neutralizadas`, 'dim', false);
      Term.line(`sensores: DDoS ${S.counts.ddos} · BD ${S.counts.db} · ransomware ${S.counts.ransom} · vuln ${S.counts.vuln} · recon ${S.counts.recon}`, 'dim', false);
      Term.line(`perímetro: ${S.lockdown ? 'LOCKDOWN' : 'aberto'} · nós comprometidos ${S.nodes.filter(n => n.state !== 'ok').length}/${S.nodes.length}`, 'dim', false);
      break;
    }

    case 'ps': {
      Term.line('PID    PROCESSO            CPU%   RAM', 'dim', false);
      for (let i = 0; i < 7; i++) Term.line(`${String(rndi(700,9800)).padEnd(7)}${pick(['elion-core','node','svchost','chrome','postgres','nginx','systemd','defender']).padEnd(20)}${rnd(0,42).toFixed(1).padEnd(7)}${rndi(20,1800)} MB`, '', false);
      break;
    }
    case 'netstat': {
      Term.line('PROTO  LOCAL              REMOTO                ESTADO', 'dim', false);
      for (let i = 0; i < 8; i++) Term.line(`tcp    0.0.0.0:${String(pick([443,80,22,5432,3000,8080])).padEnd(12)}${(ipRand() + ':' + rndi(1024,65535)).padEnd(22)}${pick(['ESTABELECIDA','ESCUTA','TIME_WAIT'])}`, '', false);
      break;
    }
    case 'whoami': Term.line('root · console de defesa ELION-X · privilégios totais neste cenário', 'ok'); break;

    case 'limpar': case 'clear': case 'cls': Term.clear(); break;
    case 'sair': case 'exit': case 'quit': closeConsole(); break;

    case 'matrix':
      $('rain').style.opacity = $('rain').style.opacity === '0.5' ? '' : '0.5';
      Term.line('densidade da chuva de código alternada', 'ok'); break;

    default:
      Term.line(`comando desconhecido: <b>${cmd}</b> — digite <b>ajuda</b>`, 'warn');
  }
}

/* ══════════════════ TELEMETRIA REAL ══════════════════ */
async function setRealMode(on) {
  if (on === S.real) return;
  if (on) {
    // a varredura local roda PowerShell + geolocalização: pode levar ~30s. Avisa já.
    $('modeTxt').textContent = 'CONECTANDO…';
    $('modeBtn').classList.add('act');
    Term.line('conectando à telemetria defensiva local (/api/cyber) — a varredura do sistema leva até ~30s…', 'info');
    const ok = await pollReal(true);
    $('modeBtn').classList.remove('act');
    if (!ok) {
      $('modeTxt').textContent = 'SIMULAÇÃO';
      Term.line('telemetria real indisponível — o servidor ELION-X precisa estar rodando. Permanecendo em SIMULAÇÃO.', 'warn');
      toast('Telemetria real indisponível — servidor offline', '#ffd23f', 5000);
      return;
    }
    S.real = true;
    S.realTimer = setInterval(() => pollReal(false), 45000); // > que o tempo de resposta da varredura
    Term.line('<b>MODO REAL ATIVO</b> — eventos marcados com [REAL] vêm da varredura defensiva da SUA máquina. A simulação continua rodando em paralelo, marcada como SIM.', 'ok');
    toast('◉ Telemetria real conectada', '#00ff9d');
  } else {
    S.real = false;
    clearInterval(S.realTimer); S.realTimer = null;
    Term.line('modo real desligado — apenas cenário simulado', 'info');
  }
  const btn = $('modeBtn');
  btn.classList.toggle('real', S.real);
  $('modeTxt').textContent = S.real ? 'REAL + SIM' : 'SIMULAÇÃO';
  const mm = $('mapMode');
  mm.textContent = S.real ? 'FONTE: TELEMETRIA REAL + SIMULAÇÃO' : 'FONTE: SIMULAÇÃO TÁTICA';
  mm.classList.toggle('real', S.real);
}

/* registra a chave já vista, mantendo o conjunto limitado em sessões longas */
function seen(key) {
  S.realSeen.add(key);
  if (S.realSeen.size > 400) S.realSeen.delete(S.realSeen.values().next().value);
}
async function pollReal(first) {
  if (S.polling) return true;           // a varredura anterior ainda está no ar
  S.polling = true;
  try { return await doPollReal(first); } finally { S.polling = false; }
}
async function doPollReal(first) {
  let rep;
  try {
    const r = await fetch('/api/cyber?focus=geral', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    rep = await r.json();
  } catch (e) {
    if (!first) Term.line(`falha ao ler telemetria real: ${e.message}`, 'warn');
    return false;
  }
  if (!rep || typeof rep !== 'object') return false;

  const geoOf = (g, ip) => ({
    city: g?.cidade || 'origem não resolvida',
    cc: g?.pais || '—', country: g?.pais || 'desconhecido',
    lat: typeof g?.lat === 'number' ? g.lat : rnd(-40, 60),
    lon: typeof g?.lon === 'number' ? g.lon : rnd(-120, 130),
    asn: g?.isp || 'operador não identificado',
    unresolved: !g,
  });

  // 1) tentativas de ataque contra o servidor (log real do ELION-X)
  for (const at of (rep.resumoAtaques?.ipsAtacantes || [])) {
    const key = 'atk:' + at.ip + ':' + (at.tipos || []).join(',');
    if (S.realSeen.has(key)) continue;
    seen(key);
    const tipo = (at.tipos || [])[0] || 'Sondagem';
    const kind = /sql|inject/i.test(tipo) ? 'DB' : /travers|xss|command|rce|log4/i.test(tipo) ? 'VULN' : 'RECON';
    spawnThreat({
      kind, real: true, ip: at.ip, geo: geoOf(at.geo, at.ip),
      tpl: { n: tipo.toUpperCase(), sev: kind === 'DB' ? 'CRÍTICA' : 'MÉDIA', d: () => (at.exemplos || []).join(' · ') || 'requisição maliciosa registrada' },
      actor: 'ORIGEM REAL — REGISTRO DO SERVIDOR',
    });
  }

  // 2) rajadas com perfil de DDoS
  for (const d of (rep.resumoAtaques?.ddos || [])) {
    const key = 'ddos:' + d.ip + ':' + Math.floor(d.rpm / 50);
    if (S.realSeen.has(key)) continue;
    seen(key);
    spawnThreat({
      kind:'DDOS', real:true, ip:d.ip, geo: geoOf(null, d.ip),
      tpl: { n:'RAJADA DE REQUISIÇÕES', sev:'ALTA', d: () => `${d.rpm} req/min do mesmo IP contra o servidor local` },
      actor: 'ORIGEM REAL — RING BUFFER',
    });
  }

  // 3) conexões externas ativas — desenhadas como fluxo monitorado (não são ataques)
  const conns = rep.rede?.conexoesExternas || [];
  for (const cn of conns.slice(0, 12)) {
    if (!cn.geo || typeof cn.geo.lat !== 'number') continue;
    WorldMap.addArc(cn.geo.lat, cn.geo.lon, ASSETS[0].lat, ASSETS[0].lon, '#1f7cff', 'RECON', true);
  }
  if (first && conns.length) {
    Term.line(`[REAL] ${conns.length} destino(s) externo(s) ativo(s) na sua máquina · ${rep.rede.totalEstabelecidas} conexões estabelecidas`, 'info');
    conns.slice(0, 6).forEach(cn => Term.line(`  ${cn.ip.padEnd(16)} ${(cn.geo ? cn.geo.cidade + '/' + cn.geo.pais : 'não resolvido').padEnd(24)} ${(cn.processos || []).join(',') || '—'}`, 'dim', false));
  }

  // 4) portas expostas ao mundo → superfície de ataque real
  // o backend já classifica a porta (nome + risco); uso o rótulo dele em vez de
  // adivinhar de novo aqui — duas tabelas de risco divergindo é bug garantido
  const grauDaPorta = r => /CRÍTICO/i.test(r) ? rnd(8.8, 9.8) : /ALTO/i.test(r) ? rnd(7.2, 8.7)
                         : /MÉDIO/i.test(r)  ? rnd(4.5, 6.4) : rnd(2.8, 4.2);
  for (const p of (rep.rede?.escutaExposta || [])) {
    addCve({
      id: `PORTA-${p.port}`,
      desc: `[REAL] porta ${p.port}${p.nome ? ' · ' + p.nome : ''} em escuta em 0.0.0.0 (${p.proc})${p.risco ? ' — ' + p.risco : ''}`,
      score: p.risco ? grauDaPorta(p.risco)
           : [3389,445,23,21,5900,6379,27017,3306].includes(p.port) ? rnd(7.5,9.2) : rnd(3.2,5.8),
      where: 'MÁQUINA LOCAL',
    });
  }

  /* 6) POSTURA DE DEFESA, FRAQUEZAS E VIZINHANÇA DE REDE
     Antes isso era coletado e descartado: o backend media as defesas e a tela
     não dizia uma palavra. Uma varredura que não mostra o que encontrou é uma
     varredura que mente por omissão. */
  if (first) {
    const d = rep.sistema?.defesas;
    if (d) {
      Term.line('── POSTURA DE DEFESA DESTA MÁQUINA ──', 'info');
      const dfd = d.defender || {};
      if (dfd.erro) {
        Term.line(`  Defender: não consegui ler (${dfd.erro})`, 'dim', false);
      } else {
        const rt = dfd.tempoReal === true, av = dfd.antivirus === true;
        Term.line(`  Defender · proteção em tempo real: <b>${rt ? 'LIGADA' : 'DESLIGADA'}</b> · antivírus: <b>${av ? 'ativo' : 'inativo'}</b>`, (rt && av) ? 'ok' : 'warn', false);
        if (dfd.assinaturaDias != null) {
          Term.line(`  Assinaturas com ${dfd.assinaturaDias} dia(s)${dfd.ultimaVarredura ? ' · última varredura ' + dfd.ultimaVarredura : ''}`, dfd.assinaturaDias > 7 ? 'warn' : 'dim', false);
        }
      }
      const fw = Array.isArray(d.firewall) ? d.firewall : [];
      if (fw.length) {
        const off = fw.filter(f => !f.ligado);
        Term.line(`  Firewall · ${fw.map(f => `${f.perfil}:${f.ligado ? 'ON' : 'OFF'}`).join(' ')}`, off.length ? 'warn' : 'ok', false);
      }
      if (d.bitlocker) {
        const bl = d.bitlocker === 'requer-admin'
          ? '  Disco · criptografia não verificável sem privilégio de administrador'
          : `  Disco · BitLocker: <b>${d.bitlocker}</b>`;
        Term.line(bl, d.bitlocker === 'requer-admin' ? 'dim' : (/On|Ligado/i.test(d.bitlocker) ? 'ok' : 'warn'), false);
      }
    }

    // fraquezas viram achados no painel, não só linha de log que rola e some
    const fr = rep.sistema?.fraquezas || [];
    if (fr.length) {
      Term.line(`── ${fr.length} FRAQUEZA(S) DE CONFIGURAÇÃO ──`, 'warn');
      fr.forEach((f, i) => {
        const txt = typeof f === 'string' ? f : (f.texto || f.descricao || JSON.stringify(f));
        const grave = /desligad|inativ|sem senha|aberta|expirad|desativad/i.test(txt);
        Term.line(`  ${i + 1}. ${txt}`, grave ? 'warn' : 'dim', false);
        addCve({ id: `CONFIG-${String(i + 1).padStart(2, '0')}`, desc: `[REAL] ${txt}`, score: grave ? rnd(6.8, 8.4) : rnd(3.4, 5.6), where: 'CONFIGURAÇÃO LOCAL' });
      });
    } else if (rep.sistema) {
      Term.line('  Nenhuma fraqueza de configuração detectada — postura de defesa íntegra.', 'ok', false);
    }

    // vizinhança de rede: quem mais está na sua LAN
    const viz = rep.rede?.dispositivos;              // objeto { gateway, meuIp, total, dispositivos[] }
    const lista = viz?.dispositivos || [];
    if (lista.length) {
      Term.line(`── REDE LOCAL · ${viz.total} aparelho(s) · você é ${viz.meuIp} · roteador ${viz.gateway} ──`, 'info');
      lista.forEach(a => {
        const tag = a.ehGateway ? 'roteador' : (a.ehVoce ? 'esta máquina' : (a.fabricante || 'fabricante não identificado'));
        Term.line(`  ${String(a.ip).padEnd(16)} ${String(a.mac || '—').padEnd(19)} ${tag}`, a.ehGateway || a.ehVoce ? 'dim' : 'info', false);
      });
      const estranhos = lista.filter(a => !a.ehGateway && !a.ehVoce).length;
      if (estranhos) Term.line(`  ${estranhos} aparelho(s) além de você e do roteador. Se algum não for seu, é intruso na rede.`, 'dim', false);
    }
  }

  // 5) indícios de malware/ransomware locais
  for (const m of (rep.sistema?.malwareIndicios || [])) {
    const key = 'mw:' + m;
    if (S.realSeen.has(key)) continue;
    seen(key);
    spawnThreat({
      kind:'RANSOM', real:true, ip:'127.0.0.1', geo:{ city:'máquina local', cc:'LOCAL', country:'host do operador', lat:ASSETS[0].lat, lon:ASSETS[0].lon, asn:'sistema operacional' },
      tpl: { n:'INDÍCIO LOCAL DE MALWARE', sev:'CRÍTICA', d: () => m },
      actor:'HOST LOCAL',
    });
  }

  if (rep.nivel) {
    const map = { 'NORMAL':5, 'ATENÇÃO':4, 'ELEVADO':3, 'CRÍTICO':2 };
    const lv = map[rep.nivel] ?? 5;
    if (lv < S.defcon) setDefcon(lv);
  }

  // relatório explícito da primeira leitura — vazio é resultado válido, não falha
  if (first) {
    const nAtk = (rep.resumoAtaques?.ipsAtacantes || []).length;
    const nDdos = (rep.resumoAtaques?.ddos || []).length;
    const nPort = (rep.rede?.escutaExposta || []).length;
    const nMw = (rep.sistema?.malwareIndicios || []).length;
    const nFraq = (rep.sistema?.fraquezas || []).length;
    const nRisco = (rep.rede?.portasDeRisco || []).length;
    const nViz = (rep.rede?.dispositivos?.dispositivos || []).length;
    // "nada a relatar" só é honesto se realmente nada foi achado — fraqueza de
    // configuração conta, senão o resumo desmente o bloco logo acima dele
    if (!nAtk && !nDdos && !nPort && !nMw && !nFraq && !conns.length) {
      Term.line(`[REAL] varredura concluída — <b>nada a relatar</b>: nenhuma conexão externa, porta exposta, fraqueza de configuração, tentativa de ataque ou indício de malware. Nível informado pelo sistema: <b>${rep.nivel || 'NORMAL'}</b>.`, 'ok');
      toast('Telemetria real: perímetro local limpo', '#00ff9d');
    } else {
      Term.line(`[REAL] varredura concluída — ${nAtk} origem(ns) de ataque, ${nDdos} rajada(s), ${conns.length} destino(s) externo(s), ${nPort} porta(s) em escuta (${nRisco} de risco elevado), ${nFraq} fraqueza(s) de configuração, ${nMw} indício(s) de malware, ${nViz} aparelho(s) na rede local`, (nAtk || nMw || nFraq) ? 'warn' : 'info');
    }
  }
  return true;
}

/* ══════════════════ LOOP DE SIMULAÇÃO ══════════════════ */
let nextSpawn = 0;
function simTick(now) {
  if (S.paused) return;

  // ameaças
  if (now > nextSpawn) {
    // a pressão sobe durante um incidente, mas com teto — senão a grade nunca sai do DEFCON 1
    const pressure = clamp(1 + (5 - S.defcon) * .12, 1, 1.5);
    nextSpawn = now + rnd(2600, 7000) / pressure;
    if (!S.lockdown || Math.random() < .5) spawnThreat();
  }

  // tráfego
  const base = 3.2 + Math.sin(now / 9000) * 1.1;
  const boost = S.ddosBoost || 0;
  const ok = clamp(base + rnd(-.4, .4), .3, 40);
  const bad = clamp(boost * rnd(6, 22) + rnd(0, .5), 0, 400);
  const drop = S.lockdown ? bad : bad * rnd(.55, .96);
  S.traffic.push({ ok, bad, drop });
  if (S.traffic.length > 120) S.traffic.shift();
  if (S.ddosBoost) S.ddosBoost *= .985;
  S.pps = (ok + bad) * 118000;
  S.conns = Math.round(2400 + ok * 900 + bad * 260);
  S.dropPct = bad > .2 ? clamp(drop / (bad || 1) * 100, 0, 100) : 0;

  // entropia de arquivos
  const target = S.threats.some(t => t.status === 'ATIVO' && t.kind === 'RANSOM') ? rnd(7.2, 7.95) : rnd(3.5, 4.3);
  S.ent += (target - S.ent) * .06;
  S.writes += ((target > 6 ? rndi(1200, 5000) : rndi(8, 60)) - S.writes) * .08;
  S.entropy.push(S.ent);
  if (S.entropy.length > 90) S.entropy.shift();

  // janela de taxa
  const ms = Date.now();
  const cut = ms - 60000;
  while (S.rateWindow.length && S.rateWindow[0] < cut) S.rateWindow.shift();

  // resposta automatizada tardia (SOAR): o operador é mais rápido, mas a grade não fica presa
  for (const th of S.threats) {
    if (th.status === 'ATIVO' && th.autoFix && ms > th.autoFix) {
      neutralize(th, 'PLAYBOOK SOAR — contenção automatizada tardia');
      break;
    }
  }

  // avanço da CADEIA DE ATAQUE nas ameaças ativas (kill chain)
  for (const th of S.threats) {
    if (th.status !== 'ATIVO' || !th.chain) continue;
    if (th.chainIdx >= th.chain.length - 1) continue;
    if (ms <= th.nextStageAt) continue;
    th.chainIdx++;
    th.nextStageAt = ms + rndi(3600, 7200);
    const st = KC[KC_IDX[th.chain[th.chainIdx]]];
    Topo.runAttack(th);
    if (S.selected === th) { renderKillchain(th); renderCognition(th); }
    if (th.chain[th.chainIdx] === 'ACAO') {
      Term.line(`⛔ <b>${th.name}</b> alcançou AÇÃO NO OBJETIVO em ${th.target.id} — violação consumada. Origem ${th.ip} (${th.geo.cc}).`, 'crit');
      toast(`⛔ Violação: ${KINDS[th.kind].lab} concluiu o objetivo`, '#ff2a4a', 6500);
      Audio_.alarm(); flash(); glitch();
      const nd = pick(S.nodes.filter(n => n.kind === 'db' || n.kind === 'sto')); if (nd) Topo.compromise(nd.id, 'crit');
      if (th.kind === 'RANSOM') { S.ent = Math.min(7.95, S.ent + 1.5); S.writes += rndi(1500, 5000); }
      recomputeDefcon();
    } else {
      Term.line(`↳ cadeia de ataque de ${th.ip} avança → <b>${st.full}</b> [${KINDS[th.kind].lab}]`, 'warn');
    }
  }
  // remediação de nós: sem ameaça ativa, a equipe recupera um host de cada vez
  if (S.threats.filter(t => t.status === 'ATIVO').length <= 1 && ms - (S.lastHeal || 0) > 4000) {
    const hurt = S.nodes.find(n => n.state !== 'ok' && !n.iso);
    if (hurt) {
      S.lastHeal = ms;
      hurt.state = hurt.state === 'crit' ? 'warn' : 'ok';
      if (hurt.state === 'ok') Term.line(`<b>${hurt.lab}</b> reintegrado à produção após verificação de integridade`, 'ok');
      recomputeDefcon();
    }
  }

  // ruído no console — batimento de monitoramento
  if (Math.random() < .02) {
    Term.line(pick([
      `heartbeat de sensores OK · ${S.nodes.length} nós respondendo · latência média ${rndi(2,28)}ms`,
      `correlação de eventos: ${fmtN(rndi(9000, 480000))} registros processados na janela`,
      `atualização de assinaturas concluída · ${fmtN(rndi(200000, 1400000))} regras carregadas`,
      `verificação de integridade: ${fmtN(rndi(4000, 90000))} arquivos com hash validado`,
      `reputação de IP sincronizada · ${fmtN(rndi(1000, 60000))} prefixos em lista de bloqueio`,
      `sessões TLS inspecionadas: ${fmtN(rndi(300, 24000))} · ${rndi(0,4)} anomalia(s) de certificado`,
    ]), 'dim');
  }
}

/* ══════════════════ HUD ══════════════════ */
function fmtUptime() {
  const s = Math.floor((Date.now() - S.t0) / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
function updateHud() {
  $('uptime').textContent = fmtUptime();
  const d = new Date();
  $('clk').textContent = nowHMS(d);
  $('clkUtc').textContent = 'UTC ' + d.toISOString().slice(11, 19);

  $('mRate').textContent = S.rateWindow.length;
  $('mBlocked').textContent = S.blocked;
  const act = S.threats.filter(t => t.status === 'ATIVO').length;
  $('mActive').textContent = act;

  const last = S.traffic[S.traffic.length - 1];
  if (last) {
    $('bpsTag').textContent = (last.ok + last.bad).toFixed(1) + ' Gbps';
    $('bpsTag').style.color = last.bad > 5 ? '#ff2a4a' : '';
    $('ppsVal').textContent = fmtN(S.pps);
    $('connVal').textContent = fmtN(S.conns);
    $('dropVal').textContent = Math.round(S.dropPct) + '%';
  }
  $('entVal').textContent = S.ent.toFixed(2);
  $('wrVal').textContent = fmtN(S.writes);
  const ransomActive = S.ent > 6.2;
  $('fimTag').textContent = ransomActive ? 'CIFRAGEM EM MASSA' : 'NOMINAL';
  $('fimTag').style.color = ransomActive ? '#c04bff' : '';
  const note = $('fimNote');
  note.textContent = ransomActive
    ? `entropia acima do limiar em ${fmtN(S.writes)} escritas/s — padrão compatível com ransomware`
    : 'nenhuma criptografia em massa detectada';
  note.classList.toggle('bad', ransomActive);
}

/* ══════════════════ RENDER LOOP ══════════════════ */
let lastT = performance.now();
function frame(t) {
  const dt = clamp((t - lastT) / 16.67, 0, 3);
  lastT = t;

  Rain.draw();

  // o mapa de pontos custa caro para recalcular: reconstrói só quando o tamanho
  // estabiliza, senão um arrasto de janela dispara dezenas de rebuilds
  if (fitCanvas(WorldMap.cv)) { WorldMap.dirty = t + 160; WorldMap.base = null; }
  if (WorldMap.dirty && t > WorldMap.dirty) { WorldMap.dirty = 0; WorldMap.buildBase(); }
  fitCanvas(Radar.cv); fitCanvas(Topo.cv);
  const tcv = $('trafficCv'), ecv = $('entropyCv');
  fitCanvas(tcv); fitCanvas(ecv);

  WorldMap.draw(dt);
  Radar.draw(dt);
  Topo.draw(dt);

  drawSeries(tcv, [
    { data: S.traffic.map(x => x.ok),   color:'#00e5ff', fill:'rgba(0,229,255,0.16)', glow:true },
    { data: S.traffic.map(x => x.bad),  color:'#ff2a4a', glow:true, w:1.5 },
    { data: S.traffic.map(x => x.drop), color:'rgba(255,210,63,0.75)', w:1 },
  ], { threshold: 12 });

  drawSeries(ecv, [{ data: S.entropy, color: S.ent > 6.2 ? '#c04bff' : '#00ff9d', fill: S.ent > 6.2 ? 'rgba(192,75,255,0.2)' : 'rgba(0,255,157,0.14)', glow:true }], { max: 8, threshold: 6.2 });

  simTick(t);
  updateHud();
  requestAnimationFrame(frame);
}

/* ══════════════════ CONTROLES DA TOPBAR ══════════════════ */
function closeConsole() {
  Term.line('encerrando console de defesa…', 'warn');
  setTimeout(() => {
    if (window.opener && !window.opener.closed) { window.close(); return; }
    if (window.parent !== window) { try { window.parent.postMessage({ elx:'cyber-close' }, '*'); } catch {} }
    window.location.href = '/';
  }, 400);
}
function wireTop() {
  $('modeBtn').onclick = () => setRealMode(!S.real);
  $('audioBtn').onclick = () => {
    S.audio = !S.audio;
    Audio_.init();
    if (S.audio && Audio_.ctx?.state === 'suspended') Audio_.ctx.resume();
    $('audioTxt').textContent = S.audio ? 'ON' : 'OFF';
    $('audioBtn').classList.toggle('act', S.audio);
    if (S.audio) Audio_.ok();
    Term.line(`som tático ${S.audio ? 'ativado' : 'desativado'}`, 'dim');
  };
  $('pauseBtn').onclick = () => {
    S.paused = !S.paused;
    $('pauseBtn').innerHTML = S.paused ? '▶ RETOMAR' : '⏸ CONGELAR';
    $('pauseBtn').classList.toggle('act', S.paused);
    Term.line(S.paused ? 'grade congelada — detecção pausada' : 'grade retomada — monitoramento contínuo', S.paused ? 'warn' : 'ok');
  };
  $('closeBtn').onclick = closeConsole;
  $('feedClear').onclick = () => { $('feed').innerHTML = ''; Term.line('fluxo de ameaças limpo (registro preservado)', 'dim'); };
  document.querySelectorAll('.cm').forEach(b => b.onclick = () => CM.run(b.dataset.a, b));

  const cmd = $('cmd'), wrap = cmd.closest('.term-in');
  cmd.addEventListener('input', () => wrap.classList.toggle('typing', !!cmd.value));
  cmd.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const v = cmd.value; cmd.value = ''; wrap.classList.remove('typing');
      runCommand(v);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (S.histIdx < S.history.length - 1) { S.histIdx++; cmd.value = S.history[S.histIdx]; wrap.classList.add('typing'); }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (S.histIdx > 0) { S.histIdx--; cmd.value = S.history[S.histIdx]; }
      else { S.histIdx = -1; cmd.value = ''; wrap.classList.remove('typing'); }
    } else if (e.key.length === 1) Audio_.key();
  });
  document.addEventListener('keydown', e => {
    if (e.target === cmd) return;
    if (e.key === '/' || (e.key.length === 1 && /[a-z0-9]/i.test(e.key))) { cmd.focus(); }
    if (e.key === 'Escape') closeConsole();
  });
  window.addEventListener('beforeunload', () => clearInterval(S.realTimer));
}

/* ══════════════════ POST / BOOT ══════════════════ */
const POST_LINES = [
  ['ELION-X SECURE BIOS v4.02 — inicializando controlador de defesa', 0],
  ['CPU: núcleo tático 16 threads .......... <b>OK</b>', 0],
  ['MEM: 65536 MB ECC ...................... <b>OK</b>', 0],
  ['Carregando kernel de contrainteligência ... <b>OK</b>', 0],
  ['Montando /grade/sensores ............... <b>OK</b>', 0],
  ['Sensor DDoS ............................ <b>ARMADO</b>', 0],
  ['Sensor de invasão de banco de dados .... <b>ARMADO</b>', 0],
  ['Sensor de ransomware (entropia/FIM) .... <b>ARMADO</b>', 0],
  ['Scanner de vulnerabilidades ............ <b>ARMADO</b>', 0],
  ['Base de assinaturas: <i>1.482.903</i> regras ... <b>OK</b>', 0],
  ['Malha de geolocalização de origem ...... <b>OK</b>', 0],
  ['Sincronizando reputação de IP .......... <b>OK</b>', 0],
  ['Enlace com 6 ativos defendidos ......... <b>ESTABELECIDO</b>', 0],
  ['Autoteste de contramedidas ............. <b>OK</b>', 0],
  ['<i>AVISO: cenário tático — nenhum sistema de terceiros é acessado</i>', 0],
  ['Grade de defesa <b>ONLINE</b> — aguardando o operador', 0],
];
async function runPost() {
  const log = $('postLog'), fill = $('postFill'), go = $('postGo');
  for (let i = 0; i < POST_LINES.length; i++) {
    const [txt] = POST_LINES[i];
    const n = el('div', '', txt);
    log.appendChild(n);
    log.scrollTop = log.scrollHeight;
    fill.style.width = ((i + 1) / POST_LINES.length * 100) + '%';
    Audio_.blip();
    await sleep(i < 3 ? 210 : rndi(90, 230));
  }
  go.classList.add('on'); go.disabled = false;
  go.focus();
}
function enterConsole() {
  $('post').classList.add('off');
  setTimeout(() => { $('post').style.display = 'none'; }, 900);
  S.running = true; S.t0 = Date.now();
  Term.line('console assumido pelo operador — <b>monitoramento contínuo ativo</b>', 'ok');
  Term.line('digite <b>ajuda</b> · <b>varredura</b> inspeciona o perímetro · <b>analisar</b> aciona o núcleo cognitivo · <b>real</b> lê a sua máquina', 'info');
  Term.line('NÚCLEO COGNITIVO ativo — clique numa ameaça no fluxo e o ELION reconstrói a cadeia de ataque, mapeia a técnica MITRE, prevê o próximo passo e recomenda a defesa. Digite <b>doutrina</b> para ver como ele responde a um atacante (legalmente).', 'info');
  Term.line('fonte atual: <b>SIMULAÇÃO TÁTICA</b> — todo evento marcado SIM é cenário gerado, não um incidente real.', 'dim');
  $('cmd').focus();
  // primeira onda
  setTimeout(() => spawnThreat({ kind:'RECON' }), 900);
  setTimeout(() => spawnThreat({ kind:'DDOS' }), 2600);
  setTimeout(() => { for (let i = 0; i < 3; i++) addCve(synthCve()); }, 1500);
}

/* ══════════════════ INIT ══════════════════ */
function init() {
  $('nodeId').textContent = 'ELX-' + hex(16) + hex(16) + hex(16);
  $('sessId').textContent = (hex(65536) + hex(65536)).padStart(8, '0');
  buildSensors();
  renderCves();
  Rain.init();
  WorldMap.init(); Radar.init(); Topo.init();
  wireTop();

  for (let i = 0; i < 120; i++) S.traffic.push({ ok: 3 + Math.sin(i / 9) * .8 + Math.random() * .4, bad: 0, drop: 0 });
  for (let i = 0; i < 90; i++) S.entropy.push(3.9 + Math.random() * .3);

  requestAnimationFrame(frame);
  runPost();
  $('postGo').onclick = enterConsole;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
