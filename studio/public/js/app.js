/* Landing: galeria de estilos, pacotes e o pedido (wizard com preview ao vivo e fotos). */
(() => {
  const { h, api, brl, tilt, magnetic, reveal, prepareImage, upload, icon3d } = window.Studio;
  const $ = s => document.querySelector(s);

  const GOALS = {
    'vender-produto': ['vender-produto', 'Vender um produto', 'Oferta clara e chamada para compra'],
    autopromocao: ['autopromocao', 'Me promover', 'Marca pessoal, portfólio, autoridade'],
    lancamento: ['lancamento', 'Lançamento', 'Gerar expectativa para algo novo'],
    evento: ['evento', 'Divulgar evento', 'Data, local e motivo para ir'],
    institucional: ['institucional', 'Institucional', 'Apresentar a empresa com credibilidade'],
  };
  const FORMATS = { '9:16': ['vertical', 'Vertical 9:16', 'Reels, TikTok, Shorts, Stories'], '1:1': ['quadrado', 'Quadrado 1:1', 'Feed do Instagram e Facebook'], '16:9': ['horizontal', 'Horizontal 16:9', 'YouTube, site, TV'] };
  const KIND_ICON = { photo: 'foto', video: 'video', bundle: 'kit' };
  const MEDIUM = { video: 'Estilo do vídeo', image: 'Estilo das imagens' };
  const STEP_NAMES = ['Objetivo', 'Pacote', 'Estilo', 'Briefing', 'Fotos', 'Entrega'];
  const MAX_PHOTOS = 8;

  const state = {
    step: 0, goal: null, packageId: null, addons: [], styles: {}, format: '9:16',
    catalog: null, quote: null, photos: [], wantedStyle: null,
  };

  const pkgOf = () => state.catalog?.packages.find(p => p.id === state.packageId);
  const mediaOf = pkg => pkg ? [pkg.deliverables.videos > 0 && 'video', pkg.deliverables.images > 0 && 'image'].filter(Boolean) : [];
  const styleOf = id => state.catalog?.styles.find(s => s.id === id);

  /* ── galeria de estilos ─────────────────────────────────────────── */
  function miniScreen(st) {
    return h('div', { class: 'screen mini', 'data-style': st.preview, 'data-format': st.medium === 'video' ? '9:16' : '1:1', 'aria-hidden': 'true' },
      h('div', { class: 'bg' }),
      h('div', { class: 'scene' }, h('span', { class: 'p-brand' }, 'SUA MARCA'), h('span', { class: 'p-product' }, st.medium === 'video' ? 'Seu vídeo' : 'Seu produto'), h('span', { class: 'p-cta' }, 'Saiba mais')),
      st.medium === 'video' ? h('span', { class: 'p-bar' }) : null,
    );
  }

  function renderGallery(medium) {
    document.querySelectorAll('.tabs [role="tab"]').forEach(t => {
      const on = t.dataset.medium === medium;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      if (on) $('#gallery').setAttribute('aria-labelledby', t.id);
    });
    const list = state.catalog.styles.filter(s => s.medium === medium);
    $('#gallery').replaceChildren(...list.map(st => h('article', { class: 'card style-card reveal' },
      miniScreen(st),
      h('div', { class: 'style-body' },
        h('span', { class: 'style-tag' }, st.medium === 'video' ? 'Vídeo' : 'Imagem'),
        h('h3', {}, st.name),
        h('p', { class: 'style-sum' }, st.summary),
        h('details', {},
          h('summary', {}, 'O que é e quando usar'),
          h('p', {}, st.description),
          h('p', { class: 'style-label' }, 'Ideal para'),
          h('ul', { class: 'pill-list' }, st.idealFor.map(x => h('li', {}, x))),
          h('p', { class: 'style-label' }, 'O que você envia'),
          h('p', {}, st.send),
        ),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => chooseStyleFromGallery(st) }, 'Quero este estilo'),
      ),
    )));
    reveal($('#gallery'));
  }

  function chooseStyleFromGallery(st) {
    state.wantedStyle = st.id;
    // Sem pacote ainda, ou pacote que não produz esta mídia: sugere o primeiro que produz.
    if (!mediaOf(pkgOf()).includes(st.medium)) {
      const pkg = state.catalog.packages.find(p => mediaOf(p).length === 1 && mediaOf(p)[0] === st.medium) || state.catalog.packages.find(p => mediaOf(p).includes(st.medium));
      selectPackage(pkg.id);
    }
    state.styles[st.medium] = st.id;
    renderStyleGroups();
    updatePreview(true);
    goTo(state.goal ? 2 : 0);
    if (!state.goal) showError(`Estilo "${st.name}" selecionado. Agora escolha o objetivo para continuar.`);
    $('#estudio').scrollIntoView({ behavior: window.Studio.reduced ? 'auto' : 'smooth' });
  }

  /* ── catálogo e pacotes ─────────────────────────────────────────── */
  async function loadCatalog() {
    try {
      state.catalog = await api('/api/catalog');
    } catch {
      $('#packages').replaceChildren(h('p', { class: 'notice warn' }, 'Não foi possível carregar os pacotes agora. Recarregue a página em instantes.'));
      return;
    }
    const { packages, addons, categories, styles } = state.catalog;
    $('[data-fact="from"]').textContent = brl(Math.min(...packages.map(p => p.priceCents)));
    $('[data-fact="styles"]').textContent = String(styles.length);

    renderGallery('image');

    $('#packages').replaceChildren(...packages.map(p => {
      const card = h('article', { class: `card pkg reveal icon-host${p.featured ? ' featured' : ''}` },
        p.featured ? h('span', { class: 'badge' }, 'Mais pedido') : null,
        icon3d(KIND_ICON[p.kind], { size: 84 }),
        h('h3', {}, p.name),
        h('p', { class: 'tag' }, p.tagline),
        h('div', { class: 'price' }, brl(p.priceCents), h('small', {}, 'no Pix')),
        h('ul', {}, p.features.map(f => h('li', {}, f))),
        h('p', { class: 'meta' }, `Entrega em até ${p.slaHours} h após a confirmação do Pix`),
        h('button', { class: `btn ${p.featured ? 'btn-primary' : ''}`, type: 'button', onclick: () => { selectPackage(p.id); goTo(state.goal ? 2 : 0); $('#estudio').scrollIntoView({ behavior: window.Studio.reduced ? 'auto' : 'smooth' }); } }, 'Escolher este'),
      );
      tilt(card, 6);
      return card;
    }));
    reveal($('#packages'));
    $('#packages').querySelectorAll('.btn').forEach(b => magnetic(b, 0.15));

    renderChoices('#pkg-choices', 'packageId', Object.fromEntries(packages.map(p => [p.id, [KIND_ICON[p.kind], p.name, brl(p.priceCents)]])), v => selectPackage(v));
    $('#addons').replaceChildren(...addons.map(a => h('label', { class: 'addon' },
      h('input', { type: 'checkbox', value: a.id, onchange: e => toggleAddon(a.id, e.target.checked) }),
      h('div', {}, h('b', {}, a.name), h('small', {}, a.description)),
      h('span', {}, a.percent ? `+${a.percent}%` : `+ ${brl(a.priceCents)}`),
    )));
    $('#category').append(...categories.map(([v, label]) => h('option', { value: v }, label)));
    renderStyleGroups();

    if (!state.catalog.assistant) $('#assist-note').textContent = 'Insere um roteiro-modelo que você pode editar.';
  }

  function selectPackage(id) {
    state.packageId = id;
    const input = document.querySelector(`#pkg-choices input[value="${CSS.escape(id)}"]`);
    if (input) input.checked = true;
    // Descarta estilo de mídia que o novo pacote não produz.
    const media = mediaOf(pkgOf());
    for (const k of Object.keys(state.styles)) if (!media.includes(k)) delete state.styles[k];
    renderStyleGroups();
    updatePreview(true);
    updateQuote();
  }

  function toggleAddon(id, on) {
    state.addons = on ? [...new Set([...state.addons, id])] : state.addons.filter(x => x !== id);
    updateQuote();
  }

  /* ── escolhas (radios estilizados) ──────────────────────────────── */
  function renderChoices(sel, key, map, onPick) {
    const name = `c-${key}`;
    $(sel).replaceChildren(...Object.entries(map).map(([value, [ico, title, sub]]) => {
      const id = `${name}-${value.replace(/[^a-z0-9]/gi, '')}`;
      return h('div', { class: 'choice icon-host' },
        h('input', { type: 'radio', name, id, value, checked: state[key] === value, onchange: () => (onPick ? onPick(value) : (state[key] = value, onChange(key))) }),
        h('label', { for: id }, icon3d(ico, { size: key === 'goal' ? 76 : 62 }), h('b', {}, title), h('small', {}, sub)),
      );
    }));
  }

  function renderStyleGroups() {
    if (!state.catalog) return;
    const media = mediaOf(pkgOf());
    $('#style-hint').textContent = media.length
      ? (media.length > 1 ? 'Este pacote tem vídeo e imagens: escolha um estilo para cada.' : 'Escolha o estilo. Na dúvida, abra a galeria acima para ver a explicação de cada um.')
      : 'Escolha um pacote primeiro.';
    $('#style-groups').replaceChildren(...media.map(medium => {
      const name = `c-style-${medium}`;
      return h('div', { class: 'style-group' },
        media.length > 1 ? h('h4', {}, MEDIUM[medium]) : null,
        h('div', { class: 'choices' }, state.catalog.styles.filter(s => s.medium === medium).map(st => {
          const id = `${name}-${st.id}`;
          return h('div', { class: 'choice' },
            h('input', { type: 'radio', name, id, value: st.id, checked: state.styles[medium] === st.id, onchange: () => { state.styles[medium] = st.id; updatePreview(true); clearError(); } }),
            h('label', { for: id }, h('b', {}, st.name), h('small', {}, st.summary)),
          );
        })),
      );
    }));
  }

  function onChange(key) {
    if (key === 'format') updatePreview(true);
    if (key === 'goal') updatePreview(false);
    clearError();
  }

  /* ── preview ao vivo ────────────────────────────────────────────── */
  const DEFAULT_CTA = { 'vender-produto': 'Compre agora', autopromocao: 'Fale comigo', lancamento: 'Em breve', evento: 'Garanta seu ingresso', institucional: 'Conheça' };
  function updatePreview(replay) {
    const screen = $('#screen');
    const st = styleOf(state.styles.video || state.styles.image || state.wantedStyle);
    screen.dataset.style = st?.preview || 'futurista';
    screen.dataset.format = state.format;
    $('#pv-style-name').textContent = st
      ? `Estilo: ${st.name}. Prévia ilustrativa de layout; o material final é feito a partir do seu briefing e das suas fotos.`
      : 'Prévia ilustrativa de layout. O material final é produzido a partir do seu briefing e das suas fotos.';
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
      if (seq !== quoteSeq) return;
      state.quote = q;
      $('#sum-lines').replaceChildren(...q.lines.flatMap(l => [h('dt', {}, l.label), h('dd', {}, brl(l.cents))]));
      $('#sum-total').textContent = brl(q.totalCents);
      $('#sum-sla').textContent = `Entrega em até ${q.slaHours} h após a confirmação do Pix.`;
    } catch (e) { showError(e.message); }
  }

  /* ── fotos do produto ───────────────────────────────────────────── */
  async function addPhotos(files) {
    const errEl = $('[data-err="photos"]');
    errEl.textContent = '';
    for (const file of files) {
      if (state.photos.length >= MAX_PHOTOS) { errEl.textContent = `Máximo de ${MAX_PHOTOS} fotos.`; break; }
      if (file.size > 30 * 1048576) { errEl.textContent = `"${file.name}" passa de 30 MB.`; continue; }
      try {
        const blob = await prepareImage(file);
        state.photos.push({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 60), blob, url: URL.createObjectURL(blob) });
      } catch (e) { errEl.textContent = e.message; }
    }
    renderThumbs();
  }

  function renderThumbs() {
    $('#thumbs').replaceChildren(...state.photos.map((p, i) => h('li', { class: 'thumb' },
      h('img', { src: p.url, alt: `Foto ${i + 1}: ${p.name}` }),
      h('button', { type: 'button', class: 'thumb-x', 'aria-label': `Remover foto ${i + 1}`, onclick: () => { URL.revokeObjectURL(p.url); state.photos.splice(i, 1); renderThumbs(); } }, '×'),
      h('progress', { max: 1, value: 0, hidden: true }),
    )));
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
      $('#next').textContent = i === steps.length - 1 ? 'Finalizar e pagar com Pix →' : 'Continuar →';
      renderProgress();
      clearError();
    };
    if (document.startViewTransition && !window.Studio.reduced) document.startViewTransition(swap); else swap();
  }

  function fieldErr(id, bad, msg) {
    const el = $(`#${id}`);
    if (el) el.setAttribute('aria-invalid', bad);
    const e = $(`[data-err="${id}"]`);
    if (e) e.textContent = bad ? msg : '';
    return bad;
  }

  function stepValid(i) {
    if (i === 0) {
      if (!state.goal) return 'Escolha um objetivo para continuar.';
      if (fieldErr('category', !$('#category').value, 'Escolha a categoria.')) return 'Escolha a categoria do que vai divulgar.';
    }
    if (i === 1 && !state.packageId) return 'Escolha um pacote.';
    if (i === 2) {
      const missing = mediaOf(pkgOf()).find(m => !state.styles[m]);
      if (missing) return missing === 'video' ? 'Escolha o estilo do vídeo.' : 'Escolha o estilo das imagens.';
    }
    if (i === 3) {
      let msg = '';
      for (const [id, min, text] of [['brand', 2, 'Campo obrigatório.'], ['product', 2, 'Campo obrigatório.'], ['message', 20, 'Conte um pouco mais (mínimo 20 caracteres).']]) {
        if (fieldErr(id, $(`#${id}`).value.trim().length < min, text) && !msg) { msg = 'Revise os campos destacados.'; $(`#${id}`).focus(); }
      }
      const refs = refsList();
      const badRef = refs.find(r => !/^https:\/\/\S+$/i.test(r));
      $('[data-err="references"]').textContent = badRef ? 'Use links completos começando com https://' : refs.length > 5 ? 'No máximo 5 links.' : '';
      if (badRef || refs.length > 5) msg ||= 'Revise os links de referência.';
      return msg;
    }
    if (i === 5) {
      const bad = [
        fieldErr('name', $('#name').value.trim().length < 2, 'Informe seu nome.'),
        fieldErr('email', !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test($('#email').value.trim()), 'Informe um e-mail válido.'),
      ].some(Boolean);
      $('[data-err="acceptTerms"]').textContent = $('#terms').checked ? '' : 'É preciso aceitar para continuar.';
      if (bad || !$('#terms').checked) return 'Revise os campos destacados.';
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

  /* ── roteiro ────────────────────────────────────────────────────── */
  function localScript() {
    const b = $('#brand').value.trim() || 'Sua marca';
    const p = $('#product').value.trim() || 'seu produto';
    const cta = $('#cta').value.trim() || DEFAULT_CTA[state.goal] || 'Saiba mais';
    return [
      `[0–3s] Close impactante de ${p}. Texto: "${b} apresenta".`,
      `[3–10s] ${p} em destaque, mostrando o principal benefício.`,
      `[10–13s] Detalhe que prova a qualidade (acabamento, textura, resultado).`,
      `[13–15s] Logo + ${p}. Texto: "${cta}".`,
    ].join('\n');
  }

  async function assist() {
    const btn = $('#assist-btn');
    if (!state.catalog?.assistant) { $('#script').value = localScript(); $('#assist-note').textContent = 'Roteiro-modelo inserido — edite à vontade.'; return; }
    if ($('#message').value.trim().length < 20) { $('#assist-note').textContent = 'Escreva a mensagem principal (mín. 20 caracteres) primeiro.'; return; }
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
      btn.textContent = '✦ Sugerir roteiro';
    }
  }

  const briefing = () => ({
    goal: state.goal, category: $('#category').value, styles: state.styles, format: state.format,
    brand: $('#brand').value, product: $('#product').value, audience: $('#audience').value,
    message: $('#message').value, cta: $('#cta').value, script: $('#script').value, references: refsList(),
  });

  /* ── envio: cria o pedido, sobe as fotos e abre a página do Pix ─── */
  async function submit() {
    const btn = $('#next');
    btn.disabled = true;
    const label = t => btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), t);
    label('Criando pedido…');
    let r;
    try {
      r = await api('/api/orders', {
        method: 'POST',
        body: {
          packageId: state.packageId, addons: state.addons, acceptTerms: $('#terms').checked, briefing: briefing(),
          customer: { name: $('#name').value, email: $('#email').value, whatsapp: $('#whatsapp').value },
        },
      });
    } catch (e) {
      showError(e.message);
      const map = { goal: 0, category: 0, styles: 2, brand: 3, product: 3, message: 3, references: 3, email: 5, name: 5, acceptTerms: 5 };
      const f = String(e.field || '').replace(/[[.].*$/, '');
      if (map[f] !== undefined && map[f] !== state.step) goTo(map[f]);
      btn.disabled = false;
      btn.textContent = 'Finalizar e pagar com Pix →';
      return;
    }
    // O token fica só neste navegador; o servidor guarda apenas o hash dele.
    try { localStorage.setItem(`studio:order:${r.id}`, r.accessToken); } catch { /* modo privado */ }

    const items = [...document.querySelectorAll('#thumbs progress')];
    let failed = 0;
    for (const [i, p] of state.photos.entries()) {
      label(`Enviando foto ${i + 1} de ${state.photos.length}…`);
      const bar = items[i]; if (bar) bar.hidden = false;
      try {
        await upload(`/api/orders/${r.id}/photos`, p.blob, { token: r.accessToken, label: p.name, onProgress: v => { if (bar) bar.value = v; } });
      } catch { failed++; }
    }
    if (failed) try { sessionStorage.setItem('studio:photo-failed', String(failed)); } catch { /* ok */ }
    location.assign(r.checkoutUrl);
  }

  /* ── inicialização ──────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    renderChoices('#goals', 'goal', GOALS);
    renderChoices('#formats', 'format', FORMATS);
    renderProgress();
    $('#prev').hidden = true;
    $('#prev').addEventListener('click', () => goTo(Math.max(0, state.step - 1)));
    $('#next').addEventListener('click', next);
    $('#wizard').addEventListener('submit', e => { e.preventDefault(); next(); });
    $('#assist-btn').addEventListener('click', assist);
    for (const id of ['brand', 'product', 'message', 'cta']) $(`#${id}`).addEventListener('input', () => updatePreview(false));
    $('#message').addEventListener('input', e => { $('#msg-count').textContent = `${e.target.value.length}/1500`; });
    $('#category').addEventListener('change', () => fieldErr('category', false, ''));

    const dz = $('#dropzone');
    $('#photos').addEventListener('change', e => { addPhotos([...e.target.files]); e.target.value = ''; });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); addPhotos([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))); });

    document.querySelectorAll('.tabs [role="tab"]').forEach(t => {
      t.classList.add('icon-host');
      t.prepend(icon3d(t.dataset.medium === 'video' ? 'video' : 'foto', { size: 30 }));
      t.addEventListener('click', () => state.catalog && renderGallery(t.dataset.medium));
      t.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        const other = document.querySelector(`.tabs [role="tab"]:not([data-medium="${t.dataset.medium}"])`);
        other.focus(); other.click();
      });
    });

    tilt($('#stage'), 14);
    updatePreview(false);
    loadCatalog();
  });
})();
