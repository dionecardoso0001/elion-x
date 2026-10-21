/* Página do pedido: acompanha a produção e entrega os arquivos.
   O token vem no fragmento (#t=…), que o navegador NUNCA envia ao servidor
   nem em Referer — por isso não aparece em log de acesso nem em analytics. */
(() => {
  const { h, api, brl, fmtDate } = window.Studio;
  const $ = s => document.querySelector(s);

  const STATUS = {
    awaiting_payment: 'Aguardando pagamento', paid: 'Pagamento confirmado', in_production: 'Em produção',
    delivered: 'Entregue', revision_requested: 'Ajuste em produção', failed: 'Falha na produção', canceled: 'Cancelado',
  };
  const DONE = new Set(['delivered', 'failed', 'canceled']);

  const params = new URLSearchParams(location.search);
  let id = params.get('id');
  let token = new URLSearchParams(location.hash.slice(1)).get('t');
  let timer = 0, lastUpdated = '';

  function resolveToken() {
    if (!id) return false;
    if (token) { try { localStorage.setItem(`studio:order:${id}`, token); } catch { /* ok */ } return true; }
    try { token = localStorage.getItem(`studio:order:${id}`); } catch { token = null; }
    if (token) history.replaceState(null, '', `${location.pathname}?id=${encodeURIComponent(id)}#t=${token}`);
    return Boolean(token);
  }

  const trackLink = () => `${location.origin}/pedido.html?id=${encodeURIComponent(id)}#t=${token}`;

  function showAccess(msg) {
    $('#access').hidden = false;
    $('#order').hidden = true;
    if (msg) $('#access-error').textContent = msg;
  }

  /* Mídia com fallback: se o arquivo não carregar na prévia, o botão Baixar continua valendo. */
  function media(a) {
    const el = a.type === 'video'
      ? h('video', { src: a.url, controls: true, preload: 'metadata', playsinline: true, poster: a.thumbnail || false })
      : h('img', { src: a.url, alt: a.label, loading: 'lazy' });
    el.addEventListener('error', () => el.replaceWith(h('div', { class: 'media-fallback' }, 'Prévia indisponível neste navegador — use “Baixar”.')), { once: true });
    return el;
  }

  function render(o) {
    $('#access').hidden = true;
    $('#order').hidden = false;
    $('#o-id').textContent = o.id;
    $('#o-title').textContent = `${o.packageName} · ${o.briefing.product}`;
    const pill = $('#o-status');
    pill.dataset.s = o.status;
    pill.textContent = STATUS[o.status] || o.status;
    $('#o-meter').style.width = `${o.progress}%`;
    $('#o-progress-text').textContent = o.status === 'delivered' ? 'Produção concluída.'
      : o.status === 'awaiting_payment' ? 'A produção começa assim que o pagamento for confirmado.'
      : `${o.progress}% concluído${o.dueAt ? ` · previsão: ${fmtDate(o.dueAt)}` : ''}`;
    $('#o-pay').hidden = o.status !== 'awaiting_payment';

    const banner = $('#o-banner');
    banner.replaceChildren();
    if (params.get('cancelado') && o.status === 'awaiting_payment') {
      banner.append(h('div', { class: 'notice warn' }, 'O pagamento foi cancelado. Você pode voltar e fazer um novo pedido quando quiser.'));
    }
    if (o.status === 'failed') {
      banner.append(h('div', { class: 'notice warn' }, 'Tivemos um problema na produção e a equipe já foi avisada. Você será contatado pelo e-mail ', o.customer.email, '.'));
    }

    // arquivos
    const box = $('#o-assets');
    if (!o.assets.length) {
      box.replaceChildren(h('div', { class: 'card empty' }, o.status === 'awaiting_payment' ? 'Os arquivos aparecem aqui depois da produção.' : '⏳ A IA está trabalhando no seu material. Esta página atualiza sozinha.'));
    } else {
      box.replaceChildren(h('div', { class: 'gallery' }, o.assets.map(a => h('article', { class: 'asset' },
        media(a),
        h('footer', {}, h('span', {}, a.label), h('a', { class: 'btn btn-sm', href: a.url, download: '', target: '_blank', rel: 'noopener noreferrer' }, 'Baixar')),
      ))));
    }

    // ajustes
    const canRevise = o.status === 'delivered' && o.revisionsLeft > 0;
    $('#o-revision').hidden = !canRevise;
    $('#o-rev-left').textContent = o.revisionsLeft;

    // linha do tempo (mais recente primeiro)
    $('#o-timeline').replaceChildren(...[...o.timeline].reverse().map(t => h('li', {}, h('time', { datetime: t.at }, fmtDate(t.at)), t.message)));

    const meta = [
      ['Total', brl(o.quote.totalCents)], ['Formato', o.briefing.format], ['Estilo', o.briefing.style],
      ['Entregáveis', [o.deliverables.videos && `${o.deliverables.videos} vídeo(s)`, o.deliverables.images && `${o.deliverables.images} foto(s)`].filter(Boolean).join(' + ')],
      ['Criado em', fmtDate(o.createdAt)],
    ];
    $('#o-meta').replaceChildren(...meta.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  async function refresh() {
    clearTimeout(timer);
    try {
      const o = await api(`/api/orders/${encodeURIComponent(id)}`, { token });
      if (o.updatedAt !== lastUpdated) { lastUpdated = o.updatedAt; render(o); }
      if (!DONE.has(o.status)) timer = setTimeout(refresh, o.status === 'awaiting_payment' ? 4000 : 8000);
    } catch (e) {
      if (e.status === 404) showAccess('Pedido não encontrado ou link inválido.');
      else timer = setTimeout(refresh, 15000);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#access-form').addEventListener('submit', e => {
      e.preventDefault();
      try {
        const u = new URL($('#access-link').value.trim());
        id = u.searchParams.get('id');
        token = new URLSearchParams(u.hash.slice(1)).get('t');
        if (!id || !token) throw new Error();
        history.replaceState(null, '', `${location.pathname}?id=${encodeURIComponent(id)}#t=${token}`);
        $('#access-error').textContent = '';
        refresh();
      } catch { $('#access-error').textContent = 'Link inválido. Ele deve conter "?id=" e "#t=".'; }
    });

    $('#rev-form').addEventListener('submit', async e => {
      e.preventDefault();
      const note = $('#rev-note').value.trim();
      if (note.length < 10) { $('#rev-error').textContent = 'Descreva o ajuste (mínimo 10 caracteres).'; return; }
      const btn = e.submitter; btn.disabled = true;
      try {
        render(await api(`/api/orders/${encodeURIComponent(id)}/revision`, { method: 'POST', token, body: { note } }));
        $('#rev-note').value = ''; $('#rev-error').textContent = '';
        refresh();
      } catch (err) { $('#rev-error').textContent = err.message; } finally { btn.disabled = false; }
    });

    $('#copy-link').addEventListener('click', async e => {
      try { await navigator.clipboard.writeText(trackLink()); e.target.textContent = 'Link copiado ✓'; }
      catch { prompt('Copie o link:', trackLink()); }
    });

    if (resolveToken()) refresh(); else showAccess();
  });
})();
