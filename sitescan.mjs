/**
 * ELION-X · AUDITORIA DE SEGURANÇA DE SITES (defensiva, não invasiva)
 *
 * Faz o que ferramentas públicas como securityheaders.com e SSL Labs fazem:
 * um retrato da SUPERFÍCIE de um site — cabeçalhos, TLS, cookies, tecnologia
 * exposta — para o operador (ou o cliente dele, em avaliação autorizada)
 * saber onde está frágil. É trabalho de BLUE TEAM.
 *
 * ⚠ FRONTEIRAS QUE ESTE MÓDULO NÃO CRUZA — por desenho, não por descuido:
 *  · SÓ requisições GET, só ao alvo. Nenhum POST, nenhum payload, nenhuma
 *    tentativa de injeção. Não explora nada — apenas OBSERVA o que o servidor
 *    já entrega a qualquer visitante.
 *  · NUNCA um endereço interno. O host é resolvido em DNS e, se cair em IP
 *    privado/loopback/link-local, a auditoria é RECUSADA. Isto impede que um
 *    pedido em voz ("audita o site X") seja desviado para a rede de casa, o
 *    roteador, ou o endpoint de metadados de nuvem — o buraco clássico de SSRF.
 *  · Os "caminhos sensíveis" são só CONFERIDOS (o arquivo responde 200?), nunca
 *    baixados nem interpretados além do indício. Saber que /.git/ está exposto
 *    é defesa; puxar o repositório seria outra coisa.
 *
 * Tudo em Node puro (tls, dns, net) — sem dependência externa.
 */
import tls from 'tls';
import net from 'net';
import dns from 'dns/promises';

const UA = 'ELION-X/1.0 (auditoria de seguranca defensiva; blue-team)';

/* Mesma lógica de SSRF do resto da plataforma: o texto do host não basta,
   porque um domínio público pode resolver para IP interno. Confere o IP real. */
const ipPrivado = ip => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 ||
           (a === 172 && b >= 16 && b <= 31) ||
           (a === 192 && b === 168) ||
           (a === 169 && b === 254) ||
           (a === 100 && b >= 64 && b <= 127);
  }
  const s = ip.toLowerCase();
  return s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s === '::';
};

async function garantirPublico(host) {
  let ips;
  try { ips = (await dns.lookup(host, { all: true })).map(r => r.address); }
  catch (e) { throw new Error(`não consegui resolver "${host}": ${e.message}`); }
  const interno = ips.find(ipPrivado);
  if (interno) throw new Error(`"${host}" aponta para um endereço interno (${interno}) — auditoria recusada por segurança`);
  return ips;
}

/* ── 1. CABEÇALHOS DE SEGURANÇA ────────────────────────────────────────────
   Cada cabeçalho ausente é uma porta que o navegador deixaria aberta. O peso
   reflete o dano real: clickjacking e política de conteúdo pesam mais que a
   política de referenciador. */
const CABECALHOS = [
  { chave: 'strict-transport-security', nome: 'HSTS', peso: 3,
    porque: 'sem ele, o primeiro acesso pode ser sequestrado para HTTP e interceptado' },
  { chave: 'content-security-policy', nome: 'CSP', peso: 3,
    porque: 'é a principal defesa contra XSS — sem CSP, um script injetado roda livre' },
  { chave: 'x-frame-options', nome: 'X-Frame-Options', peso: 2,
    porque: 'sem ele o site pode ser embutido num iframe invisível e sofrer clickjacking' },
  { chave: 'x-content-type-options', nome: 'X-Content-Type-Options', peso: 1,
    porque: 'sem "nosniff", o navegador pode interpretar um upload como script' },
  { chave: 'referrer-policy', nome: 'Referrer-Policy', peso: 1,
    porque: 'sem ele, URLs internas vazam no cabeçalho Referer para terceiros' },
  { chave: 'permissions-policy', nome: 'Permissions-Policy', peso: 1,
    porque: 'sem ele, câmera/microfone/geolocalização ficam sem trava explícita' },
];

function auditarCabecalhos(headers) {
  const presentes = [], ausentes = [];
  for (const c of CABECALHOS) {
    const v = headers.get(c.chave);
    if (v) presentes.push({ nome: c.nome, valor: v.slice(0, 80) });
    else ausentes.push({ nome: c.nome, peso: c.peso, porque: c.porque });
  }
  return { presentes, ausentes, pesoFaltante: ausentes.reduce((s, a) => s + a.peso, 0) };
}

/* ── 2. TECNOLOGIA REVELADA ─────────────────────────────────────────────────
   Um servidor que anuncia "Apache/2.4.29" está dizendo ao atacante qual lista
   de CVEs consultar. Revelar versão é fraqueza de configuração. */
