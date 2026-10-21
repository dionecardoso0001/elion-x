/* Página do pedido: Pix, fotos do produto, acompanhamento e entrega.
   O token vem no fragmento (#t=…), que o navegador NUNCA envia ao servidor
   nem em Referer — por isso não aparece em log de acesso nem em analytics. */
(() => {
  const { h, api, brl, fmtDate, fmtSize, prepareImage, upload } = window.Studio;
  const $ = s => document.querySelector(s);

  const STATUS = {
    awaiting_payment: 'Aguardando Pix', payment_reported: 'Confirmando pagamento', paid: 'Na fila de produção',
    in_production: 'Em produção', delivered: 'Entregue', revision_requested: 'Ajuste em andamento',
    failed: 'Precisa de atenção', canceled: 'Cancelado',
  };
  const DONE = new Set(['delivered', 'canceled']);
  const STYLE_NAMES = {};

  const params = new URLSearchParams(location.search);
  let id = params.get('id');
  let token = new URLSearchParams(location.hash.slice(1)).get('t');
  let timer = 0, lastKey = '', current = null;

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

  /* Mídia com fallback: se a prévia não carregar, o botão Baixar continua valendo. */
  function media(a) {
    const fallback = el => () => el.replaceWith(h('div', { class: 'media-fallback' }, 'Prévia indisponível neste navegador — use “Baixar”.'));
    if (a.type === 'video') {
      const v = h('video', { src: a.url, controls: true, preload: 'metadata', playsinline: true, poster: a.thumbnail || false });
      v.addEventListener('error', fallback(v), { once: true });
      return v;
    }
    if (a.type === 'image') {
      const img = h('img', { src: a.url, alt: a.label, loading: 'lazy' });
      img.addEventListener('error', fallback(img), { once: true });
      return img;
    }
    return h('div', { class: 'media-fallback file-ico' }, a.ext ? a.ext.toUpperCase() : 'LINK');
  }

  function renderPix(o) {
    const pay = o.payment;
    const show = pay?.method === 'pix' && ['awaiting_payment', 'payment_reported'].includes(o.status);
    $('#o-pix').hidden = !show;
    if (!show) return;
    $('#pix-amount').textContent = brl(pay.amountCents);
    $('#pix-holder').textContent = pay.holder;
    $('#pix-key').textContent = pay.key;
    $('#pix-txid').textContent = pay.txid;
    if ($('#pix-code').value !== pay.copyPaste) {
      $('#pix-code').value = pay.copyPaste;
      try {
        const qr = window.qrcode(0, 'M');
        qr.addData(pay.copyPaste);
        qr.make();
        $('#pix-qr').src = qr.createDataURL(6, 2);
      } catch { $('#pix-qr').alt = 'QR indisponível — use o Pix copia e cola'; }
    }
    const reported = o.status === 'payment_reported';
    $('#pix-report').hidden = reported;
    $('#pix-reported').hidden = !reported;
  }

  function renderPhotos(o) {
    $('#o-photos').replaceChildren(...o.photos.map(p => h('li', { class: 'thumb' },
      h('img', { src: p.url, alt: p.label, loading: 'lazy' }),
      o.canUploadPhotos ? h('button', { type: 'button', class: 'thumb-x', 'aria-label': `Remover ${p.label}`, onclick: () => removePhoto(p.id) }, '×') : null,
    )));
    if (!o.photos.length) $('#o-photos').replaceChildren(h('li', { class: 'muted small' }, o.canUploadPhotos ? 'Nenhuma foto ainda. Envie fotos do produto para a produção ficar fiel.' : 'Nenhuma foto enviada.'));
    $('#o-photo-upload').hidden = !o.canUploadPhotos || o.photos.length >= 8;
  }

  function render(o) {
    current = o;
    $('#access').hidden = true;
    $('#order').hidden = false;
    $('#o-id').textContent = o.id;
    $('#o-title').textContent = `${o.packageName} · ${o.briefing.product}`;
    const pill = $('#o-status');
    pill.dataset.s = o.status;
    pill.textContent = STATUS[o.status] || o.status;
    $('#o-meter').style.width = `${o.progress}%`;
    $('#o-progress-text').textContent = {
      awaiting_payment: 'A produção começa assim que o Pix for confirmado.',
      payment_reported: 'Estamos conferindo o Pix no extrato.',
      delivered: 'Produção concluída.',
      canceled: 'Este pedido foi cancelado.',
    }[o.status] || `${o.progress}% concluído${o.dueAt ? ` · previsão: ${fmtDate(o.dueAt)}` : ''}`;

    const banner = $('#o-banner');
    banner.replaceChildren();
    let failed = 0;
    try { failed = Number(sessionStorage.getItem('studio:photo-failed') || 0); sessionStorage.removeItem('studio:photo-failed'); } catch { /* ok */ }
    if (failed) banner.append(h('div', { class: 'notice warn' }, `${failed} foto(s) não foram enviadas. Adicione de novo abaixo.`));
    if (o.status === 'failed') banner.append(h('div', { class: 'notice warn' }, 'Precisamos falar com você sobre este pedido. Vamos entrar em contato pelo e-mail ', o.customer.email, '.'));

    renderPix(o);
    renderPhotos(o);

    const box = $('#o-assets');
    if (!o.assets.length) {
      box.replaceChildren(h('div', { class: 'card empty' }, ['awaiting_payment', 'payment_reported', 'canceled'].includes(o.status) ? 'Os arquivos aparecem aqui depois da produção.' : '⏳ Seu material está sendo produzido. Esta página atualiza sozinha.'));
    } else {
      box.replaceChildren(h('div', { class: 'gallery' }, o.assets.map(a => h('article', { class: 'asset' },
        media(a),
        h('footer', {},
          h('span', {}, a.label, a.size ? h('small', { class: 'muted' }, ` · ${fmtSize(a.size)}`) : null),
          h('a', { class: 'btn btn-sm', href: a.download || a.url, target: '_blank', rel: 'noopener noreferrer' }, a.type === 'link' ? 'Abrir' : 'Baixar'),
        ),
      ))));
    }

    $('#o-revision').hidden = !(o.status === 'delivered' && o.revisionsLeft > 0);
    $('#o-rev-left').textContent = o.revisionsLeft;

    $('#o-timeline').replaceChildren(...[...o.timeline].reverse().map(t => h('li', {}, h('time', { datetime: t.at }, fmtDate(t.at)), t.message)));

    const styles = Object.entries(o.briefing.styles || {}).map(([m, s]) => `${m === 'video' ? 'Vídeo' : 'Imagem'}: ${STYLE_NAMES[s] || s}`).join(' · ');
    const meta = [
      ['Total', brl(o.quote.totalCents)], ['Estilo', styles || '—'], ['Formato', o.briefing.format],
      ['Entregáveis', [o.deliverables.videos && `${o.deliverables.videos} vídeo(s)`, o.deliverables.images && `${o.deliverables.images} foto(s)`].filter(Boolean).join(' + ')],
      ['Criado em', fmtDate(o.createdAt)],
    ];
    $('#o-meta').replaceChildren(...meta.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  async function refresh() {
    clearTimeout(timer);
    try {
      const o = await api(`/api/orders/${encodeURIComponent(id)}`, { token });
      const key = `${o.updatedAt}|${o.photos.length}`;
      if (key !== lastKey) { lastKey = key; render(o); }
      if (!DONE.has(o.status)) timer = setTimeout(refresh, ['awaiting_payment', 'payment_reported'].includes(o.status) ? 8000 : 15000);
    } catch (e) {
      if (e.status === 404) showAccess('Pedido não encontrado ou link inválido.');
      else timer = setTimeout(refresh, 15000);
    }
  }

  async function addPhotos(files) {
    const err = $('#photo-error');
    err.textContent = '';
    for (const f of files) {
      if (current.photos.length >= 8) { err.textContent = 'Máximo de 8 fotos.'; break; }
      try {
        const blob = await prepareImage(f);
        render(await upload(`/api/orders/${encodeURIComponent(id)}/photos`, blob, { token, label: f.name.replace(/\.[^.]+$/, '') }));
      } catch (e) { err.textContent = e.message; }
    }
  }

  async function removePhoto(photoId) {
    try { render(await api(`/api/orders/${encodeURIComponent(id)}/photos/${photoId}`, { method: 'DELETE', token })); }
    catch (e) { $('#photo-error').textContent = e.message; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Nomes dos estilos para a ficha do pedido (falha silenciosa: mostra o id).
    api('/api/catalog').then(c => { for (const s of c.styles) STYLE_NAMES[s.id] = s.name; if (current) render(current); }).catch(() => {});

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

    $('#pix-copy').addEventListener('click', async e => {
      const code = $('#pix-code');
      try { await navigator.clipboard.writeText(code.value); e.target.textContent = 'Copiado ✓'; }
      catch { code.select(); e.target.textContent = 'Selecionado — copie'; }
      setTimeout(() => { e.target.textContent = 'Copiar'; }, 2500);
    });

    $('#pix-done').addEventListener('click', async e => {
      e.target.disabled = true;
      try {
        render(await api(`/api/orders/${encodeURIComponent(id)}/payment-reported`, { method: 'POST', token, body: { payerName: $('#payer').value } }));
        refresh();
      } catch (err) { $('#o-banner').replaceChildren(h('div', { class: 'notice warn' }, err.message)); }
      finally { e.target.disabled = false; }
    });

    $('#more-photos').addEventListener('change', e => { addPhotos([...e.target.files]); e.target.value = ''; });

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
      catch { e.target.textContent = 'Copie o endereço da barra do navegador'; }
    });

    if (resolveToken()) refresh(); else showAccess();
  });
})();
