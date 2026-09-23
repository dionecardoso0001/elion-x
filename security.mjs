/**
 * ELION-X · Módulo CYBER SECURITY (defensivo, somente leitura)
 * Analisa a rede e o sistema do PRÓPRIO operador para detectar sinais de
 * comprometimento — SEM jamais atacar terceiros:
 *   · conexões TCP estabelecidas + portas em escuta (Get-NetTCPConnection)
 *   · processos suspeitos e uso de recursos
 *   · heurística de ransomware/malware (nomes e locais conhecidos)
 *   · assinaturas de ATAQUE contra a plataforma (SQLi/XSS/traversal/scan/DDoS)
 *     a partir do log de requisições do servidor
 *   · GEOLOCALIZA a origem dos IPs externos/atacantes (ip-api.com)
 * Tudo é read-only: nada é bloqueado, morto ou alterado. O ELION só RELATA.
 */
import { execFile } from 'child_process';

const isWin = process.platform === 'win32';

/* executa PowerShell read-only com timeout; devolve stdout (ou '' em falha) */
function ps(script, timeout = 12000) {
  return new Promise(resolve => {
    if (!isWin) return resolve('');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(stdout || ''));
  });
}
const parseJson = (s, fb) => { try { const v = JSON.parse(s); return v == null ? fb : v; } catch { return fb; } };
const arr = v => Array.isArray(v) ? v : (v ? [v] : []);

const isPrivate = ip => !ip || /^(10\.|127\.|0\.|169\.254\.|192\.168\.|::1|fe80|::$)/.test(ip) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip === '::' || ip === '0.0.0.0';

