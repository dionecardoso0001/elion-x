/* ═══════════════════════════════════════════════════════════════════════════
   APRENDIZADO — a volta de realimentação do ELION sobre si mesmo.

   O diário de atividade já registrava QUAL ferramenta foi usada. Nunca se ela
   funcionou. Por isso o ELION repetia o mesmo erro indefinidamente: ele não
   tinha memória do próprio fracasso, só do próprio hábito.

   Aqui moram três coisas:

     1. DESEMPENHO  — cada execução de ferramenta com êxito/falha, duração e
                      motivo. Vira padrão ("consultar_api falhou 4 das últimas
                      5 vezes por tempo esgotado") que entra no contexto dele.

     2. LIÇÕES      — correções do operador gravadas em linguagem natural, com
                      o gatilho que as torna relevantes. Sobrevivem à sessão.
                      É aqui que "não fale tão longo" deixa de se perder.

     3. AUTOEXAME   — o relatório que o ELION lê sobre si: no que ele é confiável,
                      onde tropeça, o que já lhe ensinaram.

   O QUE ISTO NÃO É: o ELION não reescreve o próprio código. Ele ajusta
   COMPORTAMENTO a partir de evidência do que deu errado. Um agente que edita a
   si mesmo sem revisão humana é um agente que pode se quebrar sozinho às três
   da manhã, sem ninguém para ver — e o operador confia nesta plataforma para
   trabalhar. O aperfeiçoamento é real; o raio de alcance é deliberado.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(AQUI, 'data');
const F_DESEMPENHO = path.join(DATA, 'desempenho.json');
const F_LICOES = path.join(DATA, 'licoes.json');

const MAX_DESEMPENHO = 3000;   // anel; o antigo cai fora
const MAX_LICOES = 120;

function lerJson(arquivo, padrao) {
  try { const v = JSON.parse(fs.readFileSync(arquivo, 'utf8')); return Array.isArray(v) ? v : padrao; }
  catch { return padrao; }
}
function gravarJson(arquivo, valor) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    /* grava em temporário e renomeia: se a energia cair no meio da escrita, o
       arquivo antigo continua íntegro em vez de virar JSON truncado — que é
       como um diário de aprendizado morre em silêncio e ninguém percebe */
    const tmp = arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(valor), 'utf8');
    fs.renameSync(tmp, arquivo);
    return true;
  } catch (e) { console.warn('[aprendizado] não gravou:', e.message); return false; }
}

/* ────────────────────────── 1. DESEMPENHO ────────────────────────── */

/** Uma execução de ferramenta: deu certo? quanto demorou? se falhou, por quê? */
export function registrarResultado(ferramenta, modo, ok, ms, motivo = '') {
  if (!ferramenta) return;
  const l = lerJson(F_DESEMPENHO, []);
  l.push({
    t: Date.now(),
    f: String(ferramenta).slice(0, 50),
    m: String(modo || 'texto').slice(0, 12),
    ok: !!ok,
    ms: Math.round(Number(ms) || 0),
    ...(ok ? {} : { e: String(motivo || '').replace(/\s+/g, ' ').slice(0, 140) }),
  });
  gravarJson(F_DESEMPENHO, l.slice(-MAX_DESEMPENHO));
}

/** Classifica o motivo da falha em família, para o padrão emergir do ruído. */
export function familiaDoErro(texto) {
  const t = String(texto || '').toLowerCase();
  if (/tempo esgotad|timeout|etimedout|abort/.test(t)) return 'tempo esgotado';
  if (/credit|quota|insufficient|429|rate.?limit|saldo/.test(t)) return 'limite/crédito da API';
  if (/401|403|unauthor|forbidden|api key|chave/.test(t)) return 'credencial recusada';
  if (/enotfound|dns|getaddrinfo|econnrefused|network|rede/.test(t)) return 'rede indisponível';
  if (/404|not found|não encontrad/.test(t)) return 'recurso inexistente';
  if (/parse|json|unexpected token|inválid/.test(t)) return 'resposta malformada';
  if (/permission|acesso negado|admin|privil/.test(t)) return 'falta privilégio';
  return 'outro';
}

/**
 * Padrões que valem a pena o ELION saber. Só conta ferramenta com histórico
 * suficiente: duas falhas em duas tentativas é azar, não padrão — anunciar isso
 * como "sempre falha" seria ensinar o agente a desconfiar do que funciona.
 */
