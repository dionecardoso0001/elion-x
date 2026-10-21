/* Landing + estúdio interativo (wizard com preview ao vivo). */
(() => {
  const { h, api, brl, tilt, magnetic, reveal } = window.Studio;
  const $ = s => document.querySelector(s);

  const GOALS = {
    'vender-produto': ['🛍️', 'Vender um produto', 'Oferta clara e chamada para compra'],
    autopromocao: ['🌟', 'Me promover', 'Marca pessoal, portfólio, autoridade'],
    lancamento: ['🚀', 'Lançamento', 'Gerar expectativa para algo novo'],
    evento: ['🎟️', 'Divulgar evento', 'Data, local e motivo para ir'],
    institucional: ['🏢', 'Institucional', 'Apresentar a empresa com credibilidade'],
  };
  const STYLES = {
    cinematico: ['🎬', 'Cinemático', 'Luz dramática, ritmo de trailer'],
    divertido: ['🎉', 'Divertido', 'Cores vivas, energia, humor'],
    minimalista: ['◻️', 'Minimalista', 'Limpo, elegante, premium'],
    futurista: ['🤖', 'Futurista', 'Neon, tech, efeitos digitais'],
    ugc: ['🤳', 'Estilo UGC', 'Parece gravado por um cliente real'],
  };
  const FORMATS = { '9:16': ['📱', 'Vertical 9:16', 'Reels, TikTok, Shorts, Stories'], '1:1': ['⬛', 'Quadrado 1:1', 'Feed do Instagram e Facebook'], '16:9': ['🖥️', 'Horizontal 16:9', 'YouTube, site, TV'] };
  const STEP_NAMES = ['Objetivo', 'Pacote', 'Estilo', 'Briefing', 'Entrega'];

  const state = { step: 0, goal: null, packageId: null, addons: [], style: 'futurista', format: '9:16', catalog: null, quote: null };

  /* ── catálogo e pacotes ─────────────────────────────────────────── */
  async function loadCatalog() {
    try {
      state.catalog = await api('/api/catalog');
    } catch {
      $('#packages').replaceChildren(h('p', { class: 'notice warn' }, 'Não foi possível carregar os pacotes agora. Recarregue a página em instantes.'));
      return;
    }
    const { packages, addons } = state.catalog;
    const minPrice = Math.min(...packages.map(p => p.priceCents));
    const minSla = Math.min(...packages.map(p => p.slaHours));
    $('[data-fact="from"]').textContent = brl(minPrice);
    $('[data-fact="sla"]').textContent = `${minSla} h`;

    $('#packages').replaceChildren(...packages.map(p => {
      const card = h('article', { class: `card pkg reveal${p.featured ? ' featured' : ''}` },
        p.featured ? h('span', { class: 'badge' }, 'Mais pedido') : null,
        h('h3', {}, p.name),
        h('p', { class: 'tag' }, p.tagline),
        h('div', { class: 'price' }, brl(p.priceCents), h('small', {}, 'pagamento único')),
        h('ul', {}, p.features.map(f => h('li', {}, f))),
        h('p', { class: 'meta' }, `Entrega em até ${p.slaHours} h após o pagamento`),
        h('button', { class: `btn ${p.featured ? 'btn-primary' : ''}`, type: 'button', onclick: () => pickPackageAndGo(p.id) }, 'Escolher este'),
      );
      tilt(card, 6);
      return card;
    }));
    reveal($('#packages'));
    $('#packages').querySelectorAll('.btn').forEach(b => magnetic(b, 0.15));

    renderChoices('#pkg-choices', 'packageId', Object.fromEntries(packages.map(p => [p.id, [p.kind === 'photo' ? '📸' : p.kind === 'bundle' ? '🧰' : '🎞️', p.name, brl(p.priceCents)]])));
    $('#addons').replaceChildren(...addons.map(a => h('label', { class: 'addon' },
      h('input', { type: 'checkbox', value: a.id, onchange: e => { toggleAddon(a.id, e.target.checked); } }),
      h('div', {}, h('b', {}, a.name), h('small', {}, a.description)),
      h('span', {}, a.percent ? `+${a.percent}%` : `+ ${brl(a.priceCents)}`),
    )));

    if (!state.catalog.assistant) {
      $('#assist-note').textContent = 'Assistente de IA indisponível agora — usaremos um roteiro-modelo editável.';
    }
  }

  function pickPackageAndGo(id) {
    state.packageId = id;
    const input = document.querySelector(`#pkg-choices input[value="${CSS.escape(id)}"]`);
    if (input) input.checked = true;
    updateQuote();
    goTo(state.goal ? 2 : 0);
    $('#estudio').scrollIntoView({ behavior: window.Studio.reduced ? 'auto' : 'smooth' });
  }

  function toggleAddon(id, on) {
    state.addons = on ? [...new Set([...state.addons, id])] : state.addons.filter(x => x !== id);
    updateQuote();
  }

  /* ── escolhas (radios estilizados) ──────────────────────────────── */
  function renderChoices(sel, key, map) {
    const name = `c-${key}`;
    $(sel).replaceChildren(...Object.entries(map).map(([value, [ico, title, sub]]) => {
      const id = `${name}-${value.replace(/[^a-z0-9]/gi, '')}`;
      return h('div', { class: 'choice' },
        h('input', { type: 'radio', name, id, value, checked: state[key] === value, onchange: () => { state[key] = value; onChange(key); } }),
        h('label', { for: id }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), h('b', {}, title), h('small', {}, sub)),
      );
    }));
  }

  function onChange(key) {
    if (key === 'packageId') updateQuote();
    if (key === 'style' || key === 'format') updatePreview(true);
    if (key === 'goal') updatePreview(false);
    clearError();
  }

  /* ── preview ao vivo ────────────────────────────────────────────── */
  const DEFAULT_CTA = { 'vender-produto': 'Compre agora', autopromocao: 'Fale comigo', lancamento: 'Em breve', evento: 'Garanta seu ingresso', institucional: 'Conheça' };
  function updatePreview(replay) {
    const screen = $('#screen');
    screen.dataset.style = state.style;
    screen.dataset.format = state.format;
    $('#pv-brand').textContent = $('#brand').value.trim() || 'SUA MARCA';
    $('#pv-product').textContent = $('#product').value.trim() || 'Seu produto em destaque';
    const msg = $('#message').value.trim();
    $('#pv-msg').textContent = msg ? (msg.length > 110 ? `${msg.slice(0, 110)}…` : msg) : 'Sua mensagem aparece aqui enquanto você digita.';
    $('#pv-cta').textContent = $('#cta').value.trim() || DEFAULT_CTA[state.goal] || 'Saiba mais';
    if (replay) { screen.classList.add('replay'); void screen.offsetWidth; screen.classList.remove('replay'); }
  }

  /* ── orçamento (sempre do servidor) ─────────────────────────────── */
  let quoteSeq = 0;
  async function updateQuote() {
    if (!state.packageId) return;
    const seq = ++quoteSeq;
    try {
      const q = await api('/api/quote', { method: 'POST', body: { packageId: state.packageId, addons: state.addons } });
      if (seq !== quoteSeq) return; // resposta antiga chegou depois
      state.quote = q;
      $('#sum-lines').replaceChildren(...q.lines.flatMap(l => [h('dt', {}, l.label), h('dd', {}, brl(l.cents))]));
      $('#sum-total').textContent = brl(q.totalCents);
      $('#sum-sla').textContent = `Entrega em até ${q.slaHours} h após a confirmação do pagamento.`;
    } catch (e) { showError(e.message); }
  }

  /* ── navegação do wizard ────────────────────────────────────────── */
  function renderProgress() {
    $('#progress').replaceChildren(...STEP_NAMES.map((n, i) => h('button', {
      type: 'button', role: 'listitem', class: i < state.step ? 'done' : '',
      'aria-current': i === state.step ? 'step' : false, disabled: i > state.step,
      onclick: () => goTo(i),
    }, h('span', {}, `${i + 1}. ${n}`))));
  }

  function goTo(i) {
    const steps = document.querySelectorAll('.step');
    const swap = () => {
      state.step = i;
      steps.forEach((s, k) => s.classList.toggle('active', k === i));
      $('#prev').hidden = i === 0;
      $('#next').textContent = i === steps.length - 1 ? 'Ir para o pagamento →' : 'Continuar →';
      renderProgress();
      clearError();
    };
    if (document.startViewTransition && !window.Studio.reduced) document.startViewTransition(swap); else swap();
  }

  function stepValid(i) {
    if (i === 0 && !state.goal) return 'Escolha um objetivo para continuar.';
    if (i === 1 && !state.packageId) return 'Escolha um pacote.';
    if (i === 3) {
      let msg = '';
      for (const [id, min] of [['brand', 2], ['product', 2], ['message', 20]]) {
        const el = $(`#${id}`);
        const bad = el.value.trim().length < min;
        el.setAttribute('aria-invalid', bad);
        $(`[data-err="${id}"]`).textContent = bad ? (id === 'message' ? 'Conte um pouco mais (mínimo 20 caracteres).' : 'Campo obrigatório.') : '';
        if (bad && !msg) { msg = 'Revise os campos destacados.'; el.focus(); }
      }
      const refs = refsList();
      const badRef = refs.find(r => !/^https:\/\/\S+$/i.test(r));
      $('[data-err="references"]').textContent = badRef ? 'Use links completos começando com https://' : refs.length > 5 ? 'No máximo 5 links.' : '';
      if (badRef || refs.length > 5) msg ||= 'Revise os links de referência.';
      return msg;
    }
    if (i === 4) {
      let msg = '';
      const name = $('#name'), email = $('#email');
      const badName = name.value.trim().length < 2;
      const badEmail = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim());
      name.setAttribute('aria-invalid', badName); email.setAttribute('aria-invalid', badEmail);
      $('[data-err="name"]').textContent = badName ? 'Informe seu nome.' : '';
      $('[data-err="email"]').textContent = badEmail ? 'Informe um e-mail válido — é por ele que falamos com você.' : '';
      $('[data-err="acceptTerms"]').textContent = $('#terms').checked ? '' : 'É preciso aceitar para continuar.';
      if (badName || badEmail || !$('#terms').checked) msg = 'Revise os campos destacados.';
      return msg;
    }
    return '';
  }

  const refsList = () => $('#refs').value.split(/\s*\n\s*/).map(s => s.trim()).filter(Boolean);

  function showError(m) { $('#form-error').textContent = m; }
  function clearError() { $('#form-error').textContent = ''; }

  async function next() {
    const err = stepValid(state.step);
    if (err) return showError(err);
    const last = document.querySelectorAll('.step').length - 1;
    if (state.step < last) return goTo(state.step + 1);
    await submit();
  }

  /* ── assistente de roteiro ──────────────────────────────────────── */
  function localScript() {
    const b = $('#brand').value.trim() || 'Sua marca';
    const p = $('#product').value.trim() || 'seu produto';
    const cta = $('#cta').value.trim() || DEFAULT_CTA[state.goal] || 'Saiba mais';
    return [
      `[0–3s] VISUAL: close impactante de ${p} / TEXTO: "${b} apresenta" / LOCUÇÃO: "Você já viu algo assim?"`,
      `[3–10s] VISUAL: ${p} em uso, cortes rápidos / TEXTO: o principal benefício / LOCUÇÃO: a mensagem central em uma frase.`,
      `[10–13s] VISUAL: prova (resultado, detalhe, cliente satisfeito) / TEXTO: diferencial.`,
      `[13–15s] VISUAL: logo + ${p} / TEXTO: "${cta}" / LOCUÇÃO: "${cta}."`,
    ].join('\n');
  }

  async function assist() {
    const btn = $('#assist-btn');
    if (!state.catalog?.assistant) { $('#script').value = localScript(); $('#assist-note').textContent = 'Roteiro-modelo inserido — edite à vontade.'; return; }
    if ($('#message').value.trim().length < 20) { $('#assist-note').textContent = 'Escreva a mensagem principal (mín. 20 caracteres) para a IA ter contexto.'; return; }
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Escrevendo…');
    try {
      const { script } = await api('/api/assist/script', { method: 'POST', body: { packageId: state.packageId, briefing: briefing() } });
      $('#script').value = script;
      $('#assist-note').textContent = 'Roteiro sugerido pela IA — revise antes de enviar.';
    } catch (e) {
      $('#script').value ||= localScript();
      $('#assist-note').textContent = `${e.message}. Inserimos um roteiro-modelo.`;
    } finally {
      btn.disabled = false;
      btn.textContent = '✦ Sugerir roteiro com IA';
    }
  }

  const briefing = () => ({
    goal: state.goal, style: state.style, format: state.format,
    brand: $('#brand').value, product: $('#product').value, audience: $('#audience').value,
    message: $('#message').value, cta: $('#cta').value, script: $('#script').value, references: refsList(),
  });

  /* ── envio do pedido ────────────────────────────────────────────── */
  async function submit() {
    const btn = $('#next');
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Criando pedido…');
    try {
      const r = await api('/api/orders', {
        method: 'POST',
        body: {
          packageId: state.packageId, addons: state.addons, acceptTerms: $('#terms').checked, briefing: briefing(),
          customer: { name: $('#name').value, email: $('#email').value, whatsapp: $('#whatsapp').value },
        },
      });
      // O token fica só neste navegador; o servidor guarda apenas o hash dele.
      try { localStorage.setItem(`studio:order:${r.id}`, r.accessToken); } catch { /* modo privado */ }
      location.assign(r.checkoutUrl);
    } catch (e) {
      showError(e.message);
      if (e.field) {
        const map = { brand: 3, product: 3, message: 3, references: 3, email: 4, name: 4, acceptTerms: 4 };
        const f = e.field.replace(/\[.*$/, '');
        if (map[f] !== undefined && map[f] !== state.step) goTo(map[f]);
      }
      btn.disabled = false;
      btn.textContent = 'Ir para o pagamento →';
    }
  }

  /* ── inicialização ──────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    renderChoices('#goals', 'goal', GOALS);
    renderChoices('#styles', 'style', STYLES);
    renderChoices('#formats', 'format', FORMATS);
    renderProgress();
    $('#prev').hidden = true;
    $('#prev').addEventListener('click', () => goTo(Math.max(0, state.step - 1)));
    $('#next').addEventListener('click', next);
    $('#wizard').addEventListener('submit', e => { e.preventDefault(); next(); });
    $('#assist-btn').addEventListener('click', assist);
    for (const id of ['brand', 'product', 'message', 'cta']) $(`#${id}`).addEventListener('input', () => updatePreview(false));
    $('#message').addEventListener('input', e => { $('#msg-count').textContent = `${e.target.value.length}/1500`; });
    tilt($('#stage'), 14);
    updatePreview(false);
    loadCatalog();
  });
})();