function impressaoTecnica(headers) {
  const achados = [];
  for (const h of ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator', 'via']) {
    const v = headers.get(h);
    if (!v) continue;
    const temVersao = /\d+\.\d+/.test(v);
    achados.push({ cabecalho: h, valor: v.slice(0, 60), revelaVersao: temVersao });
  }
  return achados;
}

/* ── 3. COOKIES ─────────────────────────────────────────────────────────────
   Cookie sem Secure viaja em claro; sem HttpOnly, um XSS o rouba; sem SameSite,
   fica exposto a CSRF. */
function auditarCookies(headers) {
  const bruto = headers.get('set-cookie');
  if (!bruto) return { definidos: 0, problemas: [] };
  const cookies = bruto.split(/,(?=[^;]+=)/);
  const problemas = [];
  for (const ck of cookies) {
    const nome = ck.split('=')[0].trim();
    const faltas = [];
    if (!/;\s*secure/i.test(ck)) faltas.push('Secure');
    if (!/;\s*httponly/i.test(ck)) faltas.push('HttpOnly');
    if (!/;\s*samesite/i.test(ck)) faltas.push('SameSite');
    if (faltas.length) problemas.push({ cookie: nome.slice(0, 30), faltando: faltas });
  }
  return { definidos: cookies.length, problemas };
}

/* ── 4. CERTIFICADO TLS ─────────────────────────────────────────────────────
   Protocolo velho (TLS 1.0/1.1) é quebrável; certificado vencendo é queda de
   serviço marcada na agenda. */
function auditarTLS(host, port = 443) {
  return new Promise(resolve => {
    const s = tls.connect({ host, port, servername: host, timeout: 12000, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate();
      const proto = s.getProtocol();
      const autorizado = s.authorized;
      const erroCadeia = s.authorizationError ? String(s.authorizationError) : null;
      let diasParaVencer = null;
      if (c && c.valid_to) diasParaVencer = Math.round((new Date(c.valid_to) - Date.now()) / 86400000);
      s.end();
      resolve({
        protocolo: proto,
        protocoloFraco: /TLSv1(\.0|\.1)?$/.test(proto || ''),
        emissor: c && c.issuer ? (c.issuer.O || c.issuer.CN || '?') : '?',
        validoAte: c ? c.valid_to : null,
        diasParaVencer,
        cadeiaConfiavel: autorizado,
        problemaCadeia: erroCadeia,
      });
    });
    s.on('error', e => resolve({ erro: e.message }));
    s.on('timeout', () => { s.destroy(); resolve({ erro: 'tempo esgotado na conexão TLS' }); });
  });
}

/* ── 5. CAMINHOS SENSÍVEIS EXPOSTOS ─────────────────────────────────────────
   Confere se arquivos que NUNCA deveriam ser públicos estão respondendo. Só a
   verificação de existência — nada é baixado. É o mesmo que um pentester faz na
   primeira olhada, e o mesmo que um atacante faz: melhor o operador achar antes. */
const CAMINHOS = [
  { p: '/.git/config', o: 'repositório Git exposto — código-fonte e histórico baixáveis', peso: 3 },
  { p: '/.env', o: 'variáveis de ambiente — senhas e chaves de API em texto', peso: 3 },
  { p: '/.aws/credentials', o: 'credenciais da AWS expostas', peso: 3 },
  { p: '/wp-config.php.bak', o: 'backup de configuração do WordPress', peso: 3 },
  { p: '/config.php.bak', o: 'backup de configuração com credenciais', peso: 3 },
  { p: '/phpinfo.php', o: 'phpinfo() revela toda a configuração do servidor', peso: 2 },
  { p: '/server-status', o: 'painel de status do Apache exposto', peso: 2 },
  { p: '/.DS_Store', o: 'lista a estrutura de pastas do site', peso: 1 },
  { p: '/backup.zip', o: 'backup do site baixável', peso: 2 },
  { p: '/.svn/entries', o: 'repositório SVN exposto', peso: 2 },
];

async function conferirCaminhos(base) {
  const origem = new URL(base).origin;
  const achar = async ({ p, o, peso }) => {
    try {
      const r = await fetch(origem + p, {
        method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(7000),
      });
      // 200 com corpo real = exposto. 401/403/404/redirecionamento = protegido.
      if (r.status !== 200) { r.body?.cancel?.(); return null; }
      const amostra = (await r.text()).slice(0, 300);
      // uma página 200 genérica (SPA que serve index.html para tudo) não conta:
      // exijo que o conteúdo NÃO pareça HTML de página normal
      if (/<!doctype html|<html/i.test(amostra) && !/\[core\]|aws_access|DB_PASSWORD|password/i.test(amostra)) return null;
      return { caminho: p, risco: o, peso };
    } catch { return null; }
  };
  // concorrência limitada: audita, não martela
  const achados = [];
  for (let i = 0; i < CAMINHOS.length; i += 3) {
    const lote = await Promise.all(CAMINHOS.slice(i, i + 3).map(achar));
    achados.push(...lote.filter(Boolean));
  }
  return achados;
}