export function padroesDeFalha({ minTentativas = 4, janelaDias = 21 } = {}) {
  const corte = Date.now() - janelaDias * 86400000;
  const l = lerJson(F_DESEMPENHO, []).filter(x => x.t >= corte);
  if (!l.length) return { fragilidades: [], confiaveis: [], total: 0, desde: null };

  const porFerr = new Map();
  for (const x of l) {
    if (!porFerr.has(x.f)) porFerr.set(x.f, { n: 0, falhas: 0, somaMs: 0, motivos: new Map(), ultimaFalha: 0 });
    const a = porFerr.get(x.f);
    a.n++; a.somaMs += x.ms || 0;
    if (!x.ok) {
      a.falhas++; a.ultimaFalha = Math.max(a.ultimaFalha, x.t);
      const fam = familiaDoErro(x.e);
      a.motivos.set(fam, (a.motivos.get(fam) || 0) + 1);
    }
  }

  const fragilidades = [], confiaveis = [];
  for (const [f, a] of porFerr) {
    if (a.n < minTentativas) continue;
    const taxa = a.falhas / a.n;
    const medioS = (a.somaMs / a.n / 1000);
    if (taxa >= 0.34) {
      const dom = [...a.motivos.entries()].sort((x, y) => y[1] - x[1])[0];
      fragilidades.push({
        ferramenta: f, tentativas: a.n, falhas: a.falhas,
        taxa: Math.round(taxa * 100),
        motivo: dom ? dom[0] : 'motivo variado',
        mediaSeg: +medioS.toFixed(1),
      });
    } else if (taxa === 0 && a.n >= minTentativas) {
      confiaveis.push({ ferramenta: f, tentativas: a.n, mediaSeg: +medioS.toFixed(1) });
    }
  }
  fragilidades.sort((a, b) => b.taxa - a.taxa || b.tentativas - a.tentativas);
  confiaveis.sort((a, b) => b.tentativas - a.tentativas);

  // lentidão também é defeito: ferramenta que sempre funciona mas leva 40 s
  // precisa de aviso ao operador, senão a espera parece travamento
  const lentas = [...porFerr.entries()]
    .filter(([, a]) => a.n >= minTentativas && (a.somaMs / a.n) > 20000)
    .map(([f, a]) => ({ ferramenta: f, mediaSeg: +(a.somaMs / a.n / 1000).toFixed(1), tentativas: a.n }))
    .sort((a, b) => b.mediaSeg - a.mediaSeg);

  return {
    fragilidades: fragilidades.slice(0, 6),
    confiaveis: confiaveis.slice(0, 6),
    lentas: lentas.slice(0, 4),
    total: l.length,
    desde: new Date(l[0].t).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  };
}

/* ────────────────────────── 2. LIÇÕES ────────────────────────── */

export function licoesLer() { return lerJson(F_LICOES, []); }

/**
 * Grava uma correção do operador. `gatilho` é o que torna a lição relevante
 * depois — sem ele, a lição vira um mural de avisos genéricos que o modelo
 * ignora. Lição parecida com uma já existente REFORÇA em vez de duplicar.
 */
export function gravarLicao({ licao, gatilho = '', categoria = 'geral' }) {
  const texto = String(licao || '').trim();
  if (texto.length < 8) return { ok: false, erro: 'lição vazia ou curta demais para ser útil' };

  const l = licoesLer();
  const norm = s => String(s || '').toLowerCase().replace(/[^a-záàâãéêíóôõúç0-9 ]/gi, '').replace(/\s+/g, ' ').trim();
  const alvo = norm(texto);

  // sobreposição de palavras como medida de "é a mesma lição"
  const parecida = l.find(x => {
    const a = new Set(norm(x.licao).split(' ').filter(w => w.length > 3));
    const b = new Set(alvo.split(' ').filter(w => w.length > 3));
    if (!a.size || !b.size) return false;
    let comum = 0; for (const w of b) if (a.has(w)) comum++;
    return comum / Math.min(a.size, b.size) >= 0.6;
  });

  if (parecida) {
    parecida.reforcos = (parecida.reforcos || 1) + 1;
    parecida.emT = Date.now();
    if (gatilho && !parecida.gatilho) parecida.gatilho = String(gatilho).slice(0, 120);
    gravarJson(F_LICOES, l);
    return { ok: true, acao: 'reforcada', reforcos: parecida.reforcos, licao: parecida.licao };
  }

  l.push({
    id: 'L' + Date.now().toString(36),
    licao: texto.slice(0, 300),
    gatilho: String(gatilho || '').slice(0, 120),
    categoria: String(categoria || 'geral').slice(0, 30),
    emT: Date.now(),
    reforcos: 1,
  });
  gravarJson(F_LICOES, l.slice(-MAX_LICOES));
  return { ok: true, acao: 'nova', total: l.length, licao: texto.slice(0, 300) };
}

