// Libreria di oggetti 3D procedurali (stile low-poly) per lo short "Dinosauri per 10 anni".
import * as THREE from './node_modules/three/build/three.module.js';

export { THREE };

// ---------- PRNG deterministico ----------
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIn = (t) => Math.pow(clamp(t, 0, 1), 3);
export const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- materiali ----------
export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.85, metalness: 0.0 }, opts));
}
const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

export function box(w, h, d, m, pos = [0, 0, 0]) {
  const g = cached(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  const mesh = new THREE.Mesh(g, m); mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}
export function sphere(r, m, pos = [0, 0, 0], seg = 10) {
  const g = cached(`sph${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))));
  const mesh = new THREE.Mesh(g, m); mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}
export function cyl(rt, rb, h, m, pos = [0, 0, 0], seg = 8) {
  const g = cached(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  const mesh = new THREE.Mesh(g, m); mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}
export function cone(r, h, m, pos = [0, 0, 0], seg = 6) {
  const g = cached(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
  const mesh = new THREE.Mesh(g, m); mesh.position.set(...pos); mesh.castShadow = true; return mesh;
}
export function group(pos = [0, 0, 0], parent) { const g = new THREE.Group(); g.position.set(...pos); if (parent) parent.add(g); return g; }

// ---------- texture finestre per i palazzi ----------
export function windowTexture(seed, lit = 0.55, night = true) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const ctx = c.getContext('2d'); const r = rng(seed);
  ctx.fillStyle = night ? '#1a1f2b' : '#d7dbe2'; ctx.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 256; y += 16) for (let x = 6; x < 128; x += 16) {
    const on = r() < lit;
    ctx.fillStyle = night ? (on ? (r() < 0.5 ? '#ffd27a' : '#cfe7ff') : '#0b0e14') : (on ? '#9fc3e6' : '#4a5a6e');
    ctx.fillRect(x, y, 9, 11);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function building(w, h, d, tex, color = '#5c6473', night = true) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, map: tex, emissiveMap: night ? tex : null, emissive: night ? new THREE.Color('#ffffff') : new THREE.Color('#000'), emissiveIntensity: night ? 0.9 : 0 });
  const geo = new THREE.BoxGeometry(w, h, d);
  tex = tex.clone(); tex.needsUpdate = true; tex.repeat.set(Math.max(1, Math.round(w / 10)), Math.max(1, Math.round(h / 20)));
  m.map = tex; if (night) m.emissiveMap = tex;
  const b = new THREE.Mesh(geo, m); b.position.y = h / 2; b.castShadow = true; b.receiveShadow = true; g.add(b);
  const roof = box(w * 0.98, 0.6, d * 0.98, mat('#2a2f3a'), [0, h + 0.3, 0]); g.add(roof);
  if (h > 40) { const ant = cyl(0.15, 0.3, 6, mat('#333'), [w * 0.2, h + 3, 0]); g.add(ant); const lamp = sphere(0.5, new THREE.MeshBasicMaterial({ color: '#ff3b3b' }), [w * 0.2, h + 6.2, 0], 6); g.add(lamp); }
  return g;
}

// ---------- alberi ----------
export function tree(h = 8, r, kind = 'pine', colors = ['#2f7d3a', '#3f9a46', '#246b32']) {
  const g = new THREE.Group(); const rr = r || rng(1);
  const trunk = cyl(0.25 * h / 8, 0.4 * h / 8, h * 0.45, mat('#6b4a2b'), [0, h * 0.22, 0], 6); g.add(trunk);
  const col = mat(rr.pick(colors));
  if (kind === 'pine') {
    for (let i = 0; i < 3; i++) { const c = cone(h * (0.32 - i * 0.07), h * 0.35, col, [0, h * (0.5 + i * 0.2), 0], 7); g.add(c); }
  } else {
    const s = sphere(h * 0.3, col, [0, h * 0.7, 0], 7); g.add(s);
    const s2 = sphere(h * 0.22, col, [h * 0.18, h * 0.55, h * 0.1], 6); g.add(s2);
    const s3 = sphere(h * 0.2, col, [-h * 0.15, h * 0.6, -h * 0.1], 6); g.add(s3);
  }
  return g;
}
export function deadTree(h = 7) {
  const g = new THREE.Group(); const m = mat('#4a4038');
  g.add(cyl(0.15, 0.4, h, m, [0, h / 2, 0], 6));
  const b1 = cyl(0.06, 0.15, h * 0.5, m, [0, h * 0.75, 0], 5); b1.rotation.z = 0.7; b1.position.x = h * 0.12; g.add(b1);
  const b2 = cyl(0.06, 0.15, h * 0.4, m, [0, h * 0.6, 0], 5); b2.rotation.z = -0.9; b2.position.x = -h * 0.1; g.add(b2);
  return g;
}

// ---------- auto ----------
export function car(color = '#d33') {
  const g = new THREE.Group(); const body = mat(color, { roughness: 0.4, metalness: 0.3 });
  g.add(box(4.2, 1.0, 1.9, body, [0, 0.8, 0]));
  g.add(box(2.2, 0.8, 1.7, mat('#222a33', { roughness: 0.2, metalness: 0.5 }), [-0.2, 1.7, 0]));
  const wm = mat('#111');
  for (const [x, z] of [[1.4, 1], [1.4, -1], [-1.4, 1], [-1.4, -1]]) { const w = cyl(0.42, 0.42, 0.35, wm, [x, 0.42, z], 10); w.rotation.x = Math.PI / 2; g.add(w); }
  const hl = new THREE.MeshBasicMaterial({ color: '#fff6c8' });
  g.add(box(0.1, 0.25, 0.4, hl, [2.12, 0.9, 0.6])); g.add(box(0.1, 0.25, 0.4, hl, [2.12, 0.9, -0.6]));
  const tl = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
  g.add(box(0.1, 0.2, 0.4, tl, [-2.12, 0.9, 0.6])); g.add(box(0.1, 0.2, 0.4, tl, [-2.12, 0.9, -0.6]));
  return g;
}
export function bus(color = '#f2c230') {
  const g = new THREE.Group();
  g.add(box(11, 3.0, 2.6, mat(color, { roughness: 0.5 }), [0, 2.0, 0]));
  g.add(box(10.4, 1.1, 2.7, mat('#1b2735', { roughness: 0.2, metalness: 0.5 }), [0, 2.6, 0]));
  const wm = mat('#111');
  for (const [x, z] of [[3.5, 1.35], [3.5, -1.35], [-3.5, 1.35], [-3.5, -1.35]]) { const w = cyl(0.55, 0.55, 0.4, wm, [x, 0.55, z], 10); w.rotation.x = Math.PI / 2; g.add(w); }
  return g;
}

// ---------- umano (corre) ----------
export function human(shirt = '#3b82f6', pants = '#223') {
  const g = new THREE.Group(); const skin = mat('#e8b58a');
  const torso = box(0.5, 0.75, 0.3, mat(shirt), [0, 1.15, 0]); g.add(torso);
  g.add(sphere(0.22, skin, [0, 1.75, 0], 8));
  const legL = box(0.2, 0.75, 0.22, mat(pants), [0, -0.37, 0]); const pivL = group([0.14, 0.78, 0], g); pivL.add(legL);
  const legR = box(0.2, 0.75, 0.22, mat(pants), [0, -0.37, 0]); const pivR = group([-0.14, 0.78, 0], g); pivR.add(legR);
  const armL = box(0.14, 0.6, 0.14, mat(shirt), [0, -0.3, 0]); const apL = group([0.34, 1.5, 0], g); apL.add(armL);
  const armR = box(0.14, 0.6, 0.14, mat(shirt), [0, -0.3, 0]); const apR = group([-0.34, 1.5, 0], g); apR.add(armR);
  g.userData.anim = (t, phase = 0, speed = 9) => {
    const s = Math.sin(t * speed + phase);
    pivL.rotation.x = s * 0.9; pivR.rotation.x = -s * 0.9; apL.rotation.x = -s * 1.0; apR.rotation.x = s * 1.0;
    g.position.y = Math.abs(Math.cos(t * speed + phase)) * 0.12; torso.rotation.x = 0.25;
  };
  return g;
}

// ---------- T-REX ----------
export function trex(opts = {}) {
  const color = opts.color || '#6f7f3a', belly = opts.belly || '#c9c08a', scale = opts.scale || 1;
  const g = new THREE.Group(); const m = mat(color), mb = mat(belly);
  const root = group([0, 4.2, 0], g);           // bacino
  // corpo
  const body = sphere(1.0, m, [0, 0, 0], 10); body.scale.set(2.4, 1.3, 1.1); root.add(body);
  const chest = sphere(1.0, m, [1.9, 0.35, 0], 10); chest.scale.set(1.5, 1.15, 1.0); root.add(chest);
  const bel = sphere(1.0, mb, [0.8, -0.35, 0], 10); bel.scale.set(2.0, 0.8, 0.9); root.add(bel);
  // collo + testa
  const neck = group([3.1, 0.7, 0], root);
  const neckM = cyl(0.55, 0.75, 1.6, m, [0.5, 0.5, 0], 8); neckM.rotation.z = -1.1; neck.add(neckM);
  const head = group([1.3, 1.1, 0], neck);
  const skull = box(2.3, 1.15, 1.05, m, [0.9, 0.2, 0]); head.add(skull);
  const brow = box(1.1, 0.5, 1.15, m, [0.2, 0.75, 0]); head.add(brow);
  const snout = box(1.0, 0.7, 0.85, m, [2.2, 0.0, 0]); head.add(snout);
  const jaw = group([0.1, -0.35, 0], head);
  jaw.add(box(2.4, 0.5, 0.9, m, [1.1, -0.2, 0]));
  jaw.add(box(2.3, 0.3, 0.8, mat('#8c2f3a'), [1.1, 0.0, 0]));
  const tooth = mat('#f5f0dc');
  for (let i = 0; i < 6; i++) { const tt = cone(0.08, 0.28, tooth, [0.5 + i * 0.36, -0.38, 0.4]); tt.rotation.x = Math.PI; head.add(tt); const t2 = tt.clone(); t2.position.z = -0.4; head.add(t2); }
  for (let i = 0; i < 5; i++) { const tt = cone(0.07, 0.24, tooth, [0.7 + i * 0.38, 0.1, 0.38]); jaw.add(tt); const t2 = tt.clone(); t2.position.z = -0.38; jaw.add(t2); }
  const eyeM = new THREE.MeshBasicMaterial({ color: '#ffd84a' }), pupM = new THREE.MeshBasicMaterial({ color: '#000' });
  for (const z of [0.56, -0.56]) { head.add(sphere(0.16, eyeM, [0.35, 0.55, z], 8)); head.add(sphere(0.08, pupM, [0.45, 0.55, z * 1.15], 6)); }
  // braccine
  for (const z of [0.6, -0.6]) { const a = cyl(0.12, 0.18, 0.9, m, [0, -0.45, 0], 6); const ap = group([2.6, -0.2, z], root); a.rotation.x = 0; ap.rotation.z = 0.6; ap.add(a); }
  // coda
  const tail = []; let parent = root; let x = -1.8;
  for (let i = 0; i < 7; i++) { const seg = group([i === 0 ? -1.8 : -1.25, i === 0 ? 0.1 : -0.02, 0], parent); const r = 0.75 - i * 0.095; const s = sphere(1, m, [-0.6, 0, 0], 8); s.scale.set(0.95, r, r * 0.9); seg.add(s); tail.push(seg); parent = seg; }
  // gambe
  const legs = [];
  for (const z of [0.75, -0.75]) {
    const hip = group([-0.2, -0.3, z], root);
    const thigh = sphere(1, m, [0.5, -0.9, 0], 8); thigh.scale.set(0.75, 1.3, 0.6); hip.add(thigh);
    const knee = group([0.9, -1.9, 0], hip);
    const shin = cyl(0.32, 0.45, 1.9, m, [-0.3, -0.9, 0], 8); shin.rotation.z = 0.3; knee.add(shin);
    const ankle = group([-0.6, -1.8, 0], knee);
    const foot = box(1.5, 0.4, 0.9, m, [0.45, -0.1, 0]); ankle.add(foot);
    for (const dz of [-0.3, 0, 0.3]) { const claw = cone(0.12, 0.45, tooth, [1.3, -0.15, dz]); claw.rotation.z = -Math.PI / 2; ankle.add(claw); }
    legs.push({ hip, knee, ankle });
  }
  g.scale.setScalar(scale);
  g.userData.parts = { root, neck, head, jaw, tail, legs };
  // animazione: t tempo, speed passo, roar 0..1 apertura bocca, idle=true respiro
  g.userData.anim = (t, { speed = 1.6, phase = 0, roar = 0, stride = 1, lookUp = 0, headTurn = 0, lying = 0 } = {}) => {
    const w = t * speed * Math.PI + phase;
    root.position.y = 4.2 - lying * 2.6 + Math.abs(Math.sin(w)) * 0.18 * stride;
    root.rotation.z = -0.08 + Math.sin(w * 2) * 0.02 * stride + lying * 0.0;
    root.rotation.y = Math.sin(w) * 0.04 * stride;
    legs.forEach((L, i) => {
      const ph = w + i * Math.PI; const s = Math.sin(ph), c = Math.cos(ph);
      L.hip.rotation.z = (-0.35 + s * 0.55) * stride + lying * 1.2;
      L.knee.rotation.z = (0.55 + Math.max(0, -c) * 0.9) * stride + lying * 0.8;
      L.ankle.rotation.z = (-0.3 + Math.max(0, -s) * 0.6) * stride - lying * 1.8;
    });
    tail.forEach((seg, i) => { seg.rotation.y = Math.sin(w * 0.5 - i * 0.6) * 0.14 * (0.4 + stride); seg.rotation.z = 0.04 + Math.sin(t * 1.3 - i * 0.5) * 0.03; });
    neck.rotation.z = -0.15 + lookUp * 0.6 + Math.sin(w * 2) * 0.03 * stride - roar * 0.35;
    head.rotation.z = 0.2 - lookUp * 0.2 + roar * 0.25; head.rotation.y = headTurn;
    jaw.rotation.z = -roar * 0.7 - (Math.max(0, Math.sin(t * 0.7)) * 0.05 * (1 - roar));
  };
  return g;
}

// ---------- BRACHIOSAURO ----------
export function brachio(opts = {}) {
  const color = opts.color || '#8a7f5a', scale = opts.scale || 1;
  const g = new THREE.Group(); const m = mat(color), mb = mat('#d8cfa8');
  const root = group([0, 6.2, 0], g);
  const body = sphere(1, m, [0, 0, 0], 10); body.scale.set(3.8, 2.2, 1.9); root.add(body);
  const bel = sphere(1, mb, [0, -0.6, 0], 10); bel.scale.set(3.2, 1.6, 1.7); root.add(bel);
  const hump = sphere(1, m, [-1.5, 1.2, 0], 8); hump.scale.set(1.6, 1.0, 1.4); root.add(hump);
  // collo
  const neckSegs = []; let parent = group([3.3, 1.0, 0], root); neckSegs.push(parent);
  for (let i = 0; i < 8; i++) { const r = 0.95 - i * 0.07; const s = cyl(r * 0.85, r, 1.55, m, [0, 0.75, 0], 8); parent.add(s); const nxt = group([0, 1.5, 0], parent); neckSegs.push(nxt); parent = nxt; }
  const head = parent; head.add(box(1.3, 0.75, 0.75, m, [0.35, 0.35, 0])); head.add(box(0.9, 0.5, 0.6, m, [1.1, 0.2, 0]));
  const eyeM = new THREE.MeshBasicMaterial({ color: '#111' });
  for (const z of [0.4, -0.4]) head.add(sphere(0.1, eyeM, [0.5, 0.55, z], 6));
  // coda
  const tail = []; parent = root;
  for (let i = 0; i < 9; i++) { const seg = group([i === 0 ? -3.4 : -1.35, i === 0 ? 0.3 : -0.1, 0], parent); const r = 0.85 - i * 0.085; const s = sphere(1, m, [-0.7, 0, 0], 8); s.scale.set(1.0, r, r); seg.add(s); tail.push(seg); parent = seg; }
  // 4 zampe
  const legs = [];
  for (const [x, z] of [[2.2, 1.1], [2.2, -1.1], [-2.2, 1.2], [-2.2, -1.2]]) {
    const hip = group([x, -1.2, z], root); const leg = cyl(0.55, 0.7, 5.0, m, [0, -2.4, 0], 8); hip.add(leg);
    hip.add(cyl(0.8, 0.85, 0.5, mat('#555048'), [0, -4.9, 0], 8)); legs.push(hip);
  }
  g.scale.setScalar(scale);
  g.userData.anim = (t, { speed = 0.5, phase = 0, eat = 0, lying = 0 } = {}) => {
    const w = t * speed * Math.PI * 2 + phase;
    root.position.y = 6.2 - lying * 4.6 + Math.sin(w * 2) * 0.08;
    legs.forEach((L, i) => { L.rotation.z = Math.sin(w + (i % 2) * Math.PI + (i > 1 ? Math.PI / 2 : 0)) * 0.25 * (1 - lying) + lying * (i > 1 ? 1.3 : -1.3); });
    // collo: eat=1 abbassa fino a terra, con oscillazione lenta
    // inclinazione in avanti: eat=1 porta la testa a terra, lying=1 stende il collo
    const first = 0.35 + eat * 0.55 + lying * 1.05, rest = 0.02 + eat * 0.12 + lying * 0.01;
    neckSegs.forEach((s, i) => { if (i === 0) { s.rotation.z = -first; s.rotation.y = Math.sin(t * 0.4 + phase) * 0.25 * eat; } else { s.rotation.z = -rest + Math.sin(t * 0.9 + i * 0.4 + phase) * 0.012; } });
    head.rotation.z = -(0.25 + eat * 0.45) + lying * 0.4 + Math.sin(t * 2.2 + phase) * 0.08 * eat;
    tail.forEach((seg, i) => { seg.rotation.y = Math.sin(t * 0.8 - i * 0.5 + phase) * 0.08; seg.rotation.z = 0.07 - lying * 0.02; });
  };
  return g;
}

// ---------- PTEROSAURO ----------
export function ptero(opts = {}) {
  const color = opts.color || '#8b5a3c', scale = opts.scale || 1;
  const g = new THREE.Group(); const m = mat(color), mw = mat('#a8684a', { side: THREE.DoubleSide });
  const body = sphere(1, m, [0, 0, 0], 8); body.scale.set(1.6, 0.55, 0.55); g.add(body);
  const head = group([1.5, 0.2, 0], g);
  head.add(box(0.8, 0.45, 0.45, m, [0, 0, 0]));
  const beak = cone(0.2, 1.6, mat('#d9b47a'), [1.1, -0.05, 0]); beak.rotation.z = -Math.PI / 2; head.add(beak);
  const crest = cone(0.18, 1.3, m, [-0.8, 0.3, 0]); crest.rotation.z = Math.PI / 2 + 0.25; head.add(crest);
  const eyeM = new THREE.MeshBasicMaterial({ color: '#ffcc33' });
  for (const z of [0.25, -0.25]) head.add(sphere(0.08, eyeM, [0.15, 0.12, z], 6));
  // ali: due segmenti per lato
  const wings = [];
  for (const side of [1, -1]) {
    const shoulder = group([0.2, 0.15, side * 0.4], g);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), mw); inner.rotation.x = Math.PI / 2; inner.position.set(-0.4, 0, side * 1.6); inner.castShadow = true; shoulder.add(inner);
    const elbow = group([-0.2, 0, side * 3.2], shoulder);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 4.2), mw); outer.rotation.x = Math.PI / 2; outer.position.set(-0.6, 0, side * 2.1); outer.castShadow = true;
    // forma affusolata: scala il piano esterno
    outer.geometry = new THREE.BufferGeometry().setFromPoints([V3(-1.3, 2.1, 0), V3(0.9, 2.1, 0), V3(-0.5, -2.1, 0), V3(-1.3, 2.1, 0), V3(-0.5, -2.1, 0), V3(-1.6, -2.1, 0)]);
    outer.geometry.computeVertexNormals();
    elbow.add(outer); wings.push({ shoulder, elbow, side });
  }
  // zampe
  for (const z of [0.2, -0.2]) { const l = cyl(0.05, 0.08, 0.9, m, [-0.6, -0.5, z], 5); l.rotation.z = 0.5; g.add(l); }
  g.scale.setScalar(scale);
  g.userData.anim = (t, { flap = 3.2, phase = 0, glide = 0 } = {}) => {
    const s = Math.sin(t * flap + phase) * (1 - glide);
    wings.forEach(W => { W.shoulder.rotation.x = W.side * (s * 0.6 + glide * 0.1); W.elbow.rotation.x = W.side * (Math.sin(t * flap + phase - 0.8) * 0.5 * (1 - glide) - glide * 0.15); });
    g.rotation.z = Math.sin(t * 0.7 + phase) * 0.06; head.rotation.z = -0.2 + Math.sin(t * 1.1 + phase) * 0.08;
  };
  return g;
}

// ---------- ELICOTTERO ----------
export function heli(color = '#3a4a3a') {
  const g = new THREE.Group(); const m = mat(color, { roughness: 0.5, metalness: 0.3 });
  const body = sphere(1, m, [0, 0, 0], 10); body.scale.set(2.6, 1.3, 1.3); g.add(body);
  g.add(box(0.6, 1.1, 0.9, mat('#1b2735', { roughness: 0.15, metalness: 0.6 }), [1.9, 0.2, 0]));
  const tailB = cyl(0.18, 0.4, 4.5, m, [-3.5, 0.3, 0], 6); tailB.rotation.z = Math.PI / 2; g.add(tailB);
  g.add(box(0.15, 1.3, 0.5, m, [-5.6, 0.9, 0]));
  const rotor = group([0, 1.4, 0], g); rotor.add(box(11, 0.08, 0.5, mat('#222'))); rotor.add(box(0.5, 0.08, 11, mat('#222')));
  const tr = group([-5.7, 0.9, 0.3], g); tr.add(box(0.08, 2.2, 0.3, mat('#222')));
  for (const z of [0.6, -0.6]) g.add(box(2.6, 0.1, 0.12, mat('#222'), [0, -1.1, z]));
  const light = new THREE.SpotLight('#fff3c4', 4000, 120, 0.22, 0.5, 1.2); light.position.set(1.5, -0.6, 0); light.castShadow = false; g.add(light); g.add(light.target); light.target.position.set(6, -40, 0);
  g.userData.anim = (t) => { rotor.rotation.y = t * 40; tr.rotation.x = t * 60; light.target.position.set(6 + Math.sin(t * 0.8) * 8, -40, Math.cos(t * 0.6) * 10); };
  return g;
}

// ---------- DRONE ----------
export function drone() {
  const g = new THREE.Group(); const m = mat('#2b2f36', { metalness: 0.4, roughness: 0.5 });
  g.add(box(1.2, 0.3, 1.2, m)); const rotors = [];
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const arm = box(1.4, 0.1, 0.12, m, [x * 0.7, 0, z * 0.7]); arm.rotation.y = Math.atan2(z, x); g.add(arm); const r = group([x * 1.2, 0.15, z * 1.2], g); r.add(box(1.2, 0.03, 0.12, mat('#999'))); rotors.push(r); }
  g.add(sphere(0.12, new THREE.MeshBasicMaterial({ color: '#ff3030' }), [0.5, -0.1, 0], 6)); g.add(sphere(0.12, new THREE.MeshBasicMaterial({ color: '#30ff60' }), [-0.5, -0.1, 0], 6));
  g.userData.anim = (t) => rotors.forEach((r, i) => r.rotation.y = t * 50 * (i % 2 ? 1 : -1));
  return g;
}

// ---------- AEREO ----------
export function plane(color = '#f4f4f4') {
  const g = new THREE.Group(); const m = mat(color, { roughness: 0.4, metalness: 0.2 });
  const fus = cyl(1.6, 1.6, 30, m, [0, 0, 0], 12); fus.rotation.z = Math.PI / 2; g.add(fus);
  const nose = sphere(1.6, m, [15, 0, 0], 10); nose.scale.set(1.8, 1, 1); g.add(nose);
  const tailc = cone(1.6, 7, m, [-18.5, 0.3, 0], 12); tailc.rotation.z = Math.PI / 2; g.add(tailc);
  const wing = box(5, 0.35, 32, m, [1, -0.5, 0]); wing.rotation.y = 0.12; g.add(wing);
  g.add(box(3, 0.3, 11, m, [-18, 0.8, 0])); const fin = box(4, 6, 0.3, mat('#d4261c'), [-18.5, 3.5, 0]); fin.rotation.z = -0.5; g.add(fin);
  for (const z of [6, -6]) { const eng = cyl(1.0, 1.0, 3.5, mat('#888', { metalness: 0.6, roughness: 0.3 }), [3, -1.8, z], 10); eng.rotation.z = Math.PI / 2; g.add(eng); }
  const stripe = box(31, 0.5, 3.3, mat('#2563eb'), [-1, 0.6, 0]); g.add(stripe);
  return g;
}

// ---------- SCHELETRO T-REX ----------
export function skeleton(scale = 1) {
  const g = new THREE.Group(); const m = mat('#e9e2cf', { roughness: 0.6 });
  // colonna
  for (let i = 0; i < 16; i++) { const s = sphere(0.32 - i * 0.012, m, [i * 0.85 - 6, 2.2 + Math.sin(i * 0.3) * 0.3, 0], 7); g.add(s); }
  // costole
  for (let i = 3; i < 9; i++) { for (const side of [1, -1]) { const rib = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.07, 6, 10, Math.PI * 0.9), m); rib.position.set(i * 0.85 - 6, 2.0, 0); rib.rotation.y = Math.PI / 2; rib.rotation.x = side > 0 ? 0.1 : Math.PI - 0.1; rib.rotation.z = 0; rib.castShadow = true; g.add(rib); } }
  // cranio
  const sk = group([8.2, 2.6, 0], g); sk.add(box(2.4, 1.0, 1.0, m, [0.8, 0.3, 0])); sk.add(box(1.2, 0.7, 0.8, m, [2.3, 0.1, 0])); sk.add(box(2.6, 0.35, 0.9, m, [1.0, -0.5, 0]));
  for (const z of [0.52, -0.52]) sk.add(sphere(0.25, mat('#111'), [0.4, 0.55, z], 6));
  for (let i = 0; i < 6; i++) { const t1 = cone(0.07, 0.3, m, [0.5 + i * 0.35, -0.15, 0.42]); t1.rotation.x = Math.PI; sk.add(t1); const t2 = t1.clone(); t2.position.z = -0.42; sk.add(t2); }
  // bacino + gambe
  g.add(box(1.4, 1.2, 1.3, m, [-1.5, 2.0, 0]));
  for (const z of [0.7, -0.7]) { const th = cyl(0.14, 0.2, 2.0, m, [-1.2, 1.1, z], 6); th.rotation.z = -0.4; g.add(th); const sh = cyl(0.1, 0.15, 1.8, m, [-0.4, 0.5, z], 6); sh.rotation.z = 0.5; g.add(sh); g.add(box(1.2, 0.15, 0.6, m, [0.1, 0.1, z])); }
  g.scale.setScalar(scale); return g;
}

// ---------- texture sprite (fumo/neve) ----------
export function softTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- cielo a gradiente ----------
export function sky(top, bottom) {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) }, flash: { value: 0 } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float flash; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y*1.6+0.15, 0.0, 1.0); vec3 c = mix(bottom, top, pow(h,0.7)); c = mix(c, vec3(1.0), flash); gl_FragColor = vec4(c,1.0); }`
  });
  const s = new THREE.Mesh(geo, m); s.userData.mat = m; return s;
}
