/* Painel mínimo do operador: ver pedidos, reenviar ao bot e entregar manualmente.
   O token fica só na sessionStorage (some ao fechar a aba). */
(() => {
  const { h, api, brl, fmtDate } = window.Studio;
  const $ = s => document.querySelector(s);
  let token = '';
  try { token = sessionStorage.getItem('studio:admin') || ''; } catch { /* ok */ }

  async function load() {
    $('#err').textContent = '';
    try {
      const list = await api('/api/admin/orders', { token });
      $('#rows').replaceChildren(...(list.length ? list.map(row) : [h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'Nenhum pedido ainda.'))]));
    } catch (e) { $('#err').textContent = e.message; }
  }

  function row(o) {
    const actions = [];
    if (['paid', 'revision_requested'].includes(o.status)) {
      actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => act(`/api/admin/orders/${o.id}/dispatch`) }, 'Reenviar ao bot'));
    }
    if (!['awaiting_payment', 'canceled'].includes(o.status)) {
      actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => deliver(o.id) }, 'Entregar manualmente'));
    }
    return h('tr', {},
      h('td', {}, h('b', {}, o.id), h('br'), h('small', { class: 'muted' }, fmtDate(o.createdAt))),
      h('td', {}, o.customer.name, h('br'), h('small', { class: 'muted' }, o.customer.email, o.customer.whatsapp ? ` · ${o.customer.whatsapp}` : '')),
      h('td', {}, o.packageName, h('br'), h('small', { class: 'muted' }, brl(o.quote.totalCents))),
      h('td', {}, h('span', { class: 'status-pill', 'data-s': o.status }, o.status), h('br'), h('small', { class: 'muted' }, `${o.progress}%`)),
      h('td', {}, o.dispatch ? h('small', {}, `tentativas: ${o.dispatch.attempts}`, o.dispatch.lastError ? h('span', { class: 'muted' }, ` · ${o.dispatch.lastError}`) : '') : '—'),
      h('td', {}, actions),
    );
  }

  async function act(path, body) {
    try { await api(path, { method: 'POST', token, body: body ?? {} }); await load(); }
    catch (e) { $('#err').textContent = e.message; }
  }

  function deliver(id) {
    const raw = prompt('Cole as URLs https dos arquivos, uma por linha (vídeos .mp4/.webm são detectados automaticamente):');
    if (!raw) return;
    const assets = raw.split(/\s*\n\s*/).filter(Boolean).map((url, i) => ({
      url, type: /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'image', label: `Arquivo ${i + 1}`,
    }));
    act(`/api/admin/orders/${id}/deliver`, { assets });
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#login').addEventListener('submit', e => {
      e.preventDefault();
      token = $('#tok').value.trim();
      try { sessionStorage.setItem('studio:admin', token); } catch { /* ok */ }
      $('#tok').value = '';
      load();
    });
    $('#reload').addEventListener('click', load);
    if (token) load();
  });
})();
