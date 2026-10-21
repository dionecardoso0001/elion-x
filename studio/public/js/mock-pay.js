(() => {
  const { api } = window.Studio;
  document.addEventListener('DOMContentLoaded', () => {
    const id = new URLSearchParams(location.search).get('id') || '';
    let token = null;
    try { token = localStorage.getItem(`studio:order:${id}`); } catch { /* ok */ }
    document.getElementById('m-id').textContent = id || '—';
    const btn = document.getElementById('m-pay');
    if (!id || !token) { btn.disabled = true; document.getElementById('m-error').textContent = 'Pedido não encontrado neste navegador.'; return; }
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('/api/dev/mock-pay', { method: 'POST', token, body: { id } });
        location.assign(`/pedido.html?id=${encodeURIComponent(id)}&pago=1#t=${token}`);
      } catch (e) { document.getElementById('m-error').textContent = e.message; btn.disabled = false; }
    });
  });
})();
