// Construtores procedurais da agência demonstrativa (blockout PBR).
// Caminho de produção: ativos modelados no Blender e exportados em glTF/GLB (Draco/Meshopt + KTX2),
// substituindo estes construtores sem mudar o vínculo Objeto 3D ↔ deviceId.

import * as THREE from 'three';
import { ICON_PATHS } from '../util.mjs';

// ---------- texturas procedurais ----------
function canvasTex(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

const FLOOR_DRAW = {
  tile: (g, s) => { const r = rng(3); const n = 8, w = s / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 214 + r() * 14; g.fillStyle = `rgb(${v},${v - 6},${v - 16})`; g.fillRect(i * w, j * w, w, w); } g.strokeStyle = 'rgba(120,110,95,.55)'; g.lineWidth = 2; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, s); g.moveTo(0, i * w); g.lineTo(s, i * w); g.stroke(); } },
  wood: (g, s) => { const r = rng(9); const n = 10, w = s / n; for (let i = 0; i < n; i++) { const base = 120 + r() * 30; g.fillStyle = `rgb(${base + 20},${base - 10},${base - 45})`; g.fillRect(0, i * w, s, w); for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(60,35,15,${0.05 + r() * 0.08})`; g.beginPath(); const y = i * w + r() * w; g.moveTo(0, y); g.bezierCurveTo(s * .3, y + r() * 4, s * .6, y - r() * 4, s, y); g.stroke(); } g.fillStyle = 'rgba(40,25,10,.6)'; g.fillRect(0, i * w, s, 2); g.fillRect((r() * s) | 0, i * w, 2, w); } },
  stone: (g, s) => { const r = rng(5); const n = 4, w = s / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 130 + r() * 20; g.fillStyle = `rgb(${v},${v + 2},${v + 6})`; g.fillRect(i * w, j * w, w, w); for (let k = 0; k < 120; k++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(i * w + r() * w, j * w + r() * w, 2, 2); } } g.strokeStyle = 'rgba(40,44,50,.7)'; g.lineWidth = 3; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, s); g.moveTo(0, i * w); g.lineTo(s, i * w); g.stroke(); } },
  tech: (g, s) => { const n = 6, w = s / n; g.fillStyle = '#5b6573'; g.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.strokeStyle = '#3a414b'; g.lineWidth = 3; g.strokeRect(i * w + 2, j * w + 2, w - 4, w - 4); if ((i + j) % 3 === 0) { g.fillStyle = '#4a525d'; for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) g.fillRect(i * w + 12 + a * 12, j * w + 12 + b * 12, 4, 4); } } },
  sidewalk: (g, s) => { const r = rng(11); const n = 6, w = s / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 95 + r() * 18; g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(i * w, j * w, w, w); } g.strokeStyle = 'rgba(30,30,30,.6)'; g.lineWidth = 2; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, s); g.moveTo(0, i * w); g.lineTo(s, i * w); g.stroke(); } },
};
const FLOOR_ROUGH = { tile: 0.35, wood: 0.55, stone: 0.6, tech: 0.7, sidewalk: 0.9 };
const TEX_METERS = { tile: 4, wood: 3, stone: 4, tech: 3.6, sidewalk: 6 };

export function textTexture(lines, { w = 1024, h = 256, bg = '#c40000', fg = '#ffffff', sub = '#ffd5d5' } = {}) {
  return canvasTex(w, (g) => {
    g.canvas.height = h;
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${Math.round(h * 0.3)}px Segoe UI, Roboto, sans-serif`;
    g.fillText(lines[0], w / 2, h * (lines[1] ? 0.4 : 0.5));
    if (lines[1]) { g.fillStyle = sub; g.font = `500 ${Math.round(h * 0.13)}px Segoe UI, Roboto, sans-serif`; g.fillText(lines[1], w / 2, h * 0.75); }
  });
}

