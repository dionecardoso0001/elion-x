/* ═══════════════════════════════════════════════════════════════════
   ELION-X v3 — Quadrantes Operacionais
   AGENDA · CLIMA · INTEL IA (notícias) · VISÃO (câmera)
═══════════════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);

  /* ── toasts ── */
  ELX.toast = function (msg, type = '') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 4600);
  };

  const MESES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

  function timeago(ts) {
    if (!ts) return '';
    const d = (Date.now() - ts) / 60000;
    if (d < 1) return 'agora';
    if (d < 60) return `${Math.floor(d)}min`;
    if (d < 1440) return `${Math.floor(d / 60)}h`;
    return `${Math.floor(d / 1440)}d`;
  }

  /* ═════════════════ AGENDA ═════════════════ */
  const agendaList = $('agendaList');
  const notified = new Set(JSON.parse(localStorage.getItem('elx-notified') || '[]'));

  function countdown(item) {
    const diff = new Date(`${item.date}T${item.time}:00`) - Date.now();
    if (diff < -3600000 * 2) return 'expirado';
    if (diff < 0) return 'AGORA';
    const m = diff / 60000;
    if (m < 60) return `em ${Math.ceil(m)}min`;
    if (m < 1440) return `em ${Math.floor(m / 60)}h${Math.floor(m % 60) ? Math.floor(m % 60) + 'm' : ''}`;
    return `em ${Math.floor(m / 1440)}d`;
  }

  function renderAgenda(items, addedId) {
    $('agendaCount').textContent = items.length;
    if (!items.length) {
      agendaList.innerHTML = `<div class="agenda-empty">// NENHUM COMPROMISSO REGISTRADO //<br>diga: "agende reunião amanhã às 15h"</div>`;
      return;
    }
    const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD local
    agendaList.innerHTML = '';
    items.forEach((it, i) => {
      const d = new Date(`${it.date}T${it.time}:00`);
      const diff = d - Date.now();
      const el = document.createElement('div');
      el.className = 'ag-item' + (it.date === today ? ' today' : '') + (diff > 0 && diff < 3600000 ? ' soon' : '')
        + (it.id === addedId ? ' flash' : ''); // automação visível: card recém-preenchido pisca
      el.style.animationDelay = `${i * 60}ms`;
      el.innerHTML = `
        <div class="ag-when"><b>${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]}</b><span>${it.time}</span></div>
        <div class="ag-info"><b><i class="ag-og"></i></b><span>${countdown(it)}</span><em class="ag-extra"></em></div>
        <button class="ag-del" title="remover">✕</button>`;
      const og = el.querySelector('.ag-og');
      og.textContent = it.origin === 'manual' ? '✍ ' : '◈ ';
      og.title = it.origin === 'manual' ? 'digitado manualmente por você' : 'registrado pelo ELION-X';
      el.querySelector('.ag-info b').append(it.title);
      const extra = [it.location ? '⌖ ' + it.location : '', it.notes || ''].filter(Boolean).join(' · ');
      if (extra) el.querySelector('.ag-extra').textContent = extra;
      else el.querySelector('.ag-extra').remove();
      el.querySelector('.ag-del').onclick = async () => {
        await fetch(`/api/agenda?id=${it.id}`, { method: 'DELETE' });
        loadAgenda();
        ELX.toast('Compromisso removido.', 'green');
      };
      agendaList.appendChild(el);
    });
  }

  async function loadAgenda() {
    try {
      const { items } = await fetch('/api/agenda').then(r => r.json());
      renderAgenda(items);
      return items;
    } catch { return []; }
  }

  $('agendaForm').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('agTitle').value.trim();
    if (!title) return;
    await fetch('/api/agenda', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        date: $('agDate').value,
        time: $('agTime').value,
        location: $('agLocal').value.trim(),
        notes: $('agNotes').value.trim(),
        origin: 'manual', // o agente reconhece o que foi digitado pelo operador
      }),
    });
    e.target.reset();
    loadAgenda();
    ELX.toast('Compromisso registrado no quadrante — o ELION-X já o enxerga.', 'green');
  });

  /* lembretes falados — verifica a cada 30s */
  setInterval(async () => {
    if (ELX.state === 'boot') return;
    const items = await loadAgenda();
    for (const it of items) {
      const diff = new Date(`${it.date}T${it.time}:00`) - Date.now();
      if (diff > 0 && diff <= 10 * 60000 && !notified.has(it.id)) {
        notified.add(it.id);
        localStorage.setItem('elx-notified', JSON.stringify([...notified].slice(-80)));
        ELX.toast(`⏰ ${it.title} — ${it.time}`, 'green');
        ELX.voice?.speak(`Senhor, lembrete: ${it.title} em ${Math.round(diff / 60000)} minutos.`);
      }
    }
  }, 30000);

  ELX.agenda = { load: loadAgenda, render: renderAgenda };

  /* ═════════════════ CLIMA ═════════════════ */
  const DIAS = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];

  function renderClima(p) {
    $('climaNow').innerHTML = `
      <div class="cw-main">
        <div class="cw-icon">${p.current.icon}</div>
        <div>
          <div class="cw-temp">${p.current.temp}<sup>°C</sup></div>
          <div class="cw-desc">${p.current.desc}</div>
          <div class="cw-place">${p.viaGPS ? '📡 GPS · ' : '⌖ '}${p.city}${p.region ? ' · ' + p.region : ''} — ${p.country}</div>
        </div>
      </div>
      <div class="cw-meta">
        <div>SENSAÇÃO <b>${p.current.feels}°</b></div>
        <div>UMIDADE <b>${p.current.humidity}%</b></div>
        <div>VENTO <b>${p.current.wind}${p.current.gust ? '/' + p.current.gust : ''} km/h</b></div>
      </div>
      <div class="cw-meta">
        <div>UV MÁX <b>${p.uv != null ? Math.round(p.uv) : '—'}</b></div>
        <div>SOL <b>${p.sunrise || '—'}–${p.sunset || '—'}</b></div>
        <div>${p.nextRain ? `☔ <b>${p.nextRain.hora} (${p.nextRain.prob}%)</b>` : 'SEM CHUVA <b>PRÓX. HORAS</b>'}</div>
      </div>
      ${p.fonte ? `<div style="font-size:9px;opacity:.55;margin-top:4px;letter-spacing:.5px">${/CPTEC|INMET/.test(p.fonte) ? '✓ previsão oficial brasileira · ' : ''}${p.fonte}</div>` : ''}`;
    $('climaDays').innerHTML = p.days.slice(0, 7).map((d, i) => {
      const dt = new Date(d.date + 'T12:00:00');
      return `<div class="cd" style="animation-delay:${i * 60}ms">
        <b>${i === 0 ? 'HOJE' : DIAS[dt.getDay()]}</b><i>${d.icon}</i>
        <span class="mx">${d.max}°</span><span class="mn">${d.min}°</span><span class="rn">☂${d.rain}%</span>
      </div>`;
    }).join('');
  }

  async function loadClima(q) {
    $('climaNow').innerHTML = `<div class="clima-loading">triangulando satélites…</div>`;
    try {
      // sem cidade → GPS do computador (ELX.geo, capturado no boot); sem GPS → servidor decide
      const u = q ? `/api/weather?q=${encodeURIComponent(q)}`
        : (ELX.geo ? `/api/weather?lat=${ELX.geo.lat}&lon=${ELX.geo.lon}` : '/api/weather');
      const p = await fetch(u).then(r => r.json());
      if (p.error) throw new Error(p.error);
      renderClima(p);
    } catch (e) {
      $('climaNow').innerHTML = `<div class="clima-loading">✕ ${e.message}</div>`;
    }
  }
  $('climaGo').onclick = () => { const q = $('climaQ').value.trim(); if (q) loadClima(q); };
  $('climaQ').addEventListener('keydown', e => { if (e.key === 'Enter') $('climaGo').click(); });

  ELX.clima = { load: loadClima, render: renderClima };

  /* ═════════════════ INTEL IA — NOTÍCIAS ═════════════════ */
  const newsList = $('newsList');

  function renderNews(items) {
    if (!items?.length) {
      newsList.innerHTML = `<div class="news-loading">nenhuma transmissão interceptada</div>`;
      return;
    }
    newsList.innerHTML = '';
    items.slice(0, 18).forEach((n, i) => {
      const a = document.createElement('a');
      a.className = 'news-item' + (n.ts && Date.now() - n.ts < 3 * 3600000 ? ' fresh' : '');
      a.href = n.link; a.target = '_blank'; a.rel = 'noopener';
      a.style.animationDelay = `${i * 45}ms`;
      a.innerHTML = `<div class="ni-top"><span class="ni-src"></span><span class="ni-time">${timeago(n.ts)}</span></div><div class="ni-title"></div>`;
      a.querySelector('.ni-src').textContent = n.src;
      a.querySelector('.ni-title').textContent = n.title;
      newsList.appendChild(a);
    });
    $('newsUpdated').textContent = 'sincronizado ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  async function loadNews(force = false) {
    try {
      const { items } = await fetch('/api/news' + (force ? '?force=1' : '')).then(r => r.json());
      renderNews(items);
    } catch {
      newsList.innerHTML = `<div class="news-loading">✕ falha na interceptação</div>`;
    }
  }
  $('newsRefresh').onclick = () => { newsList.innerHTML = `<div class="news-loading">re-sincronizando…</div>`; loadNews(true); };
  setInterval(() => loadNews(), 10 * 60000);

  ELX.news = { load: loadNews, render: renderNews };

  /* ═════════════════ VISÃO — CÂMERA ═════════════════ */
  const video = $('camVideo'), shade = $('camShade'), dot = $('camDot');
  const camToggle = $('camToggle'), camScanBtn = $('camScan'), camOut = $('camOut');
  const scanline = $('camScanline'), grab = $('grabCanvas');
  const overlay = $('camOverlay'), camStatsEl = $('camStats'), camView = video.parentElement;
  const camSelect = $('camSelect');
  const octx = overlay.getContext('2d');
  let camStream = null, overlayTimer = null;
  let camDeviceId = localStorage.getItem('elx-cam-device') || ''; // câmera escolhida (persiste)

  /* lista as câmeras instaladas (integrada + USB/cabo) e popula o seletor */
  async function listCameras() {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      if (!devs.length) return;
      const cur = camSelect.value;
      camSelect.innerHTML = '';
      devs.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        // os rótulos só vêm após a 1ª permissão; antes disso usa um nome genérico
        o.textContent = d.label || `Câmera ${i + 1}`;
        camSelect.appendChild(o);
      });
      // mantém a escolha salva, se ainda existir
      if (camDeviceId && devs.some(d => d.deviceId === camDeviceId)) camSelect.value = camDeviceId;
      else if (cur && devs.some(d => d.deviceId === cur)) camSelect.value = cur;
    } catch {}
  }

  async function camStart() {
    if (camStream) return true;
    try {
      const video_c = camDeviceId
        ? { deviceId: { exact: camDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };
      camStream = await navigator.mediaDevices.getUserMedia({ video: video_c });
      video.srcObject = camStream;
      await video.play().catch(() => {});
      shade.classList.add('off');
      dot.classList.add('rec');
      camView.classList.add('live');
      camToggle.textContent = 'DESLIGAR SENSOR';
      camScanBtn.disabled = false;
      $('ledCam')?.classList.add('on');
      await listCameras();             // agora com permissão, popula nomes reais
      ELX.face?.ensure().catch(() => {}); // pré-carrega os modelos de reconhecimento facial
      await new Promise(r => setTimeout(r, 750)); // aquecimento do sensor
      return true;
    } catch (e) {
      // se a câmera escolhida sumiu (cabo desconectado), tenta a padrão
      if (camDeviceId && /OverconstrainedError|NotFoundError/.test(e.name + e.message)) {
        camDeviceId = ''; localStorage.removeItem('elx-cam-device');
        ELX.toast('Câmera selecionada indisponível — usando a padrão.', 'red');
        return camStart();
      }
      ELX.toast('Acesso à câmera negado: ' + e.message, 'red');
      return false;
    }
  }

  /* troca de câmera ao vivo (reinicia o stream com o novo dispositivo) */
  async function switchCamera(deviceId) {
    camDeviceId = deviceId || '';
    if (deviceId) localStorage.setItem('elx-cam-device', deviceId);
    else localStorage.removeItem('elx-cam-device');
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; video.srcObject = null; }
    const wasOff = !camView.classList.contains('live');
    await camStart();
    if (!wasOff) ELX.toast('Câmera trocada.', 'green');
  }
  camSelect.onchange = () => switchCamera(camSelect.value);

  /* troca por VOZ — interpreta "usb / externa / alta definição / integrada / notebook" */
  const isIntegrated = label => /integr|built|interna|notebook|laptop|hd ?webcam|facetime|embut/i.test(label || '');
  async function switchByHint(hint = '') {
    const h = (hint || '').toLowerCase();
    if (!camStream) await camStart(); // garante permissão p/ obter os rótulos reais
    let devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    await listCameras();
    if (!devs.length) { ELX.toast('Nenhuma câmera detectada.', 'red'); return { ok: false, msg: 'nenhuma câmera detectada' }; }

    // "MX" / "êmê équis" / "eme equis" / "m x" = câmera externa do operador
    const isMX = /\bmx\b|m\s*x|êmê?\s*[ée]qu[ií]?[xs]|eme\s*equ[ií]?[xs]|emex/.test(h);
    let target = null;
    if (/integr|interna|notebook|built|embut|do note|laptop/.test(h)) {
      target = devs.find(d => isIntegrated(d.label)) || devs[0];
    } else if (isMX || /usb|extern|cabo|alta|hd|4k|defini|principal|melhor|boa/.test(h)) {
      target = devs.find(d => /\bmx\b/i.test(d.label)) || devs.find(d => /usb/i.test(d.label)) || devs.find(d => !isIntegrated(d.label)) || devs[devs.length - 1];
    } else if (h) {
      target = devs.find(d => (d.label || '').toLowerCase().includes(h));
    }
    if (!target) target = devs.find(d => !isIntegrated(d.label)) || devs[0];

    await switchCamera(target.deviceId);
    const nome = target.label || 'câmera selecionada';
    ELX.toast('Câmera ativa: ' + nome, 'green');
    return { ok: true, msg: nome };
  }

  // popula a lista no carregamento (nomes genéricos até a 1ª permissão) e quando um cabo é plugado/removido
  listCameras();
  navigator.mediaDevices?.addEventListener?.('devicechange', listCameras);

  /* ── overlay de visão computacional: boxes + pontos analíticos estilo HUD ── */
  const COLORS = { pessoa: '#00e5ff', animal: '#00ff9d', objeto: '#ffc44d' };

  // mapeia coords normalizadas do frame (0-1) para o display, compensando object-fit: cover
  function mapBox(b) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const dw = overlay.width, dh = overlay.height;
    if (!vw || !vh) return { x: b.x * dw, y: b.y * dh, w: b.w * dw, h: b.h * dh };
    const scale = Math.max(dw / vw, dh / vh);
    const offX = (dw - vw * scale) / 2, offY = (dh - vh * scale) / 2;
    return { x: b.x * vw * scale + offX, y: b.y * vh * scale + offY, w: b.w * vw * scale, h: b.h * vh * scale };
  }

  function drawTargets(subjects) {
    overlay.width = camView.clientWidth;
    overlay.height = camView.clientHeight;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (!subjects?.length) return;
    octx.font = '700 10px Orbitron, monospace';
    subjects.forEach((s, idx) => {
      if (!s.box) return;
      const { x, y, w, h } = mapBox(s.box);
      const c = s.recognized ? '#00ff9d' : (s.name === null && s.face ? '#ffc44d' : (COLORS[s.type] || COLORS.objeto));
      const cl = Math.max(10, Math.min(w, h) * 0.28); // tamanho do "L" dos cantos
      octx.strokeStyle = c; octx.fillStyle = c; octx.shadowColor = c; octx.shadowBlur = 8; octx.lineWidth = 1.6;
      // cantos em L
      [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, sx, sy]) => {
        octx.beginPath();
        octx.moveTo(cx, cy + sy * cl); octx.lineTo(cx, cy); octx.lineTo(cx + sx * cl, cy); octx.stroke();
      });
      // moldura tênue
      octx.globalAlpha = 0.25; octx.strokeRect(x, y, w, h); octx.globalAlpha = 1;
      // crosshair central + pontos analíticos nos "landmarks"
      const cx = x + w / 2, cy = y + h / 2;
      octx.beginPath(); octx.moveTo(cx - 5, cy); octx.lineTo(cx + 5, cy); octx.moveTo(cx, cy - 5); octx.lineTo(cx, cy + 5); octx.stroke();
      if (s.type === 'pessoa') {
        // pontos aproximados: olhos, nariz, boca
        [[0.34, 0.42], [0.66, 0.42], [0.5, 0.58], [0.38, 0.74], [0.62, 0.74]].forEach(([px, py]) => {
          octx.beginPath(); octx.arc(x + w * px, y + h * py, 1.7, 0, 7); octx.fill();
        });
      }
      octx.shadowBlur = 0;
      // etiqueta — nome reconhecido (família) tem prioridade
      let tag;
      if (s.name) {
        tag = `✓ ${s.name.toUpperCase()}${s.relation ? ' · ' + s.relation.toUpperCase() : ''}${s.emotion ? ' · ' + s.emotion.toUpperCase() : ''}`;
      } else if (s.face) {
        tag = `? DESCONHECIDO${s.emotion ? ' · ' + s.emotion.toUpperCase() : ''}`;
      } else if (s.type === 'pessoa') {
        tag = `${(s.label || 'PESSOA').toUpperCase()} · ${s.age || '?'} · ${(s.emotion || '—').toUpperCase()}`;
      } else {
        tag = `${(s.label || s.type).toUpperCase()}${s.emotion ? ' · ' + s.emotion.toUpperCase() : ''}`;
      }
      const tw = octx.measureText(tag).width + 12;
      const ty = y > 16 ? y - 16 : y + h + 2;
      octx.fillStyle = 'rgba(1,11,22,.82)'; octx.fillRect(x, ty, tw, 14);
      octx.fillStyle = c; octx.fillRect(x, ty, 2, 14);
      octx.fillStyle = '#dffaff'; octx.fillText(tag, x + 6, ty + 10);
    });
  }

  function clearTargets() { octx.clearRect(0, 0, overlay.width, overlay.height); }
  // re-render ao redimensionar mantém alinhamento
  let lastSubjects = [];
  new ResizeObserver(() => { if (lastSubjects.length) drawTargets(lastSubjects); }).observe(camView);

  function renderVisionStats(scene) {
    const p = scene?.peopleCount ?? 0, a = scene?.animalCount ?? 0;
    camStatsEl.innerHTML =
      `<div class="st"><b>${p}</b><span>pessoas</span></div>` +
      `<div class="st green"><b>${a}</b><span>animais</span></div>` +
      `<div class="st"><b>${lastSubjects.length}</b><span>alvos</span></div>`;
    camStatsEl.classList.add('show');
  }

  function renderVisionReport(data, faces) {
    const subs = data.subjects || [];
    let html = '';
    // rostos reconhecidos pela biometria (no topo)
    if (faces && faces.length) {
      html += faces.map(f => f.name
        ? `<div class="vsubj animal"><b>✓ ${esc(f.name)}</b><span class="vtag">${esc(f.relation || 'reconhecido')}</span>${f.confidence != null ? `<span class="vtag">${f.confidence}%</span>` : ''}${f.emotion ? `<span class="vtag">☉ ${esc(f.emotion)}</span>` : ''}</div>`
        : `<div class="vsubj objeto"><b>? Rosto não reconhecido</b>${f.emotion ? `<span class="vtag">☉ ${esc(f.emotion)}</span>` : ''}<span class="vb">peça para memorizar com "esse é o(a) fulano(a)"</span></div>`
      ).join('');
    }
    if (subs.length) {
      html += subs.map(s => {
        const tags = [];
        if (s.age) tags.push(`⌖ ${s.age}`);
        if (s.gender) tags.push(s.gender);
        if (s.emotion) tags.push(`☉ ${s.emotion}`);
        if (typeof s.confidence === 'number') tags.push(`${Math.round(s.confidence * 100)}%`);
        return `<div class="vsubj ${s.type}"><b>${esc(s.label || s.type)}</b>` +
          tags.map(t => `<span class="vtag">${esc(t)}</span>`).join('') +
          (s.clothing ? `<span class="vb">⛛ veste: ${esc(s.clothing)}</span>` : '') +
          (s.behavior ? `<span class="vb">▸ ${esc(s.behavior)}</span>` : '') +
          (s.attributes?.length ? `<span class="vb">${esc(s.attributes.join(' · '))}</span>` : '') +
          `</div>`;
      }).join('');
    }
    if (data.scene?.interaction) html += `<div class="vsubj objeto"><b>Interação</b><span class="vb">${esc(data.scene.interaction)}</span></div>`;
    html += `<div style="margin-top:6px" class="vh">► ${esc(data.narration || '')}</div>`;
    camOut.innerHTML = html;
    camOut.scrollTop = 0;
  }
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function camStop() {
    camStream?.getTracks().forEach(t => t.stop());
    camStream = null;
    video.srcObject = null;
    shade.classList.remove('off');
    dot.classList.remove('rec');
    camView.classList.remove('live');
    camToggle.textContent = 'ATIVAR SENSOR';
    camScanBtn.disabled = true;
    $('ledCam')?.classList.remove('on');
    clearTimeout(overlayTimer);
    lastSubjects = []; clearTargets();
    camStatsEl.classList.remove('show');
    if (qCam.classList.contains('cam-expanded')) camExpand(false); // fechar câmera = reduz a tela também
  }

  camToggle.onclick = () => (camStream ? camStop() : camStart());

  /* ── MODO AMPLIADO: câmera numa tela grande centralizada (campo de visão maior) ── */
  const qCam = $('qCam'), camBackdrop = $('camBackdrop'), camExpandBtn = $('camExpand');
  function camExpand(on) {
    const want = on == null ? !qCam.classList.contains('cam-expanded') : !!on;
    qCam.classList.toggle('cam-expanded', want);
    if (camBackdrop) camBackdrop.hidden = !want;
    if (camExpandBtn) camExpandBtn.textContent = want ? '⤡' : '⛶';
    // reajusta o overlay ao novo tamanho e re-desenha os alvos
    setTimeout(() => {
      overlay.width = camView.clientWidth; overlay.height = camView.clientHeight;
      if (lastSubjects.length) drawTargets(lastSubjects);
    }, 80);
    return want;
  }
  camExpandBtn && (camExpandBtn.onclick = () => camExpand());
  camBackdrop && (camBackdrop.onclick = () => camExpand(false));      // clicar fora reduz
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && qCam.classList.contains('cam-expanded')) camExpand(false); });

  /** captura frame atual → { data (base64 sem prefixo), mediaType } */
  function camCapture() {
    if (!camStream || !video.videoWidth) return null;
    const W = 768;
    const H = Math.round(W * video.videoHeight / video.videoWidth);
    grab.width = W; grab.height = H;
    grab.getContext('2d').drawImage(video, 0, 0, W, H);
    const dataUrl = grab.toDataURL('image/jpeg', 0.82);
    return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
  }

  /**
   * Núcleo da visão computacional: captura, analisa via /api/vision,
   * desenha o overlay de pontos analíticos e monta o relatório.
   * @returns {Promise<object>} dados estruturados ({narration, subjects, scene})
   */
  async function analyzeFrame({ prompt = '', speak = true } = {}) {
    const ok = await camStart();
    if (!ok) throw new Error('câmera indisponível');
    if (!qCam.classList.contains('cam-expanded')) camExpand(true); // análise abre em tela ampliada
    scanline.classList.add('scan');
    camOut.innerHTML = `<span class="vh">► VARREDURA ÓPTICA EM ANDAMENTO…</span><span class="vb">algoritmos IoT · estimando emoção facial, vestimenta e comportamento</span>`;
    if (ELX.state !== 'live') ELX.setState('thinking');
    try {
      const frame = camCapture();
      if (!frame) throw new Error('sem frame disponível');

      // RECONHECIMENTO FACIAL (biometria local) — melhor esforço, não trava a visão
      let faces = [];
      if (ELX.face?.ready) { try { faces = await ELX.face.recognize(video); } catch {} }
      const known = faces.map(f => ({ name: f.name, relation: f.relation, emotion: f.emotion, confidence: f.confidence }));

      const d = await fetch('/api/vision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: frame.data, mediaType: frame.mediaType, prompt, known }),
      }).then(r => r.json());
      if (d.error) throw new Error(d.error);

      // overlay: rostos reconhecidos (precisos, com nome) + objetos/animais do Claude
      const faceSubjects = faces.map(f => ({
        box: f.box, type: 'pessoa', face: true, recognized: f.known,
        name: f.name, relation: f.relation, emotion: f.emotion, confidence: f.confidence,
      }));
      const others = (d.subjects || []).filter(s => s.type !== 'pessoa');
      lastSubjects = faceSubjects.length ? faceSubjects.concat(others) : (d.subjects || []);
      drawTargets(lastSubjects);
      renderVisionStats(d.scene);
      renderVisionReport(d, faces);
      // overlay permanece ~14s, depois esvanece
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(() => { lastSubjects = []; clearTargets(); }, 14000);

      if (speak && d.narration) ELX.voice?.speak(d.narration);
      return d;
    } catch (e) {
      camOut.innerHTML = `<span style="color:var(--red)">✕ Falha na análise: ${esc(e.message)}</span>`;
      if (ELX.state === 'thinking') ELX.setState('idle');
      ELX.toast('Visão indisponível: ' + e.message, 'red');
      throw e;
    } finally {
      scanline.classList.remove('scan');
    }
  }

  // botão "ANALISAR CENA" — fala a narração diretamente
  camScanBtn.onclick = () => analyzeFrame({ speak: true }).catch(() => {});

  /** cadastra o rosto visível na câmera (reconhecimento biométrico da família) */
  async function enrollFace(name, relation) {
    const ok = await camStart();
    if (!ok) return { ok: false, msg: 'câmera indisponível' };
    if (!ELX.face) return { ok: false, msg: 'reconhecimento facial não disponível neste navegador' };
    scanline.classList.add('scan');
    camOut.innerHTML = `<span class="vh">► CADASTRANDO ROSTO: ${esc(name)}…</span>`;
    try {
      await ELX.face.ensure();
      await new Promise(r => setTimeout(r, 400));
      const r = await ELX.face.enroll(name, relation, video);
      if (r.ok) { ELX.toast(`✓ Rosto de ${name} memorizado.`, 'green'); camOut.innerHTML = `<span class="vh">✓ ${esc(name)}${relation ? ' (' + esc(relation) + ')' : ''} memorizado no reconhecimento facial.</span>`; }
      else ELX.toast(r.msg, 'red');
      return r;
    } catch (e) { ELX.toast('Falha ao memorizar: ' + e.message, 'red'); return { ok: false, msg: e.message }; }
    finally { scanline.classList.remove('scan'); }
  }

  ELX.cam = {
    get on() { return !!camStream; },
    get expanded() { return qCam.classList.contains('cam-expanded'); },
    start: camStart, stop: camStop, capture: camCapture, expand: camExpand,
    analyze: analyzeFrame,                       // usado pelo agente (speak:false) e pelo botão
    scan: prompt => analyzeFrame({ prompt, speak: true }),
    enroll: enrollFace,                          // cadastro facial
    setOut: t => { camOut.textContent = t; },
    scanFx: on => scanline.classList.toggle('scan', !!on),
    list: listCameras, switch: switchCamera, switchByHint, // gerência de múltiplas câmeras (UI + voz)
  };

  /* ═════════════════ VISOR WEB — segunda tela embutida ═════════════════ */
  const wv = $('webVisor'), wvTitle = $('wvTitle'), wvFrame = $('wvFrame'),
        wvReader = $('wvReader'), wvLoading = $('wvLoading'),
        wvMode = $('wvMode'), wvOpenBtn = $('wvOpen'), wvCloseBtn = $('wvClose');
  let wvUrl = '', wvShowingReader = false, wvFrameable = false;
  const wesc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  /* ESCADA DE TENTATIVAS. O defeito que este bloco corrige: quando o site
     recusava ser embutido, o quadro ficava BRANCO e ninguém era avisado — o
     operador ficava olhando para o nada sem saber se carregava ou se falhara.
     Agora toda tentativa tem um degrau abaixo dela, e o último degrau é uma
     mensagem honesta, nunca o vazio.
       direto → proxy → leitura → aviso com saída para o navegador real     */
  let wvEtapa = '', wvGuarda = 0, wvPedido = 0;
  const wvPara = () => { clearTimeout(wvGuarda); wvGuarda = 0; };

  function wvHide() {
    wvPara(); wvPedido++;                       // invalida respostas em voo
    wv.classList.add('closing');
    setTimeout(() => { wv.hidden = true; wv.classList.remove('closing'); wvFrame.src = 'about:blank'; wvReader.innerHTML = ''; }, 360);
  }

  /* BUSCA QUE ABRE DE VERDADE. O Google recusa ser embutido E monta os
     resultados por script próprio — pelos dois motivos o quadro ficava branco
     justamente no pedido mais comum ("pesquise o site sobre X"). Raspar outro
     buscador não salva: o DuckDuckGo devolve um desafio de patinhos ao proxy.
     Então não raspo ninguém — uso a busca por API que a plataforma já tem e
     monto a página de resultados aqui dentro. */
  function wvTermoBusca(u) {
    try {
      const a = new URL(u), h = a.hostname.replace(/^www\./, '');
      const termo = a.searchParams.get('q') || a.searchParams.get('p') || a.searchParams.get('query');
      const ehBusca = /^(google\.|bing\.com|duckduckgo\.com|search\.yahoo|search\.brave)/.test(h)
                   && (/\/search|\/html|\/lite/.test(a.pathname) || a.pathname === '/');
      return ehBusca && termo ? termo : '';
    } catch { return ''; }
  }

  /* Página de resultados montada no painel: cada item abre no visor com um
     clique, então a busca leva ao site em vez de terminar em si mesma. */
  async function wvBuscaPainel(termo) {
    wvPara();
    wvEtapa = 'busca'; wvShowingReader = true;
    wvMode.style.display = 'none';
    wvFrame.style.display = 'none'; wvFrame.src = 'about:blank';
    wvReader.hidden = false; wvLoading.classList.add('off');
    wvTitle.textContent = ('BUSCA · ' + termo).slice(0, 90);
    wvReader.innerHTML = `<h1>Buscando “${wesc(termo)}”…</h1>`;
    const meu = wvPedido;
    try {
      const d = await fetch(`/api/websearch?q=${encodeURIComponent(termo)}`).then(r => r.json());
      if (meu !== wvPedido) return;
      if (d.error) throw new Error(d.error);
      if (!d.results?.length) throw new Error('a busca não retornou resultados');
      wvReader.innerHTML =
        `<h1>Resultados para “${wesc(termo)}”</h1>` +
        (d.answer ? `<p style="border-left:2px solid #2f8fd0;padding-left:12px">${wesc(d.answer)}</p>` : '') +
        d.results.map((it, i) =>
          `<p><a href="#" data-wv="${wesc(it.url)}" style="color:#7ec8f0;text-decoration:none">` +
          `${i + 1}. ${wesc(it.title)}</a><br><span class="wr-site">⌖ ${wesc(it.site)}</span><br>` +
          `<span style="opacity:.75">${wesc(it.snippet)}</span></p>`).join('');
      wvReader.scrollTop = 0;
    } catch (e) {
      if (meu !== wvPedido) return;
      wvFalha('a busca não pôde ser exibida', e.message);
    }
  }

  // clique num resultado abre aquele site no próprio visor
  wvReader.addEventListener('click', ev => {
    const a = ev.target.closest('a[data-wv]');
    if (!a) return;
    ev.preventDefault();
    webOpen(a.dataset.wv, a.textContent.replace(/^\d+\.\s*/, ''));
  });

  const wvMidia = u => /\.(mp4|webm|mov|m4v|mp3|wav|ogg|png|jpe?g|gif|webp|avif|svg|pdf)(\?|#|$)/i.test(u);

  async function webOpen(url, title) {
    const meu = ++wvPedido;                     // cada abertura cancela a anterior
    wvPara();
    wvUrl = url;
    wv.hidden = false;
    wv.classList.remove('closing');
    wvMode.style.display = ''; wvOpenBtn.style.display = ''; // restaura (o modo email os esconde)
    wvTitle.textContent = (title || url).slice(0, 90);
    wvLoading.classList.remove('off');
    wvFrame.src = 'about:blank';
    wvReader.hidden = true; wvReader.innerHTML = '';
    // URL de buscador não vira página embutida: vira lista de resultados
    const termo = wvTermoBusca(url);
    if (termo) return wvBuscaPainel(termo);
    /* Vídeo, imagem e PDF o navegador já exibe sozinho — o teste de iframe não
       se aplica e o modo leitura não teria texto para extrair. Vão direto.
       (É por aqui que passa o vídeo gerado pela SkyReels.) */
    if (wvMidia(url)) { wvFrameable = true; wvSite(); return; }
    // detecta se o site aceita iframe direto; se não, o modo SITE usará o proxy do servidor
    wvFrameable = false;
    try { ({ frameable: wvFrameable } = await fetch(`/api/framecheck?url=${encodeURIComponent(url)}`).then(r => r.json())); } catch {}
    if (meu !== wvPedido) return;               // o operador já pediu outro site
    wvSite(); // sempre abre a PÁGINA INTEIRA (direto ou via proxy)
  }

  // mostra o site completo renderizado: direto quando permitido, via /api/proxy quando bloqueado
  function wvSite() {
    wvPara();
    wvShowingReader = false;
    wvMode.textContent = 'LEITURA';
    wvReader.hidden = true;
    wvFrame.style.display = '';
    wvLoading.classList.remove('off');
    wvEtapa = wvFrameable ? 'direto' : 'proxy';
    const meu = wvPedido;
    // carregou → DESARMA o cão de guarda. Sem isto ele morderia a própria
    // página que deu certo, oito segundos depois de ela já estar na tela.
    wvFrame.onload = () => { if (meu === wvPedido) { wvPara(); wvLoading.classList.add('off'); } };
    wvFrame.src = wvFrameable ? wvUrl : ('/api/proxy?url=' + encodeURIComponent(wvUrl));
    /* Cão de guarda. O navegador NÃO avisa em JavaScript quando recusa um
       quadro por X-Frame-Options — ele apenas não pinta nada. Só o silêncio
       denuncia a recusa, então é o silêncio que eu vigio.
       Mídia fica de fora: um vídeo pesado demora legitimamente, e derrubá-lo
       para o modo leitura (que não tem texto para extrair) inventaria uma
       falha onde só havia paciência. */
    if (wvMidia(wvUrl)) { wvMode.style.display = 'none'; return; }
    wvGuarda = setTimeout(() => { if (meu === wvPedido) wvDesce('o site não respondeu a tempo'); }, 8000);
  }

  /* Desce um degrau da escada, dizendo por quê. */
  function wvDesce(motivo) {
    wvPara();
    if (wvEtapa === 'direto') {                 // o site recusou o quadro → tenta pelo servidor
      wvEtapa = 'proxy';
      const meu = wvPedido;
      wvFrame.onload = () => { if (meu === wvPedido) { wvPara(); wvLoading.classList.add('off'); } };
      wvFrame.src = '/api/proxy?url=' + encodeURIComponent(wvUrl);
      wvGuarda = setTimeout(() => { if (meu === wvPedido) wvDesce('o servidor do site não entregou a página'); }, 9000);
      return;
    }
    wvReaderMode(motivo);                       // proxy também falhou → modo leitura
  }

  /* O proxy fala com o visor quando topa captcha ou casca vazia — sem isso o
     quadro exibiria o quebra-cabeça anti-robô, que para o operador é o mesmo
     que branco. */
  window.addEventListener('message', ev => {
    if (ev.origin !== location.origin || ev.data?.elx !== 'visor') return;
    if (ev.data.estado === 'barreira') { wvEtapa = 'proxy'; wvDesce('o site exigiu verificação anti-robô'); }
    if (ev.data.estado === 'vazio')    { wvEtapa = 'proxy'; wvDesce('a página só monta com JavaScript próprio'); }
    if (ev.data.estado === 'falha')    { wvEtapa = 'proxy'; wvDesce(ev.data.motivo || 'o site não pôde ser alcançado'); }
  });

  async function wvReaderMode(motivo) {
    wvPara();
    wvEtapa = 'leitura';
    wvShowingReader = true;
    wvMode.textContent = 'SITE';
    wvFrame.style.display = 'none';
    wvFrame.src = 'about:blank';
    wvReader.hidden = false;
    // quando cheguei aqui caindo de um degrau acima, DIGO o motivo — o operador
    // precisa saber que houve um desvio, e não achar que o visor é assim mesmo
    const nota = motivo ? `<div class="wr-site">⚠ ${wesc(motivo)} — mostrando o texto da página</div>` : '';
    wvReader.innerHTML = nota + '<p style="opacity:.55">extraindo conteúdo da página…</p>';
    wvLoading.classList.add('off');
    const meu = wvPedido;
    try {
      const d = await fetch(`/api/reader?url=${encodeURIComponent(wvUrl)}`).then(r => r.json());
      if (meu !== wvPedido) return;
      if (d.error) throw new Error(d.error);
      if (!d.paragraphs?.length && !d.desc) throw new Error('a página não expôs texto legível');
      wvTitle.textContent = (d.title || wvUrl).slice(0, 90);
      wvReader.innerHTML = nota +
        `<h1>${wesc(d.title)}</h1><div class="wr-site">⌖ ${wesc(d.site)}</div>` +
        (d.image ? `<img src="${wesc(d.image)}" alt="" onerror="this.remove()">` : '') +
        (d.paragraphs?.length
          ? d.paragraphs.map(p => `<p>${wesc(p)}</p>`).join('')
          : `<p>${wesc(d.desc)}</p>`);
      wvReader.scrollTop = 0;
    } catch (e) {
      if (meu !== wvPedido) return;
      wvFalha(motivo, e.message);
    }
  }

  /* ÚLTIMO DEGRAU. Aqui a plataforma admite a derrota em voz alta e entrega uma
     saída utilizável. Nunca deixar o quadro em branco: branco não informa nada
     e faz o operador esperar por algo que não vem. */
  function wvFalha(motivo, detalhe) {
    wvFrame.style.display = 'none'; wvFrame.src = 'about:blank';
    wvReader.hidden = false; wvLoading.classList.add('off');
    let host = wvUrl; try { host = new URL(wvUrl).hostname.replace(/^www\./, ''); } catch {}
    wvReader.innerHTML =
      `<h1>Não consegui exibir ${wesc(host)} aqui dentro</h1>` +
      `<div class="wr-site">⌖ ${wesc(host)}</div>` +
      (motivo  ? `<p>Motivo: ${wesc(motivo)}.</p>` : '') +
      (detalhe ? `<p style="opacity:.6">Detalhe técnico: ${wesc(detalhe)}</p>` : '') +
      `<p>Este site protege o conteúdo contra exibição dentro de outra página. ` +
      `Abra no navegador para vê-lo por inteiro:</p>` +
      `<p><a href="${wesc(wvUrl)}" target="_blank" rel="noopener" ` +
      `style="display:inline-block;margin-top:6px;padding:9px 16px;border:1px solid #2f8fd0;` +
      `border-radius:8px;color:#9bd0ee;text-decoration:none">↗ ABRIR EM NOVA ABA</a></p>`;
    wvReader.scrollTop = 0;
    try { ELX.toast?.(`Visor: ${host} bloqueou a exibição embutida. Abra em nova aba pelo ↗.`, 'amber'); } catch {}
  }

  wvMode.onclick = () => (wvShowingReader ? wvSite() : wvReaderMode());
  wvOpenBtn.onclick = () => wvUrl && window.open(wvUrl, '_blank', 'noopener');
  wvCloseBtn.onclick = wvHide;

  /* abre uma página LOCAL (mesmo origin) no visor, com interatividade total — sem proxy */
  function webOpenLocal(path, title) {
    // cancela qualquer escada em curso: página local é do mesmo origin, sempre
    // carrega, e não deve herdar o cão de guarda de um site externo anterior
    wvPara(); wvPedido++; wvEtapa = 'local';
    wvUrl = path; wvFrameable = true; wvShowingReader = false;
    wv.hidden = false; wv.classList.remove('closing');
    wvMode.style.display = 'none'; wvOpenBtn.style.display = '';
    wvTitle.textContent = title || path;
    wvReader.hidden = true; wvReader.innerHTML = '';
    wvFrame.style.display = '';
    wvLoading.classList.remove('off');
    wvFrame.onload = () => wvLoading.classList.add('off');
    wvFrame.src = path;
    setTimeout(() => wvLoading.classList.add('off'), 4000);
  }

  ELX.web = { open: webOpen, openLocal: webOpenLocal, close: wvHide };
  ELX.whatsapp = { open: () => webOpenLocal('/whatsapp.html?v=' + Date.now(), 'WHATSAPP · ELION-X') }; // ?v= fura o cache do navegador — painel sempre na versão atual

  /* ═════════════════ SEGUNDO CÉREBRO — janela do Painel de Controle ═════════════════ */
  let brainWin = null;
  ELX.brain = {
    open() {
      try { brainWin = window.open('/brain.html', 'elion-brain'); } catch { brainWin = null; }
      if (brainWin) { ELX.toast('Painel de Controle aberto — segundo cérebro do ELION-X.', 'green'); return 'window'; }
      webOpenLocal('/brain.html?v=' + Date.now(), 'PAINEL DE CONTROLE · SEGUNDO CÉREBRO'); // popup bloqueado → abre no visor
      return 'visor';
    },
    isOpen() { return !!(brainWin && !brainWin.closed) || (!wv.hidden && /brain\.html/.test(wvUrl)); },
    close() {
      let closed = false;
      if (brainWin && !brainWin.closed) { try { brainWin.close(); } catch {} closed = true; }
      brainWin = null;
      if (!wv.hidden && /brain\.html/.test(wvUrl)) { wvHide(); closed = true; } // caso tenha aberto no visor
      return closed;
    },
  };

  /* ═════════════════ CYBER DEFENSE GRID — console tático de segurança ═════════════════ */
  let cyberWin = null;
  ELX.cyber = {
    open() {
      try { cyberWin = window.open('/cyber.html', 'elion-cyber'); } catch { cyberWin = null; }
      if (cyberWin) { ELX.toast('Cyber Defense Grid aberto — monitoramento de ameaças ativo.', 'green'); return 'window'; }
      webOpenLocal('/cyber.html?v=' + Date.now(), 'CYBER DEFENSE GRID · DETECÇÃO DE AMEAÇAS');
      return 'visor';
    },
    isOpen() { return !!(cyberWin && !cyberWin.closed) || (!wv.hidden && /cyber\.html/.test(wvUrl)); },
    close() {
      let closed = false;
      if (cyberWin && !cyberWin.closed) { try { cyberWin.close(); } catch {} closed = true; }
      cyberWin = null;
      if (!wv.hidden && /cyber\.html/.test(wvUrl)) { wvHide(); closed = true; }
      return closed;
    },
  };
  // o ✕ dentro do console (quando carregado no visor) pede o fechamento para cá
  window.addEventListener('message', e => {
    if (e.data && e.data.elx === 'cyber-close') ELX.cyber.close();
  });

  /* ═════════════════ CONTROLE UNIVERSAL DE TELAS — abrir/fechar por voz (sem mouse) ═════════════════ */
  ELX.screens = {
    // abre subtelas que NÃO chegam prontas por seus próprios eventos ui
    open(screen, opts = {}) {
      switch (screen) {
        /* ROSTO ⇄ ESFERA por comando de voz. O botão ☺ ROSTO sempre fez isso;
           aqui ele ganha a mesma porta que o operador usa falando. */
        case 'rosto':
          if (!ELX.avatar) { ELX.toast('A forma humana não carregou nesta sessão.', 'red'); break; }
          if (ELX.avatar.enable()) ELX.toast('Assumindo a forma humana, Senhor.', 'green');
          else ELX.toast('Não consegui assumir a forma humana — o modelo 3D não carregou.', 'red');
          break;
        case 'esfera':
          if (ELX.avatar?.disable()) ELX.toast('De volta ao núcleo neural.', 'green');
          break;
        case 'camera':        camStart().then(ok => { if (ok) camExpand(true); }); break; // abre já AMPLIADA
        case 'whatsapp':      ELX.whatsapp.open(); break;
        case 'brain':         ELX.brain.open(); break;
        case 'cyber':         ELX.cyber.open(); break;
        case 'market':        ELX.market.study(opts.symbol || opts.query || ''); break;
        case 'council':       document.getElementById('qaCouncil')?.click(); break;
        case 'email_connect': ELX.email.connect(); break;
        // mini TV do sorteio: reabre a última análise, ou avisa que não há nenhuma
        case 'loteria':
          if (ELX.lotterySim?.data?.jogos?.length) ELX.lotterySim.open();
          else ELX.toast('Peça primeiro uma análise: "Elion, analisa os últimos sorteios da Mega-Sena".', '');
          break;
        // noticias / clima / agenda / carteira / email(conectado) / curso já chegam renderizados via seus eventos ui
      }
    },
    // fecha/finaliza; alvo vago fecha a tela mais proeminente que estiver aberta
    close(target) {
      const visorOpen = !wv.hidden;
      const camOn = !!camStream;
      switch (target) {
        // "fecha o rosto" e "volta pra esfera" são o mesmo pedido
        case 'rosto':
          if (ELX.avatar?.active) { ELX.avatar.disable(); ELX.toast('De volta ao núcleo neural.', 'green'); }
          else ELX.toast('Já estou na forma de esfera, Senhor.', '');
          break;
        case 'camera':
          if (camOn || ELX.cam.expanded) { camStop(); ELX.toast('Câmera desligada.', 'green'); } else ELX.toast('A câmera já está desligada, Senhor.', '');
          break;
        case 'monitor':
          if (!ELX.monitor?.close()) ELX.toast('O monitor já está desligado, Senhor.', '');
          break;
        case 'loteria':
          if (!ELX.lotterySim?.close()) ELX.toast('A tela do sorteio já está fechada, Senhor.', '');
          break;
        case 'brain':
          if (!ELX.brain.close()) ELX.toast('O Segundo Cérebro não está aberto.', '');
          break;
        case 'cyber':
          if (!ELX.cyber.close()) ELX.toast('O console de defesa cibernética não está aberto.', '');
          break;
        case 'whatsapp': case 'site': case 'market': case 'carteira':
        case 'email': case 'conselho': case 'curso': case 'visor':
          if (visorOpen) wvHide(); else ELX.toast('Não há painel aberto no visor.', '');
          break;
        case 'noticias': case 'clima': case 'agenda':
          ELX.toast('Esse painel é fixo na tela, Senhor — fica sempre visível.', '');
          break;
        case 'all':
          ELX.lotterySim?.close();
          ELX.monitor?.close();
          if (visorOpen) wvHide();
          ELX.brain.close();
          if (camOn) camStop();
          ELX.toast('Telas fechadas.', 'green');
          break;
        default: // "fecha isso", "pode parar", "finaliza" → fecha o que estiver aberto, por prioridade
          if (ELX.lotterySim?.on) ELX.lotterySim.close();  // a mini TV cobre tudo → sai primeiro
          else if (ELX.monitor?.on) ELX.monitor.close();   // o monitor vem em seguida
          else if (visorOpen) wvHide();
          else if (ELX.brain.isOpen()) ELX.brain.close();
          else if (camOn) { camStop(); ELX.toast('Câmera desligada.', 'green'); }
          else ELX.toast('Nenhuma tela aberta para fechar, Senhor.', '');
      }
    },
  };

  /* ═════════════════ CONSELHO DE DECISÃO — raciocínio no Visor ═════════════════ */
  const mdInline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  function councilRender(d) {
    wvUrl = ''; wvFrameable = false; wvShowingReader = true;
    wv.hidden = false; wv.classList.remove('closing');
    wvTitle.textContent = `⚖ CONSELHO DE DECISÃO · ${(d.mode || 'jury').toUpperCase()}`;
    wvMode.style.display = 'none'; wvOpenBtn.style.display = 'none';
    wvLoading.classList.add('off');
    wvFrame.style.display = 'none'; wvFrame.src = 'about:blank';
    wvReader.hidden = false;
    const modeNome = d.mode === 'full' ? 'COMPLETO' : d.mode === 'quick' ? 'RÁPIDO' : 'JÚRI';
    const f = d.flags || {};
    const chips = [];
    if (f.confidence) chips.push('<span class="cchip">⚖ <b>Confiança</b></span>');
    if (f.adaptive) chips.push(`<span class="cchip">↻ <b>Adaptativo</b>${d.convergence ? ` · ${d.convergence.rounds} rodada(s)` : ''}</span>`);
    if (f.measureDiversity) chips.push('<span class="cchip">◫ <b>Diversidade</b></span>');
    const metaRow = chips.length ? `<div class="cmeta">${chips.join('')}</div>` : '';

    let tallyHtml = '';
    if (d.tally) {
      const w = d.tally.weights, tot = d.tally.total || 1, pct = k => Math.round((w[k] || 0) / tot * 100);
      tallyHtml =
        `<div class="ctally"><b style="font-family:var(--f-ui);color:var(--cyan-soft);font-size:12px">PLACAR PONDERADO POR CONFIANÇA</b>` +
        `<div class="ct-bar"><i class="ct-sim" style="width:${pct('Sim')}%"></i><i class="ct-nao" style="width:${pct('Não')}%"></i><i class="ct-dep" style="width:${pct('Depende')}%"></i></div>` +
        `<div class="ct-leg"><span style="color:var(--green)">● Sim ${w.Sim}</span><span style="color:var(--red)">● Não ${w['Não']}</span><span style="color:var(--amber)">● Depende ${w.Depende}</span><span>→ líder <b style="color:var(--cyan-soft)">${esc(d.tally.leader)}</b> (${d.tally.leaderPct}%)</span></div></div>`;
    }
    let divHtml = '';
    if (d.diversity) {
      const low = /baixa/i.test(d.diversity.nivel || '');
      divHtml = `<div class="cdiv${low ? ' warn' : ''}"><b>${low ? '⚠ ' : '◫ '}Diversidade ${esc(d.diversity.nivel || '—')}${d.diversity.indice != null ? ` · ${d.diversity.indice}/100` : ''}</b><br>${mdInline(d.diversity.texto || '')}</div>`;
    }
    const convHtml = (d.convergence && f.adaptive)
      ? `<div class="cchip" style="display:inline-block;margin:0 0 8px">↻ Convergência: ${esc(d.convergence.motivo)} — ${d.convergence.rounds} rodada(s)</div>` : '';

    const advisors = (d.advisors || []).map(a =>
      `<div class="cadv"><b>◈ ${esc(a.nome)}</b><div class="cbody">${mdInline(a.parecer)}</div></div>`).join('');
    const reviewed = (d.reviewed || []).map(a =>
      `<div class="cadv rev"><b>↻ ${esc(a.nome)} <span style="opacity:.6;font-size:10px">(refinado)</span></b><div class="cbody">${mdInline(a.parecer)}</div></div>`).join('');
    const judges = (d.judges || []).map((j, i) =>
      `<div class="cadv jdg"><b>⚖ Juiz ${i + 1}</b><div class="cbody">${mdInline(j)}</div></div>`).join('');
    wvTitle.textContent = `⚖ CONSELHO DE DECISÃO · ${modeNome}`;
    wvReader.innerHTML =
      `<div class="cverdict"><div class="cv-tag">VEREDITO FINAL · ${modeNome}</div>${metaRow}<div class="cbody">${mdInline(d.verdict || '')}</div></div>` +
      tallyHtml + divHtml +
      (reviewed ? `<h1 style="font-size:15px;margin:14px 0 6px">↻ Revisão Anônima por Pares</h1>${convHtml}${reviewed}` : '') +
      `<h1 style="font-size:15px;margin:14px 0 6px">Pareceres dos Conselheiros</h1>${advisors}` +
      (d.devil ? `<div class="cadv dev"><b>😈 Advogado do Diabo</b><div class="cbody">${mdInline(d.devil)}</div></div>` : '') +
      (judges ? `<h1 style="font-size:15px;margin:14px 0 6px">Juízes</h1>${judges}` : '') +
      `<div class="cquestion"><b>Decisão analisada:</b> ${esc(d.question || '')}</div>`;
    wvReader.scrollTop = 0;
  }
  ELX.council = { render: councilRender };

  /* ═════════════════ MERCADO — gráficos TradingView + leitura técnica educativa ═════════════════ */
  const mkt = { symbol: 'BTCUSD' };
  function tvAdvanced(elId, symbol, opts) {
    opts = opts || {};
    const el = $(elId);
    if (!el) return;
    el.innerHTML = '';
    const cont = document.createElement('div');
    cont.className = 'tradingview-widget-container';
    cont.style.cssText = 'height:100%;width:100%';
    const w = document.createElement('div');
    w.className = 'tradingview-widget-container__widget';
    w.style.cssText = 'height:100%;width:100%';
    cont.appendChild(w);
    const s = document.createElement('script');
    s.type = 'text/javascript'; s.async = true;
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    s.text = JSON.stringify({
      autosize: true, symbol, interval: opts.interval || 'D', timezone: 'America/Sao_Paulo',
      theme: 'dark', style: '1', locale: 'br',
      hide_top_toolbar: !!opts.compact, hide_side_toolbar: !!opts.compact, hide_legend: !!opts.compact,
      allow_symbol_change: !opts.compact, save_image: false, studies: opts.studies || [],
      backgroundColor: 'rgba(2,13,26,0)', gridColor: 'rgba(0,229,255,0.06)',
      support_host: 'https://www.tradingview.com',
    });
    cont.appendChild(s);
    el.appendChild(cont);
  }
  function marketSet(symbol) {
    if (symbol) mkt.symbol = String(symbol).toUpperCase().trim();
    tvAdvanced('mktChart', mkt.symbol, { compact: true, studies: ['RSI@tv-basicstudies'] });
  }
  function marketStudy(symbol) {
    if (symbol) mkt.symbol = String(symbol).toUpperCase().trim();
    wvUrl = ''; wvFrameable = false; wvShowingReader = true;
    wv.hidden = false; wv.classList.remove('closing');
    wvTitle.textContent = `▦ MERCADO · ${mkt.symbol}`;
    wvMode.style.display = 'none'; wvOpenBtn.style.display = 'none';
    wvLoading.classList.add('off');
    wvFrame.style.display = 'none'; wvFrame.src = 'about:blank';
    wvReader.hidden = false;
    wvReader.innerHTML = '<div id="mktBig" style="height:78vh;min-height:480px"></div>'
      + '<div class="mkt-disc" style="margin-top:10px">⚠ Conteúdo educativo — não é recomendação de investimento</div>';
    tvAdvanced('mktBig', mkt.symbol, { compact: false, studies: ['RSI@tv-basicstudies', 'MACD@tv-basicstudies'] });
  }
  function marketNote(text) {
    const el = $('mktAnalysis');
    if (!el || !text) return;
    el.hidden = false;
    el.innerHTML = mdInline(text);
  }
  $('mktGo').onclick = () => { const v = $('mktQ').value.trim(); if (v) marketSet(v); };
  $('mktQ').addEventListener('keydown', e => { if (e.key === 'Enter') $('mktGo').click(); });
  $('mktStudy').onclick = () => marketStudy($('mktQ').value.trim() || mkt.symbol);
  ELX.market = { set: marketSet, study: marketStudy, note: marketNote, get symbol() { return mkt.symbol; } };

  /* ═════════════════ CARTEIRA — aplicações do operador (Tesouro Direto etc.) ═════════════════ */
  function portfolioRender(items) {
    items = items || [];
    wvUrl = ''; wvFrameable = false; wvShowingReader = true;
    wv.hidden = false; wv.classList.remove('closing');
    wvTitle.textContent = '◇ CARTEIRA · INVESTIMENTOS';
    wvMode.style.display = 'none'; wvOpenBtn.style.display = 'none';
    wvLoading.classList.add('off');
    wvFrame.style.display = 'none'; wvFrame.src = 'about:blank';
    wvReader.hidden = false;
    const fmt = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const total = items.reduce((s, i) => s + (Number(i.valor) || 0), 0);
    const rows = items.length ? items.map(i =>
      `<div class="pf-item"><div class="pf-top"><b>${esc(i.titulo)}</b><span class="pf-val">${i.valor != null ? fmt(i.valor) : '—'}</span></div>`
      + `<div class="pf-sub">${esc(i.tipo || 'Investimento')}${i.taxaContratada ? ' · ' + esc(i.taxaContratada) : ''}${i.vencimento ? ' · venc ' + esc(i.vencimento) : ''}${i.quantidade != null ? ' · ' + i.quantidade + ' cotas' : ''}${i.dataCompra ? ' · compra ' + esc(i.dataCompra) : ''}${i.obs ? ' · ' + esc(i.obs) : ''}</div></div>`).join('')
      : '<div class="pf-empty">Carteira vazia. Diga ao ELION‑X o que você tem aplicado — ex.: "registra que apliquei 5 mil no Tesouro Selic 2029".</div>';
    wvReader.innerHTML =
      `<div class="pf-head"><span>TOTAL APLICADO INFORMADO</span><b>${fmt(total)}</b></div>`
      + rows
      + `<div class="mkt-disc" style="margin-top:12px">⚠ Informado manualmente por você · conteúdo educativo — não é recomendação de investimento</div>`;
    wvReader.scrollTop = 0;
  }
  ELX.portfolio = { render: portfolioRender };

  /* ═════════════════ EMAIL (Gmail) — lista no Visor Web ═════════════════ */
  function emailRender(items) {
    wvUrl = ''; wvFrameable = false; wvShowingReader = true;
    wv.hidden = false; wv.classList.remove('closing');
    wvTitle.textContent = 'GMAIL · CAIXA DE ENTRADA';
    wvMode.style.display = 'none'; wvOpenBtn.style.display = 'none';
    wvLoading.classList.add('off');
    wvFrame.style.display = 'none'; wvFrame.src = 'about:blank';
    wvReader.hidden = false;
    wvReader.innerHTML = items && items.length
      ? `<h1>📨 ${items.length} email(s)</h1>` + items.map(e =>
          `<div style="border-left:2px solid ${e.unread ? 'var(--green)' : 'var(--border)'};padding:6px 10px;margin-bottom:8px;background:rgba(0,229,255,.04);border-radius:0 5px 5px 0">
             <div style="font-size:11px;color:var(--green);font-family:var(--f-mono)">${wesc(e.from)}</div>
             <div style="font-weight:600;color:#eafcff;margin:2px 0">${e.unread ? '● ' : ''}${wesc(e.subject)}</div>
             <div style="font-size:11px;color:var(--muted)">${wesc(e.snippet)}</div>
           </div>`).join('')
      : `<h1>📭 Caixa vazia</h1><p>Nenhum email encontrado.</p>`;
    wvReader.scrollTop = 0;
  }

  async function emailConnect() {
    const s = await fetch('/api/status').then(r => r.json()).catch(() => ({}));
    if (!s.gmailConfigured) {
      ELX.toast('Gmail ainda não configurado — falta o Client ID do Google no .env (veja o guia).', 'red');
      return false;
    }
    if (s.gmail) return true;
    ELX.toast('Abrindo o login do Google em nova aba…', 'green');
    window.open('/oauth/google/start', '_blank');
    return false;
  }

  ELX.email = { render: emailRender, connect: emailConnect };

  /* ═════════════════ LOTERIAS CAIXA — resultado no Visor ═════════════════ */
  function lotteryRender(p) {
    wvUrl = ''; wvFrameable = false; wvShowingReader = true;
    wv.hidden = false; wv.classList.remove('closing');
    wvTitle.textContent = `🍀 ${p.nome} · CONCURSO ${p.concurso}`;
    wvMode.style.display = 'none'; wvOpenBtn.style.display = 'none';
    wvLoading.classList.add('off');
    wvFrame.style.display = 'none'; wvFrame.src = 'about:blank';
    wvReader.hidden = false;
    const conf = p.conferencia;
    const acertosSet = new Set(conf ? conf.acertos : []);
    const balls = p.dezenas.map(n => {
      const nn = String(n).padStart(2, '0');
      const hit = acertosSet.has(n);
      return `<span style="display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;margin:4px;font-family:var(--f-mono);font-weight:700;font-size:18px;background:radial-gradient(circle at 35% 30%, ${hit ? '#00ff9d,#0a7a4e' : '#00e5ff,#0a4a6e'});color:#012;box-shadow:0 0 14px ${hit ? 'rgba(0,255,157,.7)' : 'rgba(0,229,255,.5)'}">${nn}</span>`;
    }).join('');
    const prem = (p.premiacoes || []).slice(0, 6).map(f =>
      `<tr><td style="padding:3px 8px">${wesc(f.faixa)}</td><td style="padding:3px 8px;text-align:right">${f.ganhadores ? f.ganhadores : '—'}</td><td style="padding:3px 8px;text-align:right;color:var(--green)">${f.premio ? 'R$ ' + Number(f.premio).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : 'Acumulou'}</td></tr>`).join('');
    wvReader.innerHTML =
      `<div style="text-align:center;margin-bottom:8px">${balls}</div>` +
      (p.dezenas2?.length ? `<div style="text-align:center;opacity:.85;margin-bottom:8px">2º sorteio: ${p.dezenas2.map(n => String(n).padStart(2, '0')).join(' · ')}</div>` : '') +
      `<div style="text-align:center;font-size:12px;opacity:.7;margin-bottom:10px">${wesc(p.data)}${p.local ? ' · ' + wesc(p.local) : ''}</div>` +
      (conf ? `<div style="text-align:center;margin:10px 0;padding:10px;border-radius:10px;background:rgba(0,255,157,.08);border:1px solid rgba(0,255,157,.25)">
        Seus números: <b>${conf.numeros.map(n => String(n).padStart(2, '0')).join(' · ')}</b><br>
        <b style="font-size:20px;color:${conf.acertos.length ? 'var(--green)' : 'var(--muted)'}">${conf.acertos.length} acerto(s)</b>
        ${conf.acertos.length ? ' → ' + conf.acertos.map(n => String(n).padStart(2, '0')).join(', ') : ''}</div>` : '') +
      (prem ? `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px"><thead><tr style="color:var(--cyan-soft);text-align:left"><th style="padding:3px 8px">Faixa</th><th style="padding:3px 8px;text-align:right">Ganh.</th><th style="padding:3px 8px;text-align:right">Prêmio</th></tr></thead><tbody>${prem}</tbody></table>` : '') +
      (p.acumulado && p.proxEstimativa ? `<div style="text-align:center;margin-top:12px;color:var(--amber)">🎯 Acumulou! Próximo (${wesc(p.proxData || '')}): <b>R$ ${Number(p.proxEstimativa).toLocaleString('pt-BR')}</b></div>` : '') +
      `<div class="mkt-disc" style="margin-top:12px">Fonte: ${wesc(p.fonte)} · resultado oficial informativo</div>`;
    wvReader.scrollTop = 0;
  }
  ELX.lottery = { render: lotteryRender };

  /* ═════════════════ CYBER SECURITY — relatório defensivo no Visor ═════════════════ */
  function cyberRender(r) {
    wvUrl = ''; wvFrameable = false; wvShowingReader = true;
    wv.hidden = false; wv.classList.remove('closing');
    const cor = { NORMAL: 'var(--green)', 'ATENÇÃO': 'var(--amber)', ELEVADO: '#ff8c3a', 'CRÍTICO': 'var(--red)' }[r.nivel] || 'var(--cyan-soft)';
    wvTitle.textContent = `🛡 CYBER SECURITY · ${r.nivel}`;
    wvMode.style.display = 'none'; wvOpenBtn.style.display = 'none';
    wvLoading.classList.add('off');
    wvFrame.style.display = 'none'; wvFrame.src = 'about:blank';
    wvReader.hidden = false;
    const a = r.resumoAtaques;
    const tipos = Object.entries(a.porTipo).map(([k, v]) => `<span style="display:inline-block;margin:2px;padding:2px 8px;border-radius:6px;background:rgba(255,80,80,.14);border:1px solid rgba(255,80,80,.3);font-size:11px">${wesc(k)}: <b>${v}</b></span>`).join('');
    const atk = a.ipsAtacantes.map(x =>
      `<div style="border-left:2px solid var(--red);padding:6px 10px;margin:6px 0;background:rgba(255,60,60,.06);border-radius:0 6px 6px 0">
        <b style="font-family:var(--f-mono);color:#ff9a9a">${wesc(x.ip)}</b>
        ${x.geo ? `<span style="opacity:.8;font-size:11px"> · 📍 ${wesc(x.geo.cidade || '?')}/${wesc(x.geo.pais || '?')} · ${wesc(x.geo.isp || '')}</span>` : ''}
        <div style="font-size:11px;color:var(--amber)">${wesc(x.tipos.join(' · '))}</div>
        ${x.exemplos?.length ? `<div style="font-size:10px;opacity:.6;font-family:var(--f-mono)">${x.exemplos.map(wesc).join('<br>')}</div>` : ''}</div>`).join('');
    const ext = r.rede.conexoesExternas.map(c =>
      `<tr><td style="padding:3px 8px;font-family:var(--f-mono);color:var(--cyan-soft)">${wesc(c.ip)}</td>
       <td style="padding:3px 8px;font-size:11px">${c.geo ? wesc((c.geo.cidade || '?') + '/' + (c.geo.pais || '?')) : '—'}</td>
       <td style="padding:3px 8px;font-size:11px;opacity:.8">${wesc(c.geo?.isp || '')}</td>
       <td style="padding:3px 8px;font-size:11px">${wesc(c.processos.join(', ') || '?')}</td></tr>`).join('');
    wvReader.innerHTML =
      `<div style="text-align:center;margin-bottom:12px"><span style="font-size:13px;letter-spacing:1px;opacity:.7">NÍVEL DE AMEAÇA</span><br><b style="font-size:26px;color:${cor}">${r.nivel}</b></div>` +
      `<h1 style="font-size:14px;margin:10px 0 4px">⚔ Tentativas de ataque (15 min): ${a.totalTentativas}</h1>${tipos || '<span style="opacity:.6">Nenhuma assinatura de ataque detectada.</span>'}` +
      (a.ddos?.length ? `<div style="margin-top:8px;color:var(--red)">⚠ Possível DDoS: ${a.ddos.map(d => wesc(d.ip) + ' (' + d.rpm + ' req/min)').join(', ')}</div>` : '') +
      (atk ? `<h1 style="font-size:14px;margin:14px 0 4px">🎯 Origem dos ataques</h1>${atk}` : '') +
      `<h1 style="font-size:14px;margin:14px 0 4px">🌐 Conexões externas ativas (${r.rede.totalEstabelecidas})</h1>` +
      (ext ? `<table style="width:100%;border-collapse:collapse"><thead><tr style="color:var(--cyan-soft);text-align:left;font-size:11px"><th style="padding:3px 8px">IP</th><th style="padding:3px 8px">Local</th><th style="padding:3px 8px">ISP</th><th style="padding:3px 8px">Processo</th></tr></thead><tbody>${ext}</tbody></table>` : '<span style="opacity:.6">Nenhuma conexão externa suspeita.</span>') +
      `<h1 style="font-size:14px;margin:14px 0 4px">🔓 Portas expostas</h1><div style="font-family:var(--f-mono);font-size:12px;opacity:.85">${r.rede.escutaExposta.map(p => wesc(p.port + '/' + p.proc)).join(' · ') || 'nenhuma'}</div>` +
      `<h1 style="font-size:14px;margin:14px 0 4px">🦠 Malware / Ransomware</h1><div style="font-size:12px;color:${r.sistema.malwareIndicios.length ? 'var(--red)' : 'var(--green)'}">${r.sistema.malwareIndicios.length ? r.sistema.malwareIndicios.map(wesc).join('<br>') : '✓ Nenhum indício nesta varredura'}</div>` +
      `<div class="mkt-disc" style="margin-top:14px">Varredura defensiva heurística (só leitura) · ${wesc(r.at)} · não substitui antivírus corporativo</div>`;
    wvReader.scrollTop = 0;
  }
  ELX.cyber.render = cyberRender; // agrega ao ELX.cyber já criado acima (open/close do console)

  /* ═════════════════ MONITOR DE VÍDEO — YouTube numa "tela de computador" ═════════════════
     Abre como um CRT ligando, mas o vídeo fica CARREGADO EM PAUSA — só toca
     quando o operador confirma ("sim"/"pode"). Isso evita o problema clássico
     de assistente de voz: o som do vídeo vazando pelos alto-falantes e sendo
     captado pelo microfone como se fosse o operador falando. Enquanto toca, a
     audição fica suspensa (ELX.voice.suspendListening); o botão "🎙 falar" some
     pausa o vídeo, devolve a palavra por um comando, e o operador manda tocar
     de novo. Desliga num FLASH DE RELÂMPAGO. */
  const monWrap = $('monitorWrap'), monFrame = $('monFrame'), monTitle = $('monTitle'), monMeta = $('monMeta');
  const monReady = $('monReady'), monTalk = $('monTalk');
  let monVideo = null, monBoltTimer = 0, monState = 'closed'; // 'closed' | 'ready' | 'playing' | 'paused'

  function monCmd(func) {
    try { monFrame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: '' }), '*'); } catch {}
  }

  function monitorOpen(video, lista) {
    if (!monWrap || !video?.id) return;
    monVideo = video; monState = 'ready';
    clearTimeout(monBoltTimer);
    monWrap.classList.remove('mon-bolt');
    monWrap.classList.add('mon-ready');
    monWrap.hidden = false;
    // enablejsapi permite controlar play/pause por postMessage; SEM autoplay —
    // o vídeo fica pronto, mas parado, até o operador confirmar
    const origin = encodeURIComponent(location.origin);
    monFrame.src = `https://www.youtube.com/embed/${encodeURIComponent(video.id)}?enablejsapi=1&origin=${origin}&autoplay=0&rel=0&modestbranding=1&playsinline=1`;
    monTitle.textContent = video.titulo || '';
    const meta = [video.canal, video.duracao, video.views, video.publicado].filter(Boolean).join('  ·  ');
    monMeta.textContent = meta + (lista?.length > 1 ? `   ·   ${lista.length} resultados encontrados` : '');
    ELX.toast?.('Vídeo pronto no monitor — aguardando confirmação para iniciar.', 'green');
  }

  /** inicia (ou retoma) a exibição — chamado após o operador confirmar */
  function monitorPlay() {
    if (!monWrap || monWrap.hidden || !monVideo) return false;
    monCmd('playVideo');
    monWrap.classList.remove('mon-ready', 'mon-paused');
    monState = 'playing';
    ELX.voice?.suspendListening?.();     // corta a audição — o som do vídeo não pode ser ouvido como fala
    return true;
  }

  /** botão "🎙 falar com o Elion": pausa o vídeo e devolve a palavra por UM comando */
  function monitorPauseForTalk() {
    if (!monWrap || monWrap.hidden || monState !== 'playing') return false;
    monCmd('pauseVideo');
    monWrap.classList.add('mon-paused');
    monState = 'paused';
    ELX.voice?.resumeListening?.();
    ELX.voice?.pushToTalkOnce?.();       // já escuta o próximo comando ("continua", "fecha o monitor"…)
    ELX.toast?.('Vídeo pausado — pode falar, Senhor.', 'green');
    return true;
  }

  function monitorClose() {
    if (!monWrap || monWrap.hidden) return false;
    monWrap.classList.add('mon-bolt');          // dispara flash + colapso
    monFrame.src = 'about:blank';                // corta o áudio no ato
    monState = 'closed';
    ELX.voice?.resumeListening?.();               // devolve a audição normal
    clearTimeout(monBoltTimer);
    monBoltTimer = setTimeout(() => {
      monWrap.hidden = true;
      monWrap.classList.remove('mon-bolt', 'mon-ready', 'mon-paused');
      monVideo = null;
    }, 560);                                     // = duração do relâmpago no CSS
    return true;
  }

  $('monOff') && ($('monOff').onclick = monitorClose);
  $('monYT') && ($('monYT').onclick = () => monVideo && window.open(monVideo.url, '_blank', 'noopener'));
  monTalk && (monTalk.onclick = monitorPauseForTalk);
  monReady && (monReady.onclick = monitorPlay);           // clique no "PRONTO PARA EXIBIR" também confirma
  $('monitorBackdrop') && ($('monitorBackdrop').onclick = monitorClose);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && monWrap && !monWrap.hidden) monitorClose(); });

  ELX.monitor = {
    open: monitorOpen, close: monitorClose, play: monitorPlay, pauseForTalk: monitorPauseForTalk,
    get on() { return !!(monWrap && !monWrap.hidden); },
    get playing() { return monState === 'playing'; },
    get video() { return monVideo; },
  };
})();