export function esquecerLicao(id) {
  const l = licoesLer();
  const i = l.findIndex(x => x.id === id || x.licao.toLowerCase().includes(String(id || '').toLowerCase()));
  if (i < 0) return { ok: false, erro: 'não achei essa lição' };
  const [fora] = l.splice(i, 1);
  gravarJson(F_LICOES, l);
  return { ok: true, removida: fora.licao };
}

/* ────────────────────────── 3. BLOCO DE CONTEXTO ────────────────────────── */

/**
 * O que entra no prompt. Curto de propósito: um bloco longo dilui o resto da
 * persona e o modelo passa a obedecer a lista em vez de conversar.
 */
export function blocoAutoconhecimento() {
  const p = padroesDeFalha();
  const lic = licoesLer().sort((a, b) => (b.reforcos - a.reforcos) || (b.emT - a.emT)).slice(0, 12);
  if (!p.total && !lic.length) return '';

  const partes = ['\nO QUE VOCÊ APRENDEU SOBRE SI (memória do próprio desempenho — você melhora com o uso):'];

  if (p.fragilidades.length) {
    partes.push('- ONDE VOCÊ TROPEÇA, e o que fazer a respeito:');
    for (const f of p.fragilidades) {
      partes.push(`  · ${f.ferramenta}: falhou ${f.falhas} de ${f.tentativas} vezes (${f.taxa}%), quase sempre por ${f.motivo}. ` +
        `AVISE o operador ANTES de tentar ("isso costuma falhar por ${f.motivo}, vou tentar assim mesmo") e tenha um caminho alternativo pronto. Nunca prometa o resultado como certo.`);
    }
  }
  if (p.lentas?.length) {
    partes.push(`- DEMORA: ${p.lentas.map(x => `${x.ferramenta} leva ~${x.mediaSeg}s`).join('; ')}. Anuncie a espera antes de começar — silêncio longo parece travamento.`);
  }
  if (p.confiaveis.length) {
    partes.push(`- SÓLIDAS (nunca falharam em ${p.confiaveis[0].tentativas}+ usos): ${p.confiaveis.map(x => x.ferramenta).join(', ')}. Pode oferecer com confiança.`);
  }
  if (lic.length) {
    partes.push('- LIÇÕES QUE O OPERADOR LHE ENSINOU (ele corrigiu; não repita o erro):');
    for (const x of lic) {
      const peso = x.reforcos > 1 ? ` [ele repetiu isso ${x.reforcos}x — leve a sério]` : '';
      partes.push(`  · ${x.licao}${x.gatilho ? ` (quando: ${x.gatilho})` : ''}${peso}`);
    }
    /* Sem esta linha ele ABRE a conversa agradecendo uma correção de semanas
       atrás. Lição aprendida se cumpre calado: quem precisa anunciar que está
       obedecendo ainda não incorporou. */
    partes.push('  CUMPRA estas lições em SILÊNCIO. Não anuncie que está seguindo uma lição, não agradeça de novo por uma correção antiga, não comece a conversa falando delas. Só mencione uma lição se ele perguntar o que você aprendeu.');
  }
  partes.push('Quando o operador corrigir você — tom, tamanho, formato, uma preferência, um erro factual — CHAME aprender_licao para gravar. Não peça licença: agradeça em uma frase e grave. É assim que você deixa de repetir.\n');
  return partes.join('\n');
}

/** Versão compacta para o modo AO VIVO, onde cada token do prompt custa latência. */
export function blocoAutoconhecimentoCurto() {
  const p = padroesDeFalha();
  const lic = licoesLer().sort((a, b) => (b.reforcos - a.reforcos) || (b.emT - a.emT)).slice(0, 6);
  const linhas = [];
  if (p.fragilidades.length) {
    linhas.push('FALHA COM FREQUÊNCIA: ' + p.fragilidades.map(f => `${f.ferramenta} (${f.taxa}%, ${f.motivo})`).join('; ') + ' — avise antes de tentar.');
  }
  if (p.lentas?.length) linhas.push('DEMORA: ' + p.lentas.map(x => `${x.ferramenta} ~${x.mediaSeg}s`).join('; ') + ' — anuncie a espera.');
  if (lic.length) linhas.push('JÁ LHE ENSINARAM (cumpra em SILÊNCIO — não anuncie que está seguindo, não agradeça de novo): ' + lic.map(x => x.licao).join(' | '));
  return linhas.length ? '\nMEMÓRIA DO SEU PRÓPRIO DESEMPENHO:\n- ' + linhas.join('\n- ') + '\n- Se ele corrigir você, chame aprender_licao para não repetir.\n' : '';
}