// ---------- materiais compartilhados ----------
export function createMaterials() {
  const m = (o) => new THREE.MeshStandardMaterial(o);
  return {
    wall: m({ color: 0xe9e5dd, roughness: 0.92 }),
    wallExt: m({ color: 0xd6d1c7, roughness: 0.95 }),
    low: m({ color: 0x8b6a4a, roughness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fd4ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.2 }),
    frame: m({ color: 0x2a2f36, roughness: 0.4, metalness: 0.7 }),
    ceiling: m({ color: 0xf2f2ef, roughness: 0.95, side: THREE.FrontSide }),
    lightPanel: m({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.6 }),
    red: m({ color: 0xc40000, roughness: 0.45 }),
    redFabric: m({ color: 0xa3141b, roughness: 0.85 }),
    white: m({ color: 0xf4f4f2, roughness: 0.4 }),
    wood: m({ color: 0x9a7552, roughness: 0.55 }),
    darkWood: m({ color: 0x4a3626, roughness: 0.6 }),
    black: m({ color: 0x15181c, roughness: 0.5, metalness: 0.3 }),
    rack: m({ color: 0x1a1d22, roughness: 0.4, metalness: 0.6 }),
    steel: m({ color: 0x8b939c, roughness: 0.3, metalness: 0.9 }),
    device: m({ color: 0x2b3038, roughness: 0.45, metalness: 0.5 }),
    deviceLight: m({ color: 0xe8eaec, roughness: 0.5 }),
    screen: m({ color: 0x0a1a2a, emissive: 0x1e6fb8, emissiveIntensity: 0.6, roughness: 0.2 }),
    plantPot: m({ color: 0x3b3f45, roughness: 0.7 }),
    leaf: m({ color: 0x2f7d3b, roughness: 0.8, flatShading: true }),
    ground: m({ color: 0x1b1f24, roughness: 1 }),
    locked: new THREE.MeshBasicMaterial({ color: 0x0b1a33, transparent: true, opacity: 0.55, depthWrite: false }),
    ledGreen: new THREE.MeshBasicMaterial({ color: 0x22ff88 }),
  };
}

// ---------- arquitetura ----------
export function buildAgency(layout, mats, { hideRestricted = false } = {}) {
  const group = new THREE.Group();
  group.name = 'agency';
  const H = layout.bounds.wallHeight;
  const out = { group, walls: [], glass: [], ceilings: [], floors: new Map(), colliders: [], lockedRooms: [] };

  // entorno: calçada + piso externo
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mats.ground);
  ground.rotation.x = -Math.PI / 2; ground.position.set(16, -0.02, 11); ground.receiveShadow = true;
  group.add(ground);
  const sw = new THREE.Mesh(new THREE.PlaneGeometry(44, 8), new THREE.MeshStandardMaterial({ map: canvasTex(512, FLOOR_DRAW.sidewalk, [44 / 6, 8 / 6]), roughness: 0.9 }));
  sw.rotation.x = -Math.PI / 2; sw.position.set(16, -0.01, 26); sw.receiveShadow = true;
  group.add(sw);

  // pisos por ambiente
  const texCache = {};
  for (const r of layout.rooms) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    texCache[r.floor] ??= canvasTex(512, FLOOR_DRAW[r.floor]);
    const map = texCache[r.floor].clone(); map.needsUpdate = true;
    map.repeat.set(w / TEX_METERS[r.floor], d / TEX_METERS[r.floor]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map, roughness: FLOOR_ROUGH[r.floor], metalness: 0.02 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(r.x0 + w / 2, 0, r.z0 + d / 2); floor.receiveShadow = true;
    floor.userData.roomId = r.id;
    group.add(floor);
    out.floors.set(r.id, floor);

    // teto + luminárias
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mats.ceiling);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(r.x0 + w / 2, H, r.z0 + d / 2);
    group.add(ceil); out.ceilings.push(ceil);
    for (let x = r.x0 + 1.5; x < r.x1 - 0.8; x += 3) for (let z = r.z0 + 1.5; z < r.z1 - 0.8; z += 3) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.6), mats.lightPanel);
      p.position.set(x, H - 0.02, z); group.add(p); out.ceilings.push(p);
    }

    if (hideRestricted && r.restricted) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, H - 0.1, d - 0.2), mats.locked);
      box.position.set(r.x0 + w / 2, H / 2, r.z0 + d / 2);
      group.add(box); out.lockedRooms.push(box);
    }
  }

  // paredes com vãos de porta e vergas
  for (const wall of layout.walls) {
    const horizontal = wall.a[1] === wall.b[1];
    const start = horizontal ? wall.a[0] : wall.a[1];
    const end = horizontal ? wall.b[0] : wall.b[1];
    const fixed = horizontal ? wall.a[1] : wall.a[0];
    const doors = (wall.doors || []).map((d) => [d.at - d.w / 2, d.at + d.w / 2]).sort((a, b) => a[0] - b[0]);
    const pieces = [];
    let cur = start;
    for (const [d0, d1] of doors) { if (d0 > cur) pieces.push([cur, d0]); cur = d1; }
    if (cur < end) pieces.push([cur, end]);
    const isExterior = (horizontal && (fixed === 0)) || (!horizontal && (fixed === 0 || fixed === layout.bounds.x));
    const kind = wall.kind;
    const height = kind === 'low' ? 1.1 : H;
    const thick = kind === 'glass' ? 0.06 : kind === 'low' ? 0.1 : 0.15;
    const mat = kind === 'glass' ? mats.glass : kind === 'low' ? mats.low : isExterior ? mats.wallExt : mats.wall;
    const addBox = (a0, a1, y0, y1, material, collide) => {
      const len = a1 - a0;
      if (len <= 0.001) return null;
      const geo = new THREE.BoxGeometry(horizontal ? len : thick, y1 - y0, horizontal ? thick : len);
      const mesh = new THREE.Mesh(geo, material);
      const mid = (a0 + a1) / 2;
      mesh.position.set(horizontal ? mid : fixed, (y0 + y1) / 2, horizontal ? fixed : mid);
      mesh.castShadow = material !== mats.glass; mesh.receiveShadow = true;
      group.add(mesh);
      if (collide) out.colliders.push(horizontal ? { x0: a0, x1: a1, z0: fixed - thick / 2, z1: fixed + thick / 2 } : { x0: fixed - thick / 2, x1: fixed + thick / 2, z0: a0, z1: a1 });
      return mesh;
    };
    for (const [a0, a1] of pieces) {
      const m = addBox(a0, a1, 0, height, mat, true);
      if (kind === 'glass') out.glass.push(m); else out.walls.push(m);
      if (kind === 'glass') { // caixilhos
        for (let s = a0; s <= a1 + 0.01; s += Math.max(1.2, (a1 - a0) / Math.ceil((a1 - a0) / 2))) {
          const mull = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 0.06 : 0.08, H, horizontal ? 0.08 : 0.06), mats.frame);
          mull.position.set(horizontal ? Math.min(s, a1) : fixed, H / 2, horizontal ? fixed : Math.min(s, a1));
          group.add(mull); out.walls.push(mull);
        }
      }
    }
    if (kind !== 'low') for (const [d0, d1] of doors) { const lintel = addBox(d0, d1, 2.3, H, kind === 'glass' ? mats.frame : mat, false); out.walls.push(lintel); }
  }

  // fachada: marquise vermelha e placa (sem logotipo — ativo oficial a inserir)
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(32.6, 0.7, 1.4), mats.red);
  canopy.position.set(16, H + 0.35, 22.5); canopy.castShadow = true; group.add(canopy); out.walls.push(canopy);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.62), new THREE.MeshBasicMaterial({ map: textTexture(['AGÊNCIA DEMONSTRATIVA 001', 'planta fictícia · logotipo oficial a inserir com ativo autorizado'], { w: 1400, h: 96 }) }));
  sign.position.set(16, H + 0.35, 23.21); group.add(sign); out.walls.push(sign);
  return out;
}