/* ═══════════════════════════════════════════════════════════════════════════
   MINI TV DA LOTERIA — subtela de sorteio
   Abre por comando ("abre a tela do sorteio"), mostra as combinações uma a
   uma como num sorteio de verdade, e some com o mesmo relâmpago do monitor
   de vídeo — a plataforma tem um vocabulário visual só.
   ═══════════════════════════════════════════════════════════════════════════ */
(() => {
  const $ = id => document.getElementById(id);
  const tvWrap = $('tvWrap');
  if (!tvWrap) return;

  let dados = null;      // último payload do simulador
  let pagina = 0;        // qual jogo está em exibição nas bolas
  let boltTimer = null;

  const POR_PAG = 1;     // um jogo por vez nas bolas grandes

  function pinta() {
    if (!dados) return;
    const jogos = dados.jogos || [];
    const total = Math.max(1, jogos.length);
    pagina = Math.max(0, Math.min(pagina, total - 1));

    $('tvJogo').textContent = (dados.nome || 'SORTEIO').toUpperCase();
    $('tvTag').textContent  = dados.estrategia ? `estratégia ${dados.estrategia}` : 'combinações';
    $('tvPag').textContent  = `${pagina + 1} / ${total}`;

    // bolas do jogo em foco — reanimadas a cada troca, com atraso em cascata
    const bolas = $('tvBolas');
    bolas.innerHTML = '';
    const atual = jogos[pagina];
    if (atual) {
      atual.dezenas.forEach((d, i) => {
        const b = document.createElement('div');
        b.className = 'tv-bola' + (dados.estrategia === 'frios' ? ' fria' : '');
        b.textContent = String(d).padStart(2, '0');
        b.style.animationDelay = (i * 90) + 'ms';   // cai uma de cada vez
        bolas.appendChild(b);
      });
    }

    // demais jogos em lista
    const lista = $('tvJogos');
    lista.innerHTML = '';
    jogos.forEach((j, i) => {
      const l = document.createElement('div');
      l.className = 'tv-linha';
      l.style.animationDelay = (300 + i * 60) + 'ms';
      l.style.opacity = i === pagina ? '1' : '.62';
      l.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b>` +
        `<span class="tv-dz">${j.dezenas.map(d => String(d).padStart(2, '0')).join(' · ')}</span>` +
        `<span class="tv-meta">soma ${j.soma} · ${j.pares}p/${j.impares}i</span>`;
      l.onclick = () => { pagina = i; pinta(); };
      lista.appendChild(l);
    });

    // rodapé: probabilidade real + a ressalva, sempre visível
    const p = dados.prob;
    const s = dados.stats;
    const partes = [];
    if (p?.faixas?.length) partes.push(`Chance máxima: <b>${p.faixas[0].chance}</b>`);
    if (p?.custo) partes.push(`aposta R$ ${p.custo.toFixed(2)}`);
    if (s?.concursos) partes.push(`base: ${s.concursos} concursos`);
    $('tvInfo').innerHTML = partes.join(' · ') +
      '<br>Sorteios são independentes — nenhuma análise do passado aumenta a chance do próximo.';
  }

  function abrir(payload) {
    if (payload) { dados = payload; pagina = 0; }
    if (!dados) {
      dados = { nome: 'Loteria', estrategia: '', jogos: [],
                prob: null, stats: null };
    }
    clearTimeout(boltTimer);
    tvWrap.classList.remove('tv-bolt');
    tvWrap.hidden = false;
    pinta();
    return true;
  }

  function fechar() {
    if (tvWrap.hidden) return false;
    tvWrap.classList.add('tv-bolt');          // dispara flash + colapso
    clearTimeout(boltTimer);
    boltTimer = setTimeout(() => {
      tvWrap.hidden = true;
      tvWrap.classList.remove('tv-bolt');
    }, 560);                                   // = duração do relâmpago no CSS
    return true;
  }

  $('tvOff')  && ($('tvOff').onclick  = fechar);
  $('tvPrev') && ($('tvPrev').onclick = () => { pagina--; pinta(); });
  $('tvNext') && ($('tvNext').onclick = () => { pagina++; pinta(); });
  tvWrap.addEventListener('click', e => { if (e.target.id === 'tvBackdrop') fechar(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !tvWrap.hidden) fechar(); });

  ELX.lotterySim = {
    open: abrir, close: fechar,
    render: payload => abrir(payload),          // o simulador chama isto ao terminar
    get on() { return !tvWrap.hidden; },
    get data() { return dados; },
  };
})();