/* ── ASSINATURAS DE ATAQUE (compartilhada com o hot-path do servidor) ── */
export const ATTACK_SIGNATURES = [
  { tipo: 'SQL Injection', re: /(union\s+select|\bor\b\s+1\s*=\s*1|'\s*or\s*'|;\s*drop\s+table|information_schema|sleep\s*\(|benchmark\s*\(|pg_sleep|xp_cmdshell|waitfor\s+delay|\bselect\b.+\bfrom\b.+\bwhere\b|--\s|%27)/i },
  { tipo: 'Path Traversal', re: /(\.\.[\/\\]|%2e%2e|\/etc\/passwd|\/etc\/shadow|boot\.ini|win\.ini|\/proc\/self)/i },
  { tipo: 'XSS', re: /(<script|onerror\s*=|onload\s*=|javascript:|%3cscript|<img[^>]+src\s*=|document\.cookie)/i },
  { tipo: 'Command Injection', re: /(;\s*(cat|wget|curl|nc|bash|sh|powershell|cmd)\b|\|\s*(cat|nc|sh|bash)\b|\$\(.*\)|`.*`|&&\s*(cat|whoami|id)\b)/i },
  { tipo: 'Sondagem/Scanner', re: /(\/\.env|\/\.git|\/wp-admin|\/wp-login|phpmyadmin|\/admin\.php|xmlrpc\.php|\/\.aws|\/\.ssh|actuator\/|\/config\.|\/backup|\/shell)/i },
  { tipo: 'Log4Shell/RCE', re: /(\$\{jndi:|\{\{.*\}\}|__proto__|constructor\[|process\.env)/i },
];
export function sigScan(text, ua = '') {
  const hits = [];
  const hay = String(text || '');
  for (const s of ATTACK_SIGNATURES) if (s.re.test(hay)) hits.push(s.tipo);
  if (/sqlmap|nikto|nmap|masscan|acunetix|nessus|dirbuster|gobuster|hydra|wpscan|zgrab/i.test(ua)) hits.push('Ferramenta de ataque (User-Agent)');
  return hits;
}

/* geolocaliza vários IPs de uma vez (ip-api batch, gratuito) */
async function geolocate(ips) {
  const publicos = [...new Set(ips.filter(ip => ip && !isPrivate(ip)))].slice(0, 30);
  if (!publicos.length) return {};
  try {
    const body = publicos.map(q => ({ query: q, fields: 'status,country,city,isp,org,lat,lon,query' }));
    const r = await fetch('http://ip-api.com/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(9000),
    }).then(x => x.json());
    const map = {};
    for (const e of arr(r)) if (e.status === 'success') map[e.query] = { pais: e.country, cidade: e.city, isp: e.org || e.isp, lat: e.lat, lon: e.lon };
    return map;
  } catch { return {}; }
}

/* ── conexões TCP + processos (Windows) ── */
async function netAndProcs() {
  const out = await ps(`
    $ErrorActionPreference='SilentlyContinue'
    $conns = Get-NetTCPConnection -State Established |
      Select-Object RemoteAddress,RemotePort,OwningProcess,LocalPort
    $listen = Get-NetTCPConnection -State Listen |
      Select-Object LocalAddress,LocalPort,OwningProcess
    $procs = @{}
    Get-Process | ForEach-Object { $procs[$_.Id] = $_.ProcessName }
    $result = [ordered]@{
      established = @($conns | ForEach-Object { [ordered]@{ ip=$_.RemoteAddress; port=$_.RemotePort; lport=$_.LocalPort; pid=$_.OwningProcess; proc=$procs[[int]$_.OwningProcess] } })
      listening   = @($listen | ForEach-Object { [ordered]@{ addr=$_.LocalAddress; port=$_.LocalPort; pid=$_.OwningProcess; proc=$procs[[int]$_.OwningProcess] } })
    }
    $result | ConvertTo-Json -Depth 4 -Compress
  `, 14000);
  return parseJson(out, { established: [], listening: [] });
}

async function topProcesses() {
  const out = await ps(`
    $ErrorActionPreference='SilentlyContinue'
    Get-Process | Sort-Object CPU -Descending | Select-Object -First 8 |
      ForEach-Object { [ordered]@{ nome=$_.ProcessName; cpu=[math]::Round($_.CPU,1); ramMB=[math]::Round($_.WorkingSet64/1MB) } } |
      ConvertTo-Json -Compress
  `, 8000);
  return arr(parseJson(out, []));
}

/* heurística LEVE de malware/ransomware — nomes/processos suspeitos + notas de resgate no perfil.
   NÃO é antivírus: sinaliza indícios para o operador investigar. */
const SUSPECT_PROC = /(mimikatz|psexec|cobalt|meterpreter|ngrok|nc\.exe|netcat|cryptolocker|wannacry|locky|cryptowall|xmrig|coinminer|kryptik|rundll32.*temp|powershell.*-enc|certutil.*-urlcache)/i;
async function malwareHeuristic(procs) {
  // sinal FORTE: processo de ferramenta de ataque em execução. Só isto é grave
  // por si só — daí a marca `forte`, que o scan usa para decidir CRÍTICO.
  const forte = [];
  for (const p of procs) if (SUSPECT_PROC.test(p.proc || p.nome || '')) forte.push(`Processo suspeito em execução: ${p.proc || p.nome} (PID ${p.pid || '?'})`);

  // sinal FRACO: arquivo com CARA de nota de resgate. Um nome não prova infecção
  // — "000_README.txt" é readme de projeto, não ransomware. Por isso o padrão é
  // estrito (exige "decrypt/recover/restore/how-to" ou o nome exato _readme.txt
  // do STOP/Djvu) e o achado vira ALERTA PARA CONFERIR, nunca CRÍTICO sozinho.
  const fraco = [];
  const ransom = await ps(`
    $ErrorActionPreference='SilentlyContinue'
    $paths = @("$env:USERPROFILE\\Desktop","$env:USERPROFILE\\Documents")
    $re = '(^_readme\\.txt$|decrypt|recover.?files|restore.?files|how.?to.?(decrypt|restore)|\\.ransom$|readme.?to.?decrypt|_openme|!want.?to.?recover)'
    $hits = foreach($d in $paths){ Get-ChildItem -Path $d -File -Recurse -Depth 1 -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match $re } | Select-Object -First 5 -ExpandProperty Name }
    ($hits | Select-Object -Unique) -join "|"
  `, 8000);
  if (ransom.trim()) fraco.push('Arquivo com nome de nota de resgate (CONFERIR, pode ser falso alarme): ' + ransom.trim().replace(/\|/g, ', '));
  return { forte, fraco, todos: [...forte, ...fraco] };
}

/* ── POSTURA DE DEFESA DO PC ─────────────────────────────────────────────────
   Não basta procurar o inimigo dentro de casa; é preciso saber se as portas
   estão trancadas. Aqui checo as travas que o Windows já oferece e que o
   operador pode ter deixado abertas: antivírus, firewall, criptografia de disco.
   Tudo read-only. O servidor não roda como administrador, então o que exigir
   privilégio é relatado como "requer administrador" em vez de falhar calado. */
async function posturaDefesa() {
  const out = await ps(`
    $ErrorActionPreference='SilentlyContinue'
    $r = [ordered]@{}
    $d = Get-MpComputerStatus
    if ($d) { $r.defender = [ordered]@{
      tempoReal = [bool]$d.RealTimeProtectionEnabled
      antivirus = [bool]$d.AntivirusEnabled
      assinaturaDias = if($d.AntivirusSignatureLastUpdated){ [int](New-TimeSpan -Start $d.AntivirusSignatureLastUpdated -End (Get-Date)).TotalDays } else { $null }
      ultimaVarredura = if($d.QuickScanEndTime){ $d.QuickScanEndTime.ToString('yyyy-MM-dd') } else { $null }
    } }
    $fw = Get-NetFirewallProfile | ForEach-Object { [ordered]@{ perfil=$_.Name; ligado=[bool]$_.Enabled } }
    if ($fw) { $r.firewall = @($fw) }
    $bl = Get-BitLockerVolume -MountPoint C: 2>$null
    if ($bl) { $r.bitlocker = "$($bl.ProtectionStatus)" } else { $r.bitlocker = 'requer-admin' }
    $r | ConvertTo-Json -Depth 4 -Compress
  `, 15000);
  return parseJson(out, {});
}

/* rótulos de risco para portas comuns abertas ao mundo — traduz "porta 3389"
   em "área de trabalho remota, alvo nº 1 de ransomware" */
const RISCO_PORTA = {
  3389: { nome: 'RDP (área de trabalho remota)', risco: 'ALTO — alvo primário de ransomware; nunca deixe exposto à internet' },
  445:  { nome: 'SMB (compartilhamento Windows)', risco: 'ALTO — foi o vetor do WannaCry; jamais exponha ao mundo' },
  135:  { nome: 'RPC do Windows', risco: 'MÉDIO — superfície de exploração remota' },
  139:  { nome: 'NetBIOS', risco: 'MÉDIO — protocolo antigo, evite expor' },
  23:   { nome: 'Telnet', risco: 'ALTO — sem criptografia, credencial em claro' },
  21:   { nome: 'FTP', risco: 'MÉDIO — sem criptografia por padrão' },
  5900: { nome: 'VNC', risco: 'ALTO — acesso remoto à tela, alvo comum' },
};

/* ── DESCOBERTA DE REDE ──────────────────────────────────────────────────────
   "Defender minha rede" começa por saber QUEM está nela. A tabela ARP do
   Windows esfria quando a rede está quieta, então aqueço com um ping-sweep
   paralelo do /24 e só então leio os vizinhos com MAC. É passivo do ponto de
   vista de ataque — um ping não é intrusão — e mostra ao operador cada aparelho
   conectado, para ele reconhecer o que é dele e estranhar o que não é. */
const OUI = {
  '00-1A-11': 'Google', '3C-5A-B4': 'Google', 'DA-A1-19': 'Google',
  'B8-27-EB': 'Raspberry Pi', 'DC-A6-32': 'Raspberry Pi',
  '00-17-88': 'Philips Hue', 'EC-FA-BC': 'Espressif (IoT)', '24-0A-C4': 'Espressif (IoT)',
  '00-1D-D8': 'Microsoft', '00-15-5D': 'Microsoft Hyper-V',
  '00-50-56': 'VMware', '08-00-27': 'VirtualBox',
  'F0-9F-C2': 'Ubiquiti', '00-11-32': 'Synology', '00-24-9B': 'Roku',
  'AC-DE-48': 'Apple', 'F0-18-98': 'Apple', 'A4-83-E7': 'Apple',
};
function fabricante(mac) {
  const p = (mac || '').toUpperCase().slice(0, 8);
  return OUI[p] || null;
}

async function descobrirRede() {
  // 1) qual é a minha sub-rede e meu gateway?
  const info = parseJson(await ps(`
    $ErrorActionPreference='SilentlyContinue'
    $gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop
    $meu = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
    [ordered]@{ gateway=$gw; meuIp=$meu } | ConvertTo-Json -Compress
  `, 8000), {});
  if (!info.meuIp) return { erro: 'não identifiquei a rede local', dispositivos: [] };
  const base = info.meuIp.replace(/\.\d+$/, '.');

  // 2) ping-sweep paralelo para aquecer a tabela ARP, depois lê os vizinhos
  const out = await ps(`
    $ErrorActionPreference='SilentlyContinue'
    $base='${base}'
    # DUAS PASSADAS, não uma. Medido: com uma passada de 300 ms a varredura
    # achava ora 1, ora 3, ora 4 aparelhos na mesma rede. A causa é economia de
    # energia — celular e tablet no Wi-Fi demoram a responder ao primeiro ICMP,
    # e sem resposta não se forma entrada ARP. A segunda passada pega quem
    # acordou na primeira. Varredura que muda de resposta a cada execução não
    # serve para dizer "apareceu um aparelho estranho na sua rede".
    foreach ($passada in 1..2) {
      $tasks = 1..254 | ForEach-Object { (New-Object System.Net.NetworkInformation.Ping).SendPingAsync("$base$_", 800) }
      [System.Threading.Tasks.Task]::WaitAll($tasks) | Out-Null
      Start-Sleep -Milliseconds 600
    }
    Start-Sleep -Milliseconds 600          # deixa a tabela ARP assentar antes de ler
    # ⚠ FILTRE PELO MAC, NÃO PELO ESTADO — foi aqui que a varredura mentia.
    # Eu aceitava só Reachable/Stale/Permanent. Mas o Windows mantém aparelhos
    # VIVOS também em 'Probe' e 'Delay', com MAC válido, e a entrada troca de
    # estado a cada segundo. Resultado: a mesma rede devolvia ora 1, ora 3, ora
    # 4 aparelhos, conforme o milissegundo da leitura. Quem tem MAC de verdade
    # existe; 'Incomplete' (00-00-...) é o endereço que não respondeu.
    $viz = Get-NetNeighbor -AddressFamily IPv4 | Where-Object {
      $_.IPAddress -like "$base*" -and $_.LinkLayerAddress -and
      $_.LinkLayerAddress -notin @('FF-FF-FF-FF-FF-FF','00-00-00-00-00-00') -and
      $_.State -ne 'Incomplete'
    } | ForEach-Object { [ordered]@{ ip=$_.IPAddress; mac=$_.LinkLayerAddress; estado="$($_.State)" } }
    @($viz) | ConvertTo-Json -Depth 3 -Compress
  `, 40000);
  const ipNum = ip => ip.split('.').reduce((s, n) => s * 256 + (+n || 0), 0);   // ordena por IP de verdade
  const vizinhos = arr(parseJson(out, []))
    .filter(v => !/\.255$/.test(v.ip))                    // tira o endereço de broadcast
    .map(v => ({ ...v, fabricante: fabricante(v.mac), ehGateway: v.ip === info.gateway }))
    .sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
  return { gateway: info.gateway, meuIp: info.meuIp, total: vizinhos.length, dispositivos: vizinhos };
}

/**
 * Executa a varredura defensiva completa.
 * @param {object} o
 * @param {Array}  o.events  log de requisições do servidor (do ring buffer)
 * @param {number} o.port    porta do próprio servidor (ignora conexões locais a ela)
 * @param {string} o.focus   foco opcional ('rede'|'ataques'|'malware'|'geral')
 */
export async function scan({ events = [], port = 0, focus = 'geral' } = {}) {
  const agora = Date.now();
  const janela = events.filter(e => agora - e.t < 15 * 60000); // últimos 15 min

  // 1) ATAQUES contra a plataforma (do log) — agrupa por tipo e por IP de origem
  const ataques = janela.filter(e => e.threats && e.threats.length);
  const porTipo = {}; const ipCount = {}; const atacantes = new Set();
  for (const e of ataques) {
    for (const t of e.threats) porTipo[t] = (porTipo[t] || 0) + 1;
    atacantes.add(e.ip);
  }
  // 2) DDoS — rajada de requisições do mesmo IP no último minuto
  const ultMin = events.filter(e => agora - e.t < 60000);
  for (const e of ultMin) ipCount[e.ip] = (ipCount[e.ip] || 0) + 1;
  const ddos = Object.entries(ipCount).filter(([ip, n]) => n >= 120 && !isPrivate(ip))
    .map(([ip, n]) => ({ ip, rpm: n }));
  ddos.forEach(d => atacantes.add(d.ip));

  // 3) sistema local (Windows) — melhor esforço em paralelo.
  //    A descoberta de rede e a postura de defesa entram aqui; a rede é a mais
  //    lenta (ping-sweep), então roda junto com o resto para não somar tempo.
  const querRede = focus === 'geral' || focus === 'rede';
  const [net, procs, defesas] = await Promise.all([netAndProcs(), topProcesses(), posturaDefesa()]);
  /* ⚠ A DESCOBERTA DE REDE RODA SOZINHA, NÃO EM PARALELO — e isto é medido,
     não estético. Com quatro PowerShells disputando a CPU ao mesmo tempo, os
     pings de 300 ms do sweep expiravam antes das respostas chegarem: a
     varredura achava só o roteador (1 aparelho) quando havia 4. Isolada, acha
     os 4 de forma consistente. Custa ~3 s a mais num exame que já leva 15 —
     e uma rede escaneada errado é pior que uma rede não escaneada. */
  const redeLocal = querRede ? await descobrirRede() : null;
  const mw = await malwareHeuristic([...(net.established || []), ...procs]);
  const malware = mw.todos;                 // mantém a chave antiga que o frontend lê

  // conexões externas (fora da rede local) — candidatas a exfiltração/C2
  const externas = (net.established || []).filter(c => !isPrivate(c.ip));
  const ipsExternos = externas.map(c => c.ip);

  // 4) GEOLOCALIZAÇÃO da origem — atacantes (do log) + conexões externas ativas
  const geo = await geolocate([...atacantes, ...ipsExternos]);

  // agrega conexões externas por IP (com processo dono)
  const extAgg = {};
  for (const c of externas) {
    const k = c.ip;
    if (!extAgg[k]) extAgg[k] = { ip: k, conexoes: 0, portas: new Set(), procs: new Set(), geo: geo[k] || null };
    extAgg[k].conexoes++; extAgg[k].portas.add(c.port); if (c.proc) extAgg[k].procs.add(c.proc);
  }
  const conexoesExternas = Object.values(extAgg).map(e => ({
    ip: e.ip, conexoes: e.conexoes, portas: [...e.portas].slice(0, 6), processos: [...e.procs].slice(0, 4), geo: e.geo,
  })).sort((a, b) => b.conexoes - a.conexoes).slice(0, 20);

  // portas em escuta abertas ao mundo (0.0.0.0 / ::) — superfície de ataque.
  // Agora cada uma vem ROTULADA: a porta 3389 deixa de ser um número e passa a
  // dizer "RDP, alvo primário de ransomware".
  const escutaExposta = (net.listening || [])
    .filter(l => l.addr === '0.0.0.0' || l.addr === '::')
    .map(l => ({ port: l.port, proc: l.proc || '?', ...(RISCO_PORTA[l.port] || {}) }))
    .filter((v, i, a) => a.findIndex(x => x.port === v.port) === i)
    .sort((a, b) => a.port - b.port).slice(0, 30);
  const portasDeRisco = escutaExposta.filter(p => p.risco);

  // fraquezas de postura: travas do Windows que estão desligadas
  const fraquezas = [];
  if (defesas.defender) {
    if (!defesas.defender.tempoReal) fraquezas.push('Proteção em tempo real do Defender DESLIGADA');
    if (defesas.defender.assinaturaDias != null && defesas.defender.assinaturaDias > 3)
      fraquezas.push(`Assinaturas do antivírus com ${defesas.defender.assinaturaDias} dias de atraso`);
  } else fraquezas.push('Não consegui confirmar o antivírus');
  for (const f of (defesas.firewall || [])) if (!f.ligado) fraquezas.push(`Firewall DESLIGADO no perfil ${f.perfil}`);

  // nível geral de ameaça. Só o sinal FORTE de malware (processo de ataque
  // rodando) força CRÍTICO; um nome de arquivo suspeito pesa, mas não sozinho.
  let nivel = 'NORMAL', score = 0;
  score += Object.values(porTipo).reduce((s, n) => s + n, 0);
  score += ddos.length * 5 + mw.forte.length * 8 + mw.fraco.length * 2;
  score += portasDeRisco.length * 3 + fraquezas.length * 4;
  if (score >= 20 || mw.forte.length) nivel = 'CRÍTICO';
  else if (score >= 6 || ddos.length || fraquezas.length) nivel = 'ELEVADO';
  else if (score >= 1) nivel = 'ATENÇÃO';

  return {
    at: new Date().toISOString(), nivel, score, focus,
    resumoAtaques: {
      totalTentativas: ataques.length,
      porTipo,                                  // { 'SQL Injection': 3, ... }
      ipsAtacantes: [...atacantes].filter(ip => !isPrivate(ip)).map(ip => ({ ip, geo: geo[ip] || null,
        tipos: [...new Set(janela.filter(e => e.ip === ip).flatMap(e => e.threats || []))],
        exemplos: janela.filter(e => e.ip === ip && e.threats?.length).slice(-3).map(e => `${e.method} ${e.path}`) })),
      ddos,
    },
    rede: {
      conexoesExternas,               // com geolocalização (país/cidade/ISP)
      totalEstabelecidas: (net.established || []).length,
      escutaExposta,                  // portas abertas ao mundo, agora rotuladas
      portasDeRisco,                  // só as que têm risco conhecido (RDP, SMB…)
      dispositivos: redeLocal,        // NOVO: quem está na rede local (IP/MAC/fabricante)
    },
    sistema: {
      malwareIndicios: malware,
      topProcessos: procs,
      defesas,                        // NOVO: Defender, Firewall, BitLocker
      fraquezas,                      // NOVO: travas do Windows desligadas
    },
  };
}