/* ────────────────────────── 4. AUTOEXAME ────────────────────────── */

/** Relatório que o ELION lê sobre si mesmo quando o operador pergunta. */
export function relatorioDesempenho({ janelaDias = 21 } = {}) {
  const p = padroesDeFalha({ janelaDias });
  const bruto = lerJson(F_DESEMPENHO, []);
  const janela = bruto.filter(x => x.t >= Date.now() - janelaDias * 86400000);
  const ok = janela.filter(x => x.ok).length;
  const lic = licoesLer();

  const porFamilia = new Map();
  for (const x of janela) if (!x.ok) {
    const f = familiaDoErro(x.e);
    porFamilia.set(f, (porFamilia.get(f) || 0) + 1);
  }

  return {
    janelaDias,
    execucoes: janela.length,
    exitos: ok,
    falhas: janela.length - ok,
    taxaExito: janela.length ? Math.round(ok / janela.length * 100) : null,
    desde: p.desde,
    fragilidades: p.fragilidades,
    confiaveis: p.confiaveis,
    lentas: p.lentas || [],
    familiasDeErro: [...porFamilia.entries()].sort((a, b) => b[1] - a[1]).map(([nome, n]) => ({ nome, n })),
    licoes: lic.sort((a, b) => (b.reforcos - a.reforcos) || (b.emT - a.emT))
      .map(x => ({ licao: x.licao, gatilho: x.gatilho, reforcos: x.reforcos, categoria: x.categoria })),
  };
}

/** Texto para o agente narrar — evidência, não números soltos. */
export function autoexameNarrado(janelaDias = 21) {
  const r = relatorioDesempenho({ janelaDias });
  if (!r.execucoes) {
    return 'Ainda não tenho histórico de desempenho suficiente para me avaliar — ' +
      `${r.licoes.length} lição(ões) gravada(s), nenhuma execução registrada nos últimos ${janelaDias} dias. ` +
      'Diga ao operador que o registro começa a valer depois de algumas dezenas de ações.';
  }
  const L = [];
  L.push(`AUTOEXAME · últimos ${janelaDias} dias · ${r.execucoes} execuções de ferramenta · ${r.taxaExito}% de êxito (${r.falhas} falha(s)).`);
  if (r.fragilidades.length) {
    L.push('ONDE EU FALHO:');
    r.fragilidades.forEach(f => L.push(`  · ${f.ferramenta} — ${f.falhas}/${f.tentativas} (${f.taxa}%), predominantemente por ${f.motivo}`));
  } else L.push('Nenhuma ferramenta com taxa de falha relevante na janela.');
  if (r.lentas.length) L.push('MAIS LENTAS: ' + r.lentas.map(x => `${x.ferramenta} ~${x.mediaSeg}s`).join(', '));
  if (r.confiaveis.length) L.push('MAIS SÓLIDAS: ' + r.confiaveis.map(x => `${x.ferramenta} (${x.tentativas} usos sem falha)`).join(', '));
  if (r.familiasDeErro.length) L.push('CAUSAS: ' + r.familiasDeErro.map(x => `${x.nome} (${x.n})`).join(', '));
  if (r.licoes.length) {
    L.push(`LIÇÕES GRAVADAS (${r.licoes.length}):`);
    r.licoes.slice(0, 10).forEach(x => L.push(`  · ${x.licao}${x.reforcos > 1 ? ` [${x.reforcos}x]` : ''}`));
  } else L.push('Nenhuma lição gravada ainda — o operador não me corrigiu, ou eu não registrei quando ele corrigiu.');
  L.push('');
  L.push('Relate ao operador em VOZ DE PRIMEIRA PESSOA e com honestidade: onde você é confiável, onde tropeça e o que já lhe ensinaram. ' +
    'Não recite todos os números — escolha o que importa para ele decidir em quem confiar. ' +
    'Se houver fragilidade com causa clara (crédito, chave, rede), DIGA o que ele precisa fazer para corrigir.');
  return L.join('\n');
}
