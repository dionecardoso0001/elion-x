/* Painel do operador: confirmar Pix, conduzir a produção, enviar arquivos e
   avisar o cliente. O token fica só na sessionStorage (some ao fechar a aba). */
(() => {
  const { h, api, brl, fmtDate, fmtSize, upload } = window.Studio;
  const $ = s => document.querySelector(s);

  const STATUS = {
    awaiting_payment: 'Aguardando Pix', payment_reported: 'Cliente diz que pagou', paid: 'Pago — na fila',
    in_production: 'Em produção', revision_requested: 'Ajuste pedido', delivered: 'Entregue', failed: 'Com problema', canceled: 'Cancelado',
  };
  const FILTERS = [
    ['acao', 'Precisa de ação', o => ['payment_reported', 'paid', 'revision_requested', 'failed'].includes(o.status)],
    ['producao', 'Em produção', o => o.status === 'in_production'],
    ['pix', 'Aguardando Pix', o => o.status === 'awaiting_payment'],
    ['entregues', 'Entregues', o => o.status === 'delivered'],
    ['todos', 'Todos', () => true],
  ];

  let token = '';
  let filter = 'acao';
  let orders = [];
  const open = new Set();
  let styleNames = {};
  let categoryNames = {};
  const GOAL_NAMES = { 'vender-produto': 'Vender um produto', autopromocao: 'Autopromoção', lancamento: 'Lançamento', evento: 'Divulgar evento', institucional: 'Institucional' };
  try { token = sessionStorage.getItem('studio:admin') || ''; } catch { /* ok */ }

  const call = (path, opts = {}) => api(path, { ...opts, token });

  /* Depois de uma ação, o pedido muda de status: troca o filtro para ele continuar visível. */
  let followId = null;
  function follow() {
    if (!followId) return;
    const o = orders.find(x => x.id === followId);
    followId = null;
    if (o && !FILTERS.find(f => f[0] === filter)[2](o)) filter = FILTERS.find(f => f[2](o))[0];
  }

  async function load() {
    $('#err').textContent = '';
    try {
      orders = await call('/api/admin/orders');
      $('#login').hidden = true; $('#panel').hidden = false; $('#logout').hidden = false;
      follow();
      render();
    } catch (e) {
      if (e.status === 401) { $('#login').hidden = false; $('#panel').hidden = true; $('#err').textContent = ''; }
      $('#err').textContent = e.message;
    }
  }

  function render() {
    const cents = orders.filter(o => !['awaiting_payment', 'payment_reported', 'canceled'].includes(o.status)).reduce((s, o) => s + o.quote.totalCents, 0);
    const kpi = (label, value, tone) => h('div', { class: `kpi ${tone || ''}` }, h('b', {}, value), h('span', {}, label));
    $('#kpis').replaceChildren(
      kpi('Precisam de ação', String(orders.filter(FILTERS[0][2]).length), 'warn'),
      kpi('Em produção', String(orders.filter(FILTERS[1][2]).length)),
      kpi('Aguardando Pix', String(orders.filter(FILTERS[2][2]).length)),
      kpi('Recebido (confirmado)', brl(cents), 'ok'),
    );
    $('#filters').replaceChildren(...FILTERS.map(([k, label, fn]) => h('button', {
      type: 'button', class: `chip${filter === k ? ' on' : ''}`, 'aria-pressed': filter === k, onclick: () => { filter = k; render(); },
    }, `${label} (${orders.filter(fn).length})`)));
    const list = orders.filter(FILTERS.find(f => f[0] === filter)[2]);
    $('#orders').replaceChildren(...(list.length ? list.map(card) : [h('p', { class: 'card empty' }, 'Nada por aqui.')]));
  }

  const waLink = (phone, text) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}?text=${encodeURIComponent(text)}`;
  };

  function card(o) {
    const isOpen = open.has(o.id);
    const b = o.briefing;
    const actions = [];
    const act = (label, fn, primary) => actions.push(h('button', { class: `btn btn-sm${primary ? ' btn-primary' : ''}`, type: 'button', onclick: fn }, label));

    if (['awaiting_payment', 'payment_reported'].includes(o.status)) {
      act('✓ Confirmar Pix recebido', () => confirmAction(o, `Confirme que ${brl(o.quote.totalCents)} já está no seu extrato (não aceite só comprovante).`, () => call(`/api/admin/orders/${o.id}/confirm-payment`, { method: 'POST', body: {} })), true);
    }
    if (['paid', 'revision_requested', 'failed'].includes(o.status)) act('▶ Iniciar produção', () => setStatus(o, 'in_production'), true);
    if (['paid', 'in_production', 'revision_requested', 'failed'].includes(o.status)) act('📦 Entregar ao cliente', () => deliver(o), o.status === 'in_production');
    if (['awaiting_payment', 'payment_reported', 'paid', 'failed'].includes(o.status)) act('Cancelar', () => confirmAction(o, 'Cancelar este pedido? Se já houve pagamento, faça o estorno pelo seu banco.', () => call(`/api/admin/orders/${o.id}/status`, { method: 'POST', body: { status: 'canceled' } })));
    act('🔗 Link do cliente / WhatsApp', () => shareLink(o));

    return h('article', { class: 'card admin-card', 'data-s': o.status },
      h('header', { class: 'ac-head' },
        h('div', {},
          h('b', { class: 'mono' }, o.id), ' ',
          h('span', { class: 'status-pill', 'data-s': o.status }, STATUS[o.status] || o.status),
          h('p', { class: 'm0 muted small' }, `${fmtDate(o.createdAt)} · ${o.packageName} · ${brl(o.quote.totalCents)}${o.dueAt ? ` · prazo ${fmtDate(o.dueAt)}` : ''}`),
        ),
        h('button', { class: 'btn btn-sm', type: 'button', 'aria-expanded': isOpen, onclick: () => { isOpen ? open.delete(o.id) : open.add(o.id); render(); } }, isOpen ? 'Fechar' : 'Detalhes'),
      ),
      h('p', { class: 'm0' }, h('b', {}, o.customer.name), ` · ${o.customer.email}`, o.customer.whatsapp ? ` · ${o.customer.whatsapp}` : ''),
      o.payment?.reportedAt ? h('p', { class: 'notice warn m0' }, `Cliente informou o Pix em ${fmtDate(o.payment.reportedAt)}${o.payment.payerName ? ` — pagador: ${o.payment.payerName}` : ''}. Confira o extrato (identificador ${o.payment.txid || o.id}).`) : null,
      o.lastRevisionNote && o.status === 'revision_requested' ? h('p', { class: 'notice m0' }, `Ajuste pedido: ${o.lastRevisionNote}`) : null,
      h('div', { class: 'ac-actions' }, actions),
      isOpen ? details(o) : null,
    );
  }

  function details(o) {
    const b = o.briefing;
    const styles = Object.entries(b.styles || {}).map(([m, s]) => `${m === 'video' ? 'Vídeo' : 'Imagem'}: ${styleNames[s] || s}`).join(' · ');
    const rows = [
      ['Objetivo', GOAL_NAMES[b.goal] || b.goal], ['Categoria', categoryNames[b.category] || b.category], ['Estilo', styles], ['Formato', b.format], ['Marca', b.brand], ['Produto', b.product],
      ['Público', b.audience || '—'], ['Mensagem', b.message], ['Chamada final', b.cta || '—'], ['Roteiro', b.script || '—'],
      ['Adicionais', o.quote.addons.join(', ') || '—'], ['Referências', b.references.length ? b.references.join('\n') : '—'],
    ];
    return h('div', { class: 'ac-details' },
      h('div', { class: 'ac-cols' },
        h('div', {},
          h('h4', {}, 'Briefing'),
          h('dl', { class: 'brief' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: e => copyBrief(o, styles, e.target) }, 'Copiar briefing (para suas IAs)'),
        ),
        h('div', {},
          h('h4', {}, `Fotos do cliente (${o.photos.length})`),
          o.photos.length
            ? h('ul', { class: 'thumbs' }, o.photos.map(p => h('li', { class: 'thumb' }, h('a', { href: p.download, target: '_blank', rel: 'noopener', title: `Baixar ${p.label}` }, h('img', { src: p.url, alt: p.label, loading: 'lazy' })))))
            : h('p', { class: 'muted small' }, 'Nenhuma foto enviada.'),
          h('h4', { class: 'mt' }, `Arquivos de entrega (${o.files.length})`),
          h('ul', { class: 'file-list' }, o.files.map(f => h('li', {},
            h('a', { href: f.url, target: '_blank', rel: 'noopener' }, f.label), h('span', { class: 'muted small' }, ` ${f.ext.toUpperCase()} · ${fmtSize(f.size)} `),
            h('button', { class: 'btn btn-sm', type: 'button', onclick: () => confirmAction(o, `Remover ${f.label}?`, () => call(`/api/admin/orders/${o.id}/files/${f.id}`, { method: 'DELETE' })) }, 'Remover'),
          ))),
          ['awaiting_payment', 'payment_reported', 'canceled'].includes(o.status)
            ? h('p', { class: 'muted small' }, 'Confirme o pagamento para liberar o envio de arquivos.')
            : h('label', { class: 'dropzone small-dz' },
              h('input', { type: 'file', multiple: true, accept: 'video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp,application/zip,application/pdf', onchange: e => sendFiles(o, [...e.target.files], e.target) }),
              h('b', {}, 'Enviar vídeos/fotos prontos'), h('small', {}, 'MP4, MOV, WEBM, JPG, PNG, WEBP, ZIP ou PDF'),
              h('progress', { max: 1, value: 0, hidden: true }),
            ),
        ),
      ),
      h('h4', { class: 'mt' }, 'Linha do tempo'),
      h('ol', { class: 'timeline' }, [...o.timeline].reverse().slice(0, 8).map(t => h('li', {}, h('time', {}, fmtDate(t.at)), t.message))),
    );
  }

  /* ── ações ── */
  const dialog = (() => {
    const box = h('div', { class: 'modal', hidden: true, role: 'dialog', 'aria-modal': 'true' });
    document.addEventListener('DOMContentLoaded', () => document.body.append(box));
    return (content) => new Promise(resolve => {
      const close = v => { box.hidden = true; box.replaceChildren(); resolve(v); };
      box.replaceChildren(h('div', { class: 'card' }, content(close)));
      box.hidden = false;
      box.querySelector('input,textarea,button')?.focus();
    });
  })();

  async function confirmAction(o, text, fn) {
    const ok = await dialog(close => [
      h('h3', { class: 'h-md' }, `Pedido ${o.id}`), h('p', {}, text),
      h('div', { class: 'ac-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => close(false) }, 'Voltar'), h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => close(true) }, 'Confirmar')),
    ]);
    if (!ok) return;
    followId = o.id;
    try { await fn(); await load(); } catch (e) { $('#err').textContent = e.message; }
  }

  async function setStatus(o, status) {
    const msg = await dialog(close => {
      const input = h('input', { id: 'st-msg', maxlength: 200, placeholder: 'Ex.: Roteiro aprovado, gerando as cenas' });
      return [
        h('h3', { class: 'h-md' }, 'Iniciar produção'),
        h('div', { class: 'field' }, h('label', { for: 'st-msg' }, 'Mensagem para o cliente (opcional)'), input),
        h('div', { class: 'ac-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => close(null) }, 'Voltar'), h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => close(input.value) }, 'Confirmar')),
      ];
    });
    if (msg === null) return;
    followId = o.id;
    try { await call(`/api/admin/orders/${o.id}/status`, { method: 'POST', body: { status, message: msg || undefined } }); open.add(o.id); await load(); }
    catch (e) { $('#err').textContent = e.message; }
  }

  async function sendFiles(o, files, input) {
    const bar = input.parentElement.querySelector('progress');
    bar.hidden = false;
    for (const [i, f] of files.entries()) {
      try {
        await upload(`/api/admin/orders/${o.id}/files`, f, { token, label: f.name.replace(/\.[^.]+$/, ''), onProgress: v => { bar.value = (i + v) / files.length; } });
      } catch (e) { $('#err').textContent = `${f.name}: ${e.message}`; }
    }
    open.add(o.id);
    followId = o.id;
    await load();
  }

  async function deliver(o) {
    if (!o.files.length) { open.add(o.id); render(); $('#err').textContent = `Envie os arquivos prontos do pedido ${o.id} antes de entregar (em Detalhes).`; return; }
    await confirmAction(o, `Liberar ${o.files.length} arquivo(s) para o cliente baixar? Depois disso, envie o link pelo WhatsApp.`, () => call(`/api/admin/orders/${o.id}/deliver`, { method: 'POST', body: {} }));
    const fresh = orders.find(x => x.id === o.id);
    if (fresh?.status === 'delivered') shareLink(fresh);
  }

  async function shareLink(o) {
    const go = await dialog(close => [
      h('h3', { class: 'h-md' }, 'Link do cliente'),
      h('p', {}, 'Por segurança, o sistema não guarda o link original. Gerar um novo link invalida o anterior; envie o novo ao cliente.'),
      h('div', { class: 'ac-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => close(false) }, 'Voltar'), h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => close(true) }, 'Gerar novo link')),
    ]);
    if (!go) return;
    let link;
    try { ({ trackUrl: link } = await call(`/api/admin/orders/${o.id}/access-link`, { method: 'POST', body: {} })); }
    catch (e) { $('#err').textContent = e.message; return; }
    const first = o.customer.name.split(/\s+/)[0];
    const text = o.status === 'delivered'
      ? `Olá, ${first}! Seu pedido ${o.id} (${o.packageName}) está pronto. Baixe aqui: ${link}`
      : `Olá, ${first}! Acompanhe seu pedido ${o.id} (${o.packageName}) por aqui: ${link}`;
    const wa = waLink(o.customer.whatsapp, text);
    await dialog(close => [
      h('h3', { class: 'h-md' }, 'Novo link gerado'),
      h('div', { class: 'field' }, h('label', { for: 'share-text' }, 'Mensagem'), h('textarea', { id: 'share-text', readonly: true, class: 'short' }, text)),
      h('div', { class: 'ac-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: async e => { try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copiado ✓'; } catch { document.getElementById('share-text').select(); } } }, 'Copiar mensagem'),
        wa ? h('a', { class: 'btn btn-sm btn-primary', href: wa, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir WhatsApp') : h('span', { class: 'muted small' }, 'Cliente sem WhatsApp — use o e-mail.'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => close() }, 'Fechar'),
      ),
    ]);
  }

  async function copyBrief(o, styles, btn) {
    const b = o.briefing;
    const text = [
      `PEDIDO ${o.id} — ${o.packageName} (${o.deliverables.videos} vídeo(s), ${o.deliverables.images} imagem(ns))`,
      `Estilo: ${styles}`, `Formato: ${b.format}`, `Categoria: ${categoryNames[b.category] || b.category} · Objetivo: ${GOAL_NAMES[b.goal] || b.goal}`,
      `Marca: ${b.brand}`, `Produto: ${b.product}`, `Público: ${b.audience || '-'}`,
      `Mensagem: ${b.message}`, `Chamada final: ${b.cta || '-'}`, b.script ? `Roteiro do cliente:\n${b.script}` : '',
      b.references.length ? `Referências: ${b.references.join(' ')}` : '',
    ].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Briefing copiado ✓'; }
    catch { $('#err').textContent = 'Não consegui copiar automaticamente.'; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    api('/api/catalog').then(c => { styleNames = Object.fromEntries(c.styles.map(s => [s.id, s.name])); categoryNames = Object.fromEntries(c.categories); if (orders.length) render(); }).catch(() => {});
    $('#login').addEventListener('submit', e => {
      e.preventDefault();
      token = $('#tok').value.trim();
      try { sessionStorage.setItem('studio:admin', token); } catch { /* ok */ }
      $('#tok').value = '';
      load();
    });
    $('#logout').addEventListener('click', () => { try { sessionStorage.removeItem('studio:admin'); } catch { /* ok */ } location.reload(); });
    if (token) load();
    // Atualiza a cada 30 s, sem atropelar um modal aberto.
    setInterval(() => { if (token && !document.querySelector('.modal:not([hidden])') && !document.hidden) load(); }, 30_000);
  });
})();