/* ── NOTA FINAL ─────────────────────────────────────────────────────────────
   Converte o peso das fraquezas numa letra, como um boletim. Começa em A e
   desce conforme a superfície de ataque cresce. */
function darNota(pesoTotal) {
  if (pesoTotal === 0) return { nota: 'A', veredito: 'Superfície bem fechada. Configuração madura.' };
  if (pesoTotal <= 2) return { nota: 'B', veredito: 'Boa base, com folgas pontuais a corrigir.' };
  if (pesoTotal <= 5) return { nota: 'C', veredito: 'Vários pontos abertos — vale um dia de endurecimento.' };
  if (pesoTotal <= 9) return { nota: 'D', veredito: 'Superfície ampla de ataque. Priorize a correção.' };
  return { nota: 'F', veredito: 'Exposição grave. Trate como urgente.' };
}

/**
 * Auditoria completa de um site. Só http/https, só host público, só GET.
 * @param {string} alvo  URL do site a auditar
 */
export async function auditarSite(alvo) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(alvo) ? alvo : 'https://' + alvo); }
  catch { throw new Error(`URL inválida: ${alvo}`); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('só posso auditar endereços http/https');

  const host = url.hostname;
  await garantirPublico(host);                       // ⚠ trava de SSRF — antes de qualquer requisição

  // requisição principal ao alvo
  let resp, headers, corpoLen = 0, statusPrincipal;
  try {
    resp = await fetch(url.href, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000) });
    headers = resp.headers;
    statusPrincipal = resp.status;
    corpoLen = (await resp.text()).length;
  } catch (e) { throw new Error(`não consegui alcançar ${host}: ${e.message}`); }

  const httpsForcado = url.protocol === 'https:';
  const [tlsInfo, caminhos] = await Promise.all([
    httpsForcado ? auditarTLS(host, +url.port || 443) : Promise.resolve({ erro: 'site servido em HTTP puro — sem TLS' }),
    conferirCaminhos(url.href),
  ]);

  const cab = auditarCabecalhos(headers);
  const cookies = auditarCookies(headers);
  const tech = impressaoTecnica(headers);

  // peso total = cabeçalhos ausentes + caminhos expostos + TLS fraco + cookies frouxos + HTTP puro
  let peso = cab.pesoFaltante;
  peso += caminhos.reduce((s, c) => s + c.peso, 0);
  if (tlsInfo.protocoloFraco) peso += 3;
  if (tlsInfo.cadeiaConfiavel === false) peso += 3;
  if (tlsInfo.diasParaVencer != null && tlsInfo.diasParaVencer < 15) peso += 2;
  if (cookies.problemas.length) peso += cookies.problemas.length;
  if (!httpsForcado) peso += 3;
  if (tech.some(t => t.revelaVersao)) peso += 1;

  const { nota, veredito } = darNota(peso);

  // recomendações em ORDEM DE IMPACTO — o que fazer primeiro
  const recomendacoes = [];
  if (!httpsForcado) recomendacoes.push('Migrar para HTTPS e redirecionar todo o HTTP — hoje o tráfego trafega em claro.');
  for (const c of caminhos.sort((a, b) => b.peso - a.peso)) recomendacoes.push(`URGENTE: remover ${c.caminho} do acesso público (${c.risco}).`);
  if (tlsInfo.protocoloFraco) recomendacoes.push(`Desativar ${tlsInfo.protocolo} no servidor — só TLS 1.2 e 1.3.`);
  if (tlsInfo.diasParaVencer != null && tlsInfo.diasParaVencer < 15) recomendacoes.push(`Renovar o certificado — vence em ${tlsInfo.diasParaVencer} dias.`);
  for (const a of cab.ausentes.sort((x, y) => y.peso - x.peso)) recomendacoes.push(`Adicionar o cabeçalho ${a.nome}: ${a.porque}.`);
  for (const ck of cookies.problemas) recomendacoes.push(`Marcar o cookie "${ck.cookie}" com ${ck.faltando.join(', ')}.`);
  for (const t of tech.filter(t => t.revelaVersao)) recomendacoes.push(`Ocultar a versão em "${t.cabecalho}: ${t.valor}" — entrega ao atacante a lista de CVEs a testar.`);

  return {
    at: new Date().toISOString(),
    alvo: url.href, host, status: statusPrincipal, tamanhoBytes: corpoLen,
    nota, veredito, pesoRisco: peso,
    https: httpsForcado,
    tls: tlsInfo,
    cabecalhos: cab,
    cookies,
    tecnologia: tech,
    caminhosExpostos: caminhos,
    recomendacoes,
  };
}