// ---------- mobiliário ----------
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function buildFurniture(item, mats) {
  const g = new THREE.Group();
  let collider = null;
  switch (item.kind) {
    case 'desk':
      g.add(box(1.6, 0.04, 0.75, mats.white, 0, 0.74, 0));
      g.add(box(0.04, 0.72, 0.7, mats.black, -0.76, 0.36, 0), box(0.04, 0.72, 0.7, mats.black, 0.76, 0.36, 0));
      g.add(box(1.6, 0.35, 0.02, mats.red, 0, 0.5, 0.36));
      g.add(box(0.55, 0.34, 0.03, mats.black, 0, 1.0, -0.15), box(0.5, 0.3, 0.005, mats.screen, 0, 1.0, -0.134), box(0.05, 0.12, 0.05, mats.black, 0, 0.82, -0.15));
      collider = [0.85, 0.42]; break;
    case 'chair':
      g.add(box(0.48, 0.07, 0.46, mats.black, 0, 0.46, 0), box(0.46, 0.5, 0.06, mats.black, 0, 0.74, -0.22));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42), mats.steel).translateY(0.21));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 16), mats.black).translateY(0.03));
      break;
    case 'sofa':
      g.add(box(2.2, 0.42, 0.85, mats.redFabric, 0, 0.21, 0), box(2.2, 0.45, 0.2, mats.redFabric, 0, 0.62, 0.33), box(0.18, 0.6, 0.85, mats.redFabric, -1.1, 0.3, 0), box(0.18, 0.6, 0.85, mats.redFabric, 1.1, 0.3, 0));
      collider = [1.2, 0.45]; break;
    case 'counter':
      g.add(box(4.2, 1.05, 0.7, mats.white, 0, 0.525, 0), box(4.2, 0.05, 0.9, mats.wood, 0, 1.08, 0.1), box(4.2, 0.14, 0.02, mats.red, 0, 0.75, 0.36));
      g.add(box(0.5, 0.32, 0.03, mats.black, -1, 1.28, -0.1), box(0.5, 0.32, 0.03, mats.black, 1, 1.28, -0.1));
      collider = [2.15, 0.45]; break;
    case 'table':
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 24), mats.wood).translateY(0.48), new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.46), mats.black).translateY(0.23));
      collider = [0.45, 0.45]; break;
    case 'meeting':
      g.add(box(2.6, 0.05, 1.1, mats.darkWood, 0, 0.74, 0), box(0.12, 0.72, 0.6, mats.black, -0.9, 0.36, 0), box(0.12, 0.72, 0.6, mats.black, 0.9, 0.36, 0));
      for (const [x, z, r] of [[-0.8, -0.85, 0], [0, -0.85, 0], [0.8, -0.85, 0], [-0.8, 0.85, Math.PI], [0, 0.85, Math.PI], [0.8, 0.85, Math.PI]]) { const c = buildFurniture({ kind: 'chair' }, mats).group; c.position.set(x, 0, z); c.rotation.y = r; g.add(c); }
      collider = [1.35, 0.6]; break;
    case 'rack':
      g.add(box(0.8, 2.1, 0.9, mats.rack, 0, 1.05, 0));
      for (let y = 0.3; y < 2.0; y += 0.17) g.add(box(0.7, 0.01, 0.01, mats.steel, 0, y, 0.455));
      collider = [0.42, 0.47]; break;
    case 'stall':
      g.add(box(0.05, 2.0, 1.6, mats.white, -0.95, 1.1, 0), box(0.05, 2.0, 1.6, mats.white, 0.95, 1.1, 0), box(1.9, 2.0, 0.04, mats.wood, 0, 1.1, 0.8));
      break;
    case 'plant': {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.45, 16), mats.plantPot).translateY(0.225));
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mats.leaf); leaves.position.y = 0.9; leaves.scale.set(1, 1.3, 1); leaves.castShadow = true; g.add(leaves);
      collider = [0.25, 0.25]; break;
    }
    case 'planter':
      g.add(box(7, 0.45, 0.9, mats.plantPot, 0, 0.225, 0));
      for (let x = -3; x <= 3; x += 0.75) { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), mats.leaf); l.position.set(x, 0.62, 0); g.add(l); }
      collider = [3.5, 0.45]; break;
    case 'brandwall': {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 1.3), new THREE.MeshStandardMaterial({ map: textTexture(['SENTINEL 3D', 'AGÊNCIA DEMONSTRATIVA · inserir identidade visual oficial apenas com ativos autorizados'], { w: 1400, h: 330 }), roughness: 0.5 }));
      panel.position.set(0, 2.05, 0.02); g.add(panel);
      g.add(box(5.8, 1.5, 0.04, mats.darkWood, 0, 2.05, 0));
      break;
    }
    default: break;
  }
  g.position.set(item.x, 0, item.z);
  g.rotation.y = item.rot || 0;
  const c = collider && rotateCollider(item, collider);
  return { group: g, collider: c };
}

