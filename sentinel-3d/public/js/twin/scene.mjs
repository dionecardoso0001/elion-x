// Gêmeo digital 3D: renderização, modos de navegação, seleção, marcadores e efeitos.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { kpiText } from '../util.mjs';
import { createMaterials, buildAgency, buildFurniture, buildDevice, markerTexture, selectionTexture } from './builders.mjs';

const STATUS_COLORS = { ok: '#22c55e', degraded: '#eab308', critical: '#ef4444', offline: '#9ca3af', maintenance: '#3b82f6', unknown: '#a855f7' };
const EDGE_COLORS = { network: 0x22d3ee, poe: 0x38bdf8, power: 0xf59e0b, 'data-path': 0xa855f7, supervision: 0x94a3b8, cooling: 0x7dd3fc };
const SEV_COLORS = { critical: 0xef4444, high: 0xf97316, medium: 0xeab308, low: 0x94a3b8 };
const CENTER = new THREE.Vector3(18, 0, 10); // recalculado a partir da planta em build()
const EYE = 1.65;
const PLAYER_R = 0.28;
const TRAY_Y = 3.0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function webglSupported() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export class TwinScene {
  constructor({ canvas, wrap, onSelect, onFps, vrSlot }) {
    this.canvas = canvas; this.wrap = wrap; this.onSelect = onSelect; this.onFps = onFps;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // no r185 o PCF já filtra suave (PCFSoft foi depreciado)
    this.renderer.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b11);
    this.scene.fog = new THREE.Fog(0x070b11, 60, 140);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 300);
    this.camera.position.set(16, 30, 40);

    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a1f26, 0.55));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    sun.position.set(30, 40, 30); sun.target.position.copy(CENTER);
    this.sun = sun;
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 5, far: 110 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.interior = new THREE.PointLight(0xfff3e0, 0, 40, 1.4); // luz interna para primeira pessoa
    this.interior.position.set(16, 2.9, 11); this.scene.add(this.interior);

    this.labelRenderer = new CSS2DRenderer();
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    wrap.appendChild(this.labelRenderer.domElement);

    this.orbit = new OrbitControls(this.camera, canvas);
    Object.assign(this.orbit, { enableDamping: !reducedMotion, dampingFactor: 0.08, minDistance: 3, maxDistance: 85, maxPolarAngle: 1.42, screenSpacePanning: false });
    this.orbit.target.copy(CENTER);
    this.fpv = new PointerLockControls(this.camera, canvas);
    this.keys = new Set();
    this.mode = 'aerial';

    this.mats = createMaterials();
    this.selTex = selectionTexture();
    this.devices = new Map();   // id -> { device, group, marker, selRing, effect, label }
    this.pickables = [];
    this.colliders = [];
    this.states = new Map();
    this.filters = { categories: null, statuses: null };
    this.clock = new THREE.Timer();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.camera = this.camera;
    this.tween = null;
    this.frames = 0; this.fpsT = performance.now();

    if (vrSlot && 'xr' in navigator) {
      navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
        if (!ok) return this.vrUnavailable(vrSlot);
        const btn = VRButton.createButton(this.renderer);
        vrSlot.append(btn);
        this.renderer.xr.addEventListener('sessionstart', () => { this.xrRig(true); });
        this.renderer.xr.addEventListener('sessionend', () => { this.xrRig(false); });
      }).catch(() => this.vrUnavailable(vrSlot));
    } else if (vrSlot) this.vrUnavailable(vrSlot);

    this.bindInput();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(wrap);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
    document.addEventListener('visibilitychange', () => {
      if (this.renderer.xr.isPresenting) return;
      this.renderer.setAnimationLoop(document.hidden ? null : () => this.frame());
    });
  }

  vrUnavailable(slot) {
    const b = document.createElement('button');
    b.className = 'btn'; b.disabled = true; b.textContent = 'VR indisponível';
    b.title = 'WebXR imersivo não é suportado neste navegador/dispositivo. A experiência completa funciona sem headset.';
    slot.append(b);
  }

  xrRig(on) {
    // Em VR, o usuário começa na entrada da agência, na altura dos olhos fornecida pelo headset.
    if (on) { this.savedCam = this.camera.position.clone(); this.scene.position.set(-16, 0, -20); this.setCeilings(true); }
    else { this.scene.position.set(0, 0, 0); this.setMode(this.mode); }
  }

  // ---------- construção ----------
  async build(layout, devices, deps, { hideRestricted, logoUrl = null }) {
    this.layout = layout;
    this.roomsById = new Map(layout.rooms.map((r) => [r.id, r]));
    const { x: BX, z: BZ } = layout.bounds;
    this.bounds = { BX, BZ };
    this.center = new THREE.Vector3(BX / 2, 0, BZ / 2);
    this.orbit.target.copy(this.center);
    this.sun.position.set(BX / 2 + 14, 40, BZ / 2 + 20); this.sun.target.position.copy(this.center);
    Object.assign(this.sun.shadow.camera, { left: -BX / 2 - 4, right: BX / 2 + 4, top: BZ / 2 + 6, bottom: -BZ / 2 - 6 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.interior.position.set(BX / 2, 2.9, BZ / 2);
    // porta principal = maior vão da fachada
    const facade = layout.walls.find((w) => w.a[1] === BZ && w.b[1] === BZ);
    const door = (facade?.doors || []).slice().sort((a, b) => b.w - a.w)[0];
    this.entry = { x: door?.at ?? BX / 2, z: BZ + 3 };
    let logo = null;
    if (logoUrl) {
      try {
        logo = await new THREE.TextureLoader().loadAsync(logoUrl);
        logo.colorSpace = THREE.SRGBColorSpace;
        this.logoAspect = logo.image.width / logo.image.height;
      } catch { logo = null; }
    }
    const ag = buildAgency(layout, this.mats, { hideRestricted });
    this.agency = ag;
    this.scene.add(ag.group);
    this.colliders.push(...ag.colliders);

    for (const item of layout.furniture) {
      if (hideRestricted && this.roomAt(item.x, item.z)?.restricted) continue;
      const { group, collider } = buildFurniture(item.kind === 'brandwall' && logo ? { ...item, logo, logoAspect: this.logoAspect } : item, this.mats);
      this.scene.add(group);
      if (collider) this.colliders.push(collider);
    }

    // rótulos de ambientes
    this.roomLabels = [];
    layout.rooms.forEach((r) => {
      const el = document.createElement('div');
      const locked = hideRestricted && r.restricted;
      // numeração e cores conforme a legenda do mapa conceitual (06 = suporte técnico em azul)
      el.className = `room-label${r.num ? '' : ' minor'}${r.tech ? ' tech' : ''}${locked ? ' locked' : ''}`;
      if (r.num) { const num = document.createElement('span'); num.className = 'num'; num.textContent = r.num; el.append(num); }
      const txt = document.createElement('span'); txt.textContent = locked ? `${r.short ?? r.name} · restrito` : (r.short ?? r.name);
      el.title = `${r.name} — ${r.desc ?? ''}`;
      el.append(txt);
      const obj = new CSS2DObject(el);
      obj.position.set((r.x0 + r.x1) / 2, layout.bounds.wallHeight + 0.4, (r.z0 + r.z1) / 2);
      this.scene.add(obj);
      this.roomLabels.push(obj);
    });

    // sobreposições de destaque por ambiente
    this.roomOverlays = new Map();
    for (const r of layout.rooms) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0 - 0.2, r.z1 - r.z0 - 0.2), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set((r.x0 + r.x1) / 2, 0.015, (r.z0 + r.z1) / 2); m.visible = false;
      this.scene.add(m); this.roomOverlays.set(r.id, m);
    }

    this.metricsOn = false;
    for (const d of devices) this.addDevice(d);
    this.buildDeps(deps);
    this.setMode('aerial');
  }

  roomAt(x, z) { return this.layout.rooms.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1); }

  addDevice(d) {
    const room = this.roomsById.get(d.room);
    const { group, collider } = buildDevice(d, this.mats, room);
    this.scene.add(group);
    if (collider) this.colliders.push(collider);
    group.traverse((o) => { if (o.isMesh) this.pickables.push(o); });

    const onCeiling = d.pos[1] > 2.6;
    const markerY = onCeiling ? d.pos[1] - 0.45 : d.pos[1] + (d.type === 'vault' ? 1.35 : d.type === 'ups' || d.type === 'atm' || d.type === 'totem' ? 1.05 : 0.42);
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture('unknown', STATUS_COLORS.unknown), transparent: true, depthTest: false }));
    marker.position.set(d.pos[0], markerY, d.pos[2]);
    marker.scale.setScalar(0.42); marker.renderOrder = 10; marker.userData.deviceId = d.id;
    this.scene.add(marker); this.pickables.push(marker);

    const selRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.selTex, transparent: true, depthTest: false }));
    selRing.position.copy(marker.position); selRing.scale.setScalar(0.7); selRing.renderOrder = 9; selRing.visible = false;
    this.scene.add(selRing);

    // efeito localizado de falha crítica: anel no piso + feixe vertical
    const effect = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 40), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(d.pos[0], 0.03, d.pos[2]);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, Math.max(0.2, markerY), 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.set(d.pos[0], markerY / 2, d.pos[2]);
    effect.add(ring, beam); effect.visible = false; effect.userData = { ring, beam };
    this.scene.add(effect);

    const labelEl = document.createElement('div');
    labelEl.className = 'dev-label'; labelEl.textContent = d.id;
    const label = new CSS2DObject(labelEl); label.position.copy(marker.position); label.visible = false;
    this.scene.add(label);

    // chip de desempenho (camada "Desempenho"): KPI principal do equipamento em tempo real
    const kpiEl = document.createElement('div');
    kpiEl.className = 'kpi-chip';
    const kpi = new CSS2DObject(kpiEl); kpi.position.copy(marker.position); kpi.visible = false;
    this.scene.add(kpi);

    this.devices.set(d.id, { device: d, group, marker, selRing, effect, label, labelEl, kpi, kpiEl, markerY, status: 'unknown', pulse: Math.random() * 6 });
  }

  buildDeps(deps) {
    this.depsGroup = new THREE.Group(); this.depsGroup.visible = false;
    this.depsHot = new THREE.Group();
    const byType = {};
    for (const e of deps) {
      if (e.type === 'managed-by' || e.type === 'cooling') continue; // relações lógicas/térmicas não são cabos
      const a = this.devices.get(e.from), b = this.devices.get(e.to);
      if (!a || !b) continue;
      (byType[e.type] ??= []).push(...this.route(a.device.pos, b.device.pos));
    }
    for (const [type, pts] of Object.entries(byType)) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: EDGE_COLORS[type] ?? 0xffffff, transparent: true, opacity: 0.55, depthTest: false }));
      line.renderOrder = 5; this.depsGroup.add(line);
    }
    this.deps = deps;
    this.scene.add(this.depsGroup, this.depsHot);
  }

  /** Traçado em "eletrocalha": sobe, anda em L na altura do forro e desce. */
  route(p, q) {
    const a = new THREE.Vector3(...p), b = new THREE.Vector3(...q);
    const a1 = new THREE.Vector3(a.x, TRAY_Y, a.z), m = new THREE.Vector3(b.x, TRAY_Y, a.z), b1 = new THREE.Vector3(b.x, TRAY_Y, b.z);
    return [a, a1, a1, m, m, b1, b1, b];
  }

  // ---------- estado ----------
  setStates(devStates, incidents = []) {
    for (const s of devStates) {
      const v = this.devices.get(s.id);
      if (!v) continue;
      if (this.metricsOn) {
        const stale = ['offline', 'unknown'].includes(s.status);
        v.kpiEl.textContent = `${s.id} · ${stale ? `sem dados ${Math.round((s.ageMs ?? 0) / 1000)} s` : kpiText(v.device.type, s.values)}`;
        v.kpiEl.className = `kpi-chip k-${s.status}`;
      }
      if (v.status === s.status) continue;
      v.status = s.status;
      v.marker.material.map = markerTexture(s.status, STATUS_COLORS[s.status]);
      v.marker.material.needsUpdate = true;
      v.effect.visible = s.status === 'critical';
      v.labelEl.classList.toggle('critical', s.status === 'critical');
    }
    // destaque de áreas com incidentes ativos (sev. crítica/alta)
    const roomSev = new Map();
    for (const inc of incidents) {
      if (!['critical', 'high'].includes(inc.severity)) continue;
      for (const id of inc.deviceIds || []) {
        const room = this.devices.get(id)?.device.room;
        if (room && (roomSev.get(room) !== 'critical')) roomSev.set(room, inc.severity);
      }
    }
    for (const [id, m] of this.roomOverlays) {
      const sev = roomSev.get(id);
      m.visible = !!sev;
      if (sev) m.material.color.setHex(SEV_COLORS[sev]);
    }
    this.applyFilters();
    this.updateLabels();
  }

  setFilters({ categories, statuses }) { this.filters = { categories, statuses }; this.applyFilters(); }

  applyFilters() {
    const { categories, statuses } = this.filters;
    for (const v of this.devices.values()) {
      const show = (!categories || categories.has(v.device.category)) && (!statuses || statuses.has(v.status));
      v.marker.visible = show;
      v.effect.visible = show && v.status === 'critical';
    }
  }

  updateLabels() {
    for (const [id, v] of this.devices) {
      v.kpi.visible = !!this.metricsOn && v.marker.visible;
      v.label.visible = !this.metricsOn && this.labelsOn !== false && (v.status === 'critical' || id === this.selected) && v.marker.visible;
    }
  }

  toggleMetrics(on, lastStates) {
    this.metricsOn = on;
    if (on && lastStates) this.setStates(lastStates);
    this.updateLabels();
  }

  /** Voa até o centro de um ambiente (legenda do mapa de ativos). */
  flyToRoom(id) {
    const r = this.roomsById.get(id);
    if (!r) return;
    if (this.mode === 'fpv') this.setMode('aerial');
    const c = new THREE.Vector3((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    const span = Math.max(r.x1 - r.x0, r.z1 - r.z0);
    this.animateTo(c.clone().add(new THREE.Vector3(0, 4 + span * 0.9, 3 + span * 0.7)), c, 1.1);
  }

  select(id) {
    if (this.selected) { const p = this.devices.get(this.selected); if (p) p.selRing.visible = false; }
    this.selected = id;
    const v = id && this.devices.get(id);
    if (v) v.selRing.visible = true;
    this.updateLabels();
  }

  highlightIncident(inc) {
    this.depsHot.clear();
    if (!inc?.deviceIds?.length) return;
    const ids = new Set(inc.deviceIds);
    const pts = [];
    for (const e of this.deps) {
      if (e.type === 'managed-by' || !ids.has(e.to) || !(ids.has(e.from) || (inc.diagnosis?.relation && e.from === inc.rootDeviceId))) continue;
      const a = this.devices.get(e.from), b = this.devices.get(e.to);
      if (a && b) pts.push(...this.route(a.device.pos, b.device.pos));
    }
    if (pts.length) {
      const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff5555, depthTest: false }));
      line.renderOrder = 6; this.depsHot.add(line);
    }
    for (const id of ids) {
      const v = this.devices.get(id);
      if (!v) continue;
      const bb = new THREE.Box3().setFromObject(v.group).expandByScalar(0.08);
      const helper = new THREE.Box3Helper(bb, id === inc.rootDeviceId ? 0xff3b3b : 0xf97316);
      helper.material.depthTest = false; helper.renderOrder = 7;
      this.depsHot.add(helper);
    }
  }

  // ---------- modos ----------
  setMode(mode) {
    if (this.mode === 'fpv' && mode !== 'fpv') this.fpv.unlock();
    if ((this.mode === 'fpv') !== (mode === 'fpv')) this.tween = null; // um voo do modo aéreo não pode arrastar o jogador
    this.mode = mode;
    const aerial = mode !== 'fpv';
    this.orbit.enabled = aerial;
    this.setCeilings(!aerial);
    this.interior.intensity = aerial ? 0 : 28;
    const xray = mode === 'xray';
    for (const m of [this.mats.wall, this.mats.wallExt, this.mats.low, this.mats.frame]) {
      m.transparent = xray; m.opacity = xray ? 0.12 : 1; m.depthWrite = !xray; m.needsUpdate = true;
    }
    this.mats.glass.opacity = xray ? 0.06 : 0.22;
    this.depsGroup.visible = xray || this.depsOn;
    for (const v of this.devices.values()) { v.marker.material.depthTest = mode === 'fpv'; v.selRing.material.depthTest = mode === 'fpv'; }
    for (const l of this.roomLabels) l.visible = aerial && this.labelsOn !== false;
    if (mode === 'fpv') {
      this.camera.position.set(this.entry.x, EYE, this.entry.z);
      this.camera.lookAt(this.entry.x, EYE, this.entry.z - 10);
    } else if (!this.tween) {
      // vista oblíqua frontal, como o mapa conceitual (fachada embaixo)
      const c = this.center ?? CENTER;
      this.animateTo(new THREE.Vector3(c.x, 30, c.z + 24), c.clone(), 0.9);
    }
  }

  setCeilings(on) { for (const c of this.agency?.ceilings || []) c.visible = on; }
  toggleDeps(on) { this.depsOn = on; this.depsGroup.visible = on || this.mode === 'xray'; }
  toggleLabels(on) { this.labelsOn = on; for (const l of this.roomLabels) l.visible = on && this.mode !== 'fpv'; this.updateLabels(); }

  // ---------- navegação por evento ----------
  flyTo(id) {
    const v = this.devices.get(id);
    if (!v) return false;
    const p = new THREE.Vector3(...v.device.pos);
    if (this.mode === 'fpv') {
      const room = this.roomsById.get(v.device.room);
      const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
      const dir = new THREE.Vector3(cx - p.x, 0, cz - p.z).normalize();
      const dest = new THREE.Vector3(p.x + dir.x * 2.2, EYE, p.z + dir.z * 2.2);
      dest.x = THREE.MathUtils.clamp(dest.x, room.x0 + 0.5, room.x1 - 0.5);
      dest.z = THREE.MathUtils.clamp(dest.z, room.z0 + 0.5, room.z1 - 0.5);
      this.animateTo(dest, p, 1.0);
    } else {
      const offset = new THREE.Vector3(3.5, 5.5, 6.5);
      if (p.z < 6) offset.z = 7.5;
      this.animateTo(p.clone().add(offset), p.clone(), 1.2);
    }
    return true;
  }

  animateTo(pos, target, dur) {
    const from = this.camera.position.clone();
    const fromT = this.mode === 'fpv' ? null : this.orbit.target.clone();
    const startQ = this.camera.quaternion.clone();
    const tmp = new THREE.PerspectiveCamera(); tmp.position.copy(pos); tmp.lookAt(target);
    this.tween = { from, fromT, to: pos, target, startQ, endQ: tmp.quaternion.clone(), t: 0, dur: reducedMotion ? 0.001 : dur };
  }

  stepTween(dt) {
    const tw = this.tween;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const k = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
    this.camera.position.lerpVectors(tw.from, tw.to, k);
    if (this.mode === 'fpv') this.camera.quaternion.slerpQuaternions(tw.startQ, tw.endQ, k);
    else { this.orbit.target.lerpVectors(tw.fromT, tw.target, k); }
    if (tw.t >= 1) this.tween = null;
  }

  // ---------- entrada ----------
  bindInput() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // foi arrasto
      if (this.mode === 'fpv') {
        if (!this.fpv.isLocked) { this.fpv.lock(); return; }
        this.pick(0, 0);
      } else {
        const r = this.canvas.getBoundingClientRect();
        this.pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      }
    });
    addEventListener('keydown', (e) => { if (this.mode === 'fpv' && !e.target.closest?.('input,textarea,select')) { this.keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); } });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.fpv.addEventListener('lock', () => this.onLockChange?.(true));
    this.fpv.addEventListener('unlock', () => { this.keys.clear(); this.onLockChange?.(false); });
  }

  pick(nx, ny) {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables.filter((o) => o.visible !== false), false);
    const hit = hits.find((h) => h.object.userData.deviceId);
    if (hit) this.onSelect?.(hit.object.userData.deviceId);
  }

  movePlayer(dt) {
    if (!this.fpv.isLocked || this.tween) return;
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 5.5 : 2.8) * dt;
    const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const s = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    if (!f && !s) return;
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const delta = fwd.multiplyScalar(f).add(right.multiplyScalar(s)).normalize().multiplyScalar(speed);
    const pos = this.camera.position;
    // resolução de colisão por eixo (desliza ao longo das paredes)
    const nx = pos.x + delta.x;
    if (!this.collides(nx, pos.z)) pos.x = nx;
    const nz = pos.z + delta.z;
    if (!this.collides(pos.x, nz)) pos.z = nz;
    pos.x = THREE.MathUtils.clamp(pos.x, -4, this.bounds.BX + 4); pos.z = THREE.MathUtils.clamp(pos.z, -4, this.bounds.BZ + 7); pos.y = EYE;
  }

  collides(x, z) {
    for (const c of this.colliders) {
      const cx = Math.max(c.x0, Math.min(x, c.x1)), cz = Math.max(c.z0, Math.min(z, c.z1));
      if ((x - cx) ** 2 + (z - cz) ** 2 < PLAYER_R * PLAYER_R) return true;
    }
    return false;
  }

  // ---------- loop ----------
  frame() {
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.tween) this.stepTween(dt);
    if (this.mode === 'fpv') this.movePlayer(dt);
    else this.orbit.update();
    const t = this.clock.getElapsed();
    for (const v of this.devices.values()) {
      let s = 0.42;
      if (!reducedMotion) {
        if (v.status === 'critical') s = 0.42 + Math.abs(Math.sin(t * 4 + v.pulse)) * 0.16;
        else if (v.status === 'degraded') s = 0.42 + Math.abs(Math.sin(t * 2 + v.pulse)) * 0.07;
      }
      v.marker.scale.setScalar(s);
      if (v.effect.visible) {
        const k = reducedMotion ? 0.5 : (t * 0.9 + v.pulse) % 1;
        v.effect.userData.ring.scale.setScalar(1 + k * 1.6);
        v.effect.userData.ring.material.opacity = 0.85 * (1 - k);
        v.effect.userData.beam.material.opacity = 0.25 + 0.2 * Math.sin(t * 5);
      }
    }
    // camada Desempenho: em primeira pessoa só os chips próximos (evita poluição através das paredes)
    if (this.metricsOn) {
      const range = this.mode === 'fpv' ? 9 : Infinity;
      for (const v of this.devices.values()) v.kpi.visible = v.marker.visible && this.camera.position.distanceTo(v.marker.position) < range;
    }
    for (const m of this.roomOverlays?.values() || []) if (m.visible) m.material.opacity = reducedMotion ? 0.14 : 0.1 + 0.08 * (0.5 + 0.5 * Math.sin(t * 3));
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    this.frames += 1;
    const now = performance.now();
    if (now - this.fpsT > 1000) { this.onFps?.(Math.round((this.frames * 1000) / (now - this.fpsT))); this.frames = 0; this.fpsT = now; }
  }

  resize() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setVisible(on) { if (!this.disposed) this.renderer.setAnimationLoop(on ? () => this.frame() : null); }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    this.fpv.unlock?.();
    this.orbit.dispose();
    this.labelRenderer.domElement.remove();
    // texturas de marcador ficam em cache de módulo e são reaproveitadas pela próxima cena
    this.scene.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { if (!o.isSprite) m.map?.dispose(); m.dispose(); }); });
    this.renderer.dispose();
  }
}
