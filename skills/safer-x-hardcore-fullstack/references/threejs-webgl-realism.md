# Three.js, WebGL, Realismo Gráfico e Árvores de Dados

Índice: 1. Quando usar 3D · 2. Cena base realista · 3. Modelos GLB otimizados · 4. 3D guiado por scroll e mouse · 5. Shaders e partículas · 6. React Three Fiber · 7. Orçamento de desempenho · 8. Árvores (jsTree / d3-hierarchy) · 9. Fallbacks

> "JS Tree" pode significar **Three.js** (3D) ou **jsTree** (componente de árvore). Esta referência cobre ambos; confirme com o usuário se for ambíguo e mudar a solução.

## 1. Quando usar 3D
Use se o 3D comunica algo que imagem não comunica: produto configurável, espaço navegável, dado espacial, identidade de marca imersiva. Caso contrário, vídeo otimizado (AV1/H.265 + WebM) ou imagem com parallax entrega 90% do impacto com 10% do custo.

## 2. Cena base realista (PBR)
Versão de referência: `three@0.169.0` (confira a atual; a API de imports mudou para `three/addons/...`).
```js
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));          // teto de DPR = desempenho
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;               // ou AgXToneMapping (r160+)
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
new RGBELoader().load('/env/studio_1k.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;            // iluminação baseada em imagem = realismo
});
const mat = new THREE.MeshPhysicalMaterial({
  color: 0x111111, metalness: 1, roughness: 0.25,
  clearcoat: 1, clearcoatRoughness: 0.05   // verniz automotivo
});
```
Checklist de realismo: HDRI de estúdio (Poly Haven, CC0), materiais PBR com mapas (albedo, normal, roughness, metalness, AO), tone mapping, color space sRGB na saída, sombras de contato (plano com `ShadowMaterial` ou textura assada), pós-processamento leve (bloom sutil, SMAA, vinheta). Luz assada (baking no Blender) vence luz dinâmica em realismo e desempenho.

## 3. Modelos GLB otimizados
Pipeline: Blender → glTF 2.0 (GLB) → `npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp` (ou KTX2/Basis para GPU). Meta: hero ≤ 2–5 MB. Carregue com `GLTFLoader` + `DRACOLoader`/`KTX2Loader`. Use `meshopt` quando preferir decodificação rápida.

## 4. 3D guiado por scroll e mouse
```js
gsap.to(model.rotation, { y: Math.PI * 2, ease: 'none',
  scrollTrigger: { trigger: '.product', start: 'top top', end: '+=300%', scrub: 1, pin: true } });
// mouse: rotação suave via lerp
let tx = 0, ty = 0;
addEventListener('pointermove', e => { tx = (e.clientX / innerWidth - .5) * .4; ty = (e.clientY / innerHeight - .5) * .2; });
renderer.setAnimationLoop(() => {
  model.rotation.x += (ty - model.rotation.x) * 0.05;
  camera.position.x += (tx - camera.position.x) * 0.05;
  renderer.render(scene, camera);
});
```
Com Lenis, prefira um único loop: use `gsap.ticker.add(render)` em vez de `setAnimationLoop`, ou renderize sob demanda (só quando algo muda).

## 5. Shaders e partículas
- Partículas: `THREE.Points` + `BufferGeometry` com atributo `position`; animação no vertex shader via `uniform float uTime` — nunca atualizar milhares de posições na CPU por frame.
- Distorção de imagem no hover (efeito "liquid"): plano com `ShaderMaterial`, textura da imagem, uniform `uMouse` e `uHover` animado por GSAP; ruído simplex no fragment shader.
- Use `onBeforeCompile` para estender materiais PBR em vez de reescrever iluminação.

## 6. React Three Fiber
`@react-three/fiber` + `@react-three/drei` (`<Environment preset="studio"/>`, `useGLTF`, `ScrollControls`, `ContactShadows`, `PerformanceMonitor`). Use `frameloop="demand"` quando a cena é estática fora da interação. Carregue o Canvas com `dynamic(() => import(...), { ssr: false })` no Next.js.

## 7. Orçamento de desempenho
- < 100 draw calls no mobile (use `InstancedMesh`, merge de geometrias).
- Texturas ≤ 2048² (1024² no mobile), potência de 2, compressão KTX2.
- DPR máximo 2 (1.5 em mobile modesto). Ajuste dinâmico com `PerformanceMonitor`.
- Pause o render fora da viewport (`IntersectionObserver`) e com `document.hidden`.
- Libere memória: `geometry.dispose()`, `material.dispose()`, `texture.dispose()` ao desmontar.

## 8. Árvores de dados
**jsTree** (depende de jQuery; `jstree@3.3.17`): bom para painéis administrativos com drag-and-drop, checkbox e lazy loading via AJAX:
```js
$('#tree').jstree({ core: { data: { url: '/api/nodes', data: n => ({ id: n.id }) }, check_callback: true },
  plugins: ['dnd', 'search', 'checkbox', 'state'] });
```
Segurança: o servidor deve escapar o `text` dos nós (jsTree renderiza HTML) e validar autorização a cada `move_node`.
**Sem jQuery** (apps modernos): `d3-hierarchy` para layout (tree, treemap, sunburst) + SVG/Canvas, ou componentes acessíveis (padrão WAI-ARIA `role="tree"`, `treeitem`, `aria-expanded`, setas do teclado).

## 9. Fallbacks
Detecte WebGL (`!!document.createElement('canvas').getContext('webgl2')`), `prefers-reduced-motion` e `navigator.connection?.saveData`; sirva imagem/vídeo poster equivalente. O conteúdo e o CTA nunca podem depender do canvas.