function rotateCollider(item, [hx, hz]) {
  const swap = Math.abs(Math.sin(item.rot || 0)) > 0.7;
  const [ax, az] = swap ? [hz, hx] : [hx, hz];
  return { x0: item.x - ax, x1: item.x + ax, z0: item.z - az, z1: item.z + az };
}

// ---------- equipamentos ----------
/** Orientação: o equipamento olha para o centro do seu ambiente, a partir da parede mais próxima. */
export function facingFor(device, room) {
  const [x, , z] = device.pos;
  const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
  const dx = Math.min(Math.abs(x - room.x0), Math.abs(x - room.x1));
  const dz = Math.min(Math.abs(z - room.z0), Math.abs(z - room.z1));
  if (dx < dz) return Math.atan2(Math.sign(cx - x), 0);       // olha ±x
  return Math.atan2(0, Math.sign(cz - z) || 1);               // olha ±z
}

export function buildDevice(device, mats, room) {
  const g = new THREE.Group();
  const add = (...ms) => ms.forEach((m) => g.add(m));
  const rackItem = (h = 0.075, mat = mats.device) => { add(box(0.62, h, 0.05, mat, 0, 0, 0)); for (let i = 0; i < 3; i++) add(box(0.015, 0.015, 0.01, mats.ledGreen, -0.26 + i * 0.03, 0, 0.03)); };
  let collider = null;
  switch (device.type) {
    case 'camera':
      if (device.camKind === 'bullet') { add(box(0.1, 0.1, 0.28, mats.deviceLight, 0, -0.1, 0.12), box(0.05, 0.12, 0.05, mats.deviceLight, 0, 0, 0)); add(box(0.08, 0.08, 0.01, mats.black, 0, -0.1, 0.265)); }
      else if (device.camKind === 'ptz') { add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), mats.black).translateY(-0.22), box(0.04, 0.2, 0.04, mats.deviceLight, 0, -0.08, 0)); }
      else { add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 24), mats.deviceLight).translateY(0.06), new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.5 })).rotateX(Math.PI).translateY(-0.04)); }
      break;
    case 'router': case 'firewall': case 'switch': case 'gateway': rackItem(0.075); break;
    case 'nvr': case 'vms': case 'storage': rackItem(0.14); break;
    case 'server': rackItem(0.11, mats.rack); break;
    case 'pdu': add(box(0.06, 1.6, 0.06, mats.black, 0, 0, 0)); break;
    case 'ups': add(box(0.55, 1.2, 0.8, mats.device, 0, 0, 0), box(0.18, 0.1, 0.005, mats.screen, 0, 0.35, 0.403)); collider = [0.3, 0.42]; break;
    case 'meter': case 'facp': case 'alarmpanel': case 'access':
      add(box(0.42, 0.52, 0.12, device.type === 'facp' ? mats.red : mats.deviceLight, 0, 0, 0), box(0.22, 0.1, 0.005, mats.screen, 0, 0.12, 0.063)); break;
    case 'smoke': add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 20), mats.deviceLight)); break;
    case 'mcp': add(box(0.12, 0.12, 0.05, mats.red, 0, 0, 0)); break;
    case 'sensor': case 'th': add(box(0.08, 0.1, 0.03, mats.deviceLight, 0, 0, 0)); break;
    case 'reader': add(box(0.08, 0.13, 0.03, mats.black, 0, 0, 0)); break;
    case 'leak': add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), mats.deviceLight)); break;
    case 'hvac': add(box(1.0, 0.3, 0.22, mats.deviceLight, 0, 0, 0), box(0.9, 0.02, 0.05, mats.black, 0, -0.13, 0.09)); break;
    case 'ap': add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.035, 24), mats.deviceLight)); break;
    case 'vault': {
      add(box(1.6, 2.0, 1.2, mats.steel, 0, 0, 0), box(1.3, 1.7, 0.02, new THREE.MeshStandardMaterial({ color: 0x6e767f, metalness: 0.95, roughness: 0.25 }), 0, 0, 0.61));
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 10, 32), mats.black); wheel.position.set(0.3, 0, 0.64); add(wheel);
      collider = [0.85, 0.65]; break;
    }
    case 'atm': {
      add(box(0.8, 1.6, 0.7, mats.deviceLight, 0, 0, 0), box(0.8, 0.25, 0.71, mats.red, 0, 0.62, 0), box(0.42, 0.32, 0.01, mats.screen, 0, 0.18, 0.355));
      add(box(0.5, 0.06, 0.18, mats.black, 0, -0.12, 0.42));
      collider = [0.45, 0.4]; break;
    }
    case 'totem': add(box(0.45, 1.6, 0.3, mats.white, 0, 0, 0), box(0.32, 0.45, 0.01, mats.screen, 0, 0.3, 0.155), box(0.45, 0.12, 0.31, mats.red, 0, 0.75, 0)); collider = [0.25, 0.2]; break;
    default: add(box(0.2, 0.2, 0.2, mats.device, 0, 0, 0));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.deviceId = device.id; } });
  g.position.set(...device.pos);
  const inRack = ['router', 'firewall', 'switch', 'gateway', 'nvr', 'vms', 'storage', 'server', 'pdu'].includes(device.type);
  if (room && !inRack) g.rotation.y = facingFor(device, room); // itens de rack sempre de frente para +z
  g.userData.deviceId = device.id;
  const c = collider && rotateCollider({ x: device.pos[0], z: device.pos[2], rot: g.rotation.y }, collider);
  return { group: g, collider: c };
}

// ---------- marcadores de estado (forma + cor) ----------
const markerCache = new Map();
export function markerTexture(status, color) {
  const key = status;
  if (markerCache.has(key)) return markerCache.get(key);
  const s = 128;
  const c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2); g.fillStyle = 'rgba(8,12,18,.88)'; g.fill();
  g.lineWidth = 9; g.strokeStyle = color; g.stroke();
  g.save(); g.translate(s / 2 - 36, s / 2 - 36); g.scale(4.5, 4.5); g.fillStyle = color; g.fill(new Path2D(ICON_PATHS[status])); g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  markerCache.set(key, t);
  return t;
}

export function selectionTexture() {
  const s = 128; const c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = '#22d3ee'; g.setLineDash([14, 8]); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
