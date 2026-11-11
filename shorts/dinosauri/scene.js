// Regia dello short: 8 scene, timeline sincronizzata con la voce, sottotitoli karaoke.
import { THREE, rng, clamp, lerp, smooth, easeOut, easeIn, easeInOut, V3, mat, box, sphere, cyl, cone, group,
  windowTexture, building, tree, deadTree, car, bus, human, trex, brachio, ptero, heli, drone, plane, skeleton, softTexture, sky } from './scene_lib.js';

const W = 1080, H = 1920, GAP = 0.45, LEAD = 0.25; // pausa fra scene; la voce parte LEAD s dopo il taglio
const $ = (id) => document.getElementById(id);

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const camera = new THREE.PerspectiveCamera(55, W / H, 0.3, 2500);
const scene = new THREE.Scene();
const sun = new THREE.DirectionalLight('#fff', 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 400 }); sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.3;
scene.add(sun); scene.add(sun.target);
const hemi = new THREE.HemisphereLight('#fff', '#444', 1); scene.add(hemi);
const camLight = new THREE.PointLight('#cfd8ff', 0, 90, 1.6); scene.add(camLight);
const rim = new THREE.DirectionalLight('#9fb8ff', 0); scene.add(rim); scene.add(rim.target);
const smokeTex = softTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');

// ---------- utilità scene ----------
function ground(color, size = 2000) { const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat(color, { flatShading: false })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; return g; }
function road(len, width, color = '#2a2c30') { const g = new THREE.Group(); const r = new THREE.Mesh(new THREE.PlaneGeometry(width, len), mat(color, { flatShading: false })); r.rotation.x = -Math.PI / 2; r.position.y = 0.02; r.receiveShadow = true; g.add(r); const dm = mat('#e8e8e8'); for (let z = -len / 2; z < len / 2; z += 8) { const d = box(0.3, 0.02, 3.5, dm, [0, 0.03, z]); g.add(d); } return g; }
function smokeColumn(parent, pos, count, r, color = '#777', spread = 6, rise = 40) {
  const m = new THREE.SpriteMaterial({ map: smokeTex, color, transparent: true, opacity: 0.55, depthWrite: false });
  const sprites = []; for (let i = 0; i < count; i++) { const s = new THREE.Sprite(m.clone()); s.position.set(...pos); parent.add(s); sprites.push({ s, off: r(), dx: r.range(-1, 1), dz: r.range(-1, 1), spin: r.range(-1, 1) }); }
  return (t, speed = 1) => sprites.forEach(({ s, off, dx, dz, spin }) => { const u = ((t * speed * 0.12) + off) % 1; s.position.set(pos[0] + dx * spread * u * 1.5 + Math.sin(t * 0.5 + off * 9) * 2, pos[1] + u * rise, pos[2] + dz * spread * u * 1.5); const sc = 6 + u * 26; s.scale.set(sc, sc, 1); s.material.opacity = 0.5 * Math.sin(u * Math.PI); s.material.rotation = spin * t * 0.3; });
}
function cloudField(parent, r, n, y = 120, spread = 500, color = '#ffffff') {
  const m = new THREE.SpriteMaterial({ map: smokeTex, color, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  for (let i = 0; i < n; i++) { const c = new THREE.Group(); c.position.set(r.range(-spread, spread), y + r.range(-20, 30), r.range(-spread, spread)); const k = Math.floor(r.range(3, 7)); for (let j = 0; j < k; j++) { const s = new THREE.Sprite(m); s.position.set(r.range(-25, 25), r.range(-5, 6), r.range(-10, 10)); const sc = r.range(25, 55); s.scale.set(sc, sc * 0.6, 1); c.add(s); } parent.add(c); }
}
function precipitation(parent, r, { n = 2500, box: B = [120, 90, 120], snow = false } = {}) {
  const pos = new Float32Array(n * 3 * (snow ? 1 : 2)); const seeds = [];
  for (let i = 0; i < n; i++) { seeds.push([r.range(-B[0] / 2, B[0] / 2), r.range(0, B[1]), r.range(-B[2] / 2, B[2] / 2), r.range(0.6, 1.4)]); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  let obj;
  if (snow) { obj = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fff', size: 0.5, map: smokeTex, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true })); }
  else { obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#aac4e0', transparent: true, opacity: 0.35 })); }
  parent.add(obj);
  return (t, center) => {
    const sp = snow ? 4 : 70; for (let i = 0; i < n; i++) { const s = seeds[i]; const y = ((s[1] - t * sp * s[3]) % B[1] + B[1]) % B[1]; const x = center.x + s[0] + (snow ? Math.sin(t * 0.8 + s[2]) * 2 : t * 6 % 1 * 0), z = center.z + s[2];
      if (snow) { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; } else { pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z; pos[i * 6 + 3] = x - 0.3; pos[i * 6 + 4] = y + 2.2; pos[i * 6 + 5] = z; } }
    geo.attributes.position.needsUpdate = true;
  };
}
function cityRing(parent, r, { count, rMin, rMax, night, hMin = 20, hMax = 80, exclude = null }) {
  const texs = [windowTexture(1, 0.55, night), windowTexture(2, 0.4, night), windowTexture(3, 0.7, night)];
  const cols = night ? ['#4b5363', '#3b4150', '#5a5f6e', '#2f3340'] : ['#b9bec8', '#d9d3c7', '#8d99a6', '#e5e1d8', '#6f7d8c'];
  for (let i = 0; i < count; i++) { const a = r() * Math.PI * 2, d = r.range(rMin, rMax); const x = Math.cos(a) * d, z = Math.sin(a) * d; if (exclude && exclude(x, z)) continue; const b = building(r.range(10, 22), r.range(hMin, hMax), r.range(10, 22), r.pick(texs), r.pick(cols), night); b.position.set(x, 0, z); b.rotation.y = r() * Math.PI; parent.add(b); }
}
function streetCanyon(parent, r, night) {
  const texs = [windowTexture(4, 0.5, night), windowTexture(5, 0.35, night)];
  for (const side of [-1, 1]) { let z = 50; while (z > -260) { const w = r.range(14, 24), h = r.range(30, 95); const b = building(w, h, r.range(16, 26), r.pick(texs), r.pick(['#3b4150', '#4b5363', '#2f3340']), night); b.position.set(side * (16 + w / 2), 0, z - 10); parent.add(b); z -= w + r.range(2, 6); } }
  // lampioni
  for (let z = 40; z > -200; z -= 18) for (const side of [-1, 1]) { const p = cyl(0.12, 0.18, 7, mat('#333'), [side * 13, 3.5, z], 6); parent.add(p); const l = sphere(0.35, new THREE.MeshBasicMaterial({ color: '#ffd9a0' }), [side * 12.2, 7, z], 6); parent.add(l); }
}
function wheatField(parent, r, { n = 7000, size = 220, exclude = null }) {
  const geo = new THREE.ConeGeometry(0.35, 2.4, 4); geo.translate(0, 1.2, 0);
  const im = new THREE.InstancedMesh(geo, mat('#e2b84a'), n); im.castShadow = false; im.receiveShadow = true;
  const dummy = new THREE.Object3D(); const items = [];
  for (let i = 0; i < n; i++) { const x = r.range(-size / 2, size / 2), z = r.range(-size / 2, size / 2); if (exclude && exclude(x, z)) { items.push(null); continue; } items.push({ x, z, s: r.range(0.8, 1.3), rot: r() * 6, ph: r() * 6 }); }
  parent.add(im);
  return (t, eaters = []) => { for (let i = 0; i < n; i++) { const it = items[i]; let s = 0; if (it) { s = it.s; for (const e of eaters) { const dx = it.x - e.x, dz = it.z - e.z; if (dx * dx + dz * dz < e.r * e.r) { s = 0; break; } } }
      if (it) { dummy.position.set(it.x, 0, it.z); dummy.rotation.set(Math.sin(t * 1.5 + it.ph) * 0.12, it.rot, 0); } else dummy.position.set(0, -10, 0); dummy.scale.set(s, s, s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); } im.instanceMatrix.needsUpdate = true; };
}
function crowd(parent, r, n, origin, spread, cols = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#eab308', '#ec4899', '#f8fafc']) {
  const people = []; for (let i = 0; i < n; i++) { const h = human(r.pick(cols), r.pick(['#223', '#334', '#542'])); h.position.set(origin[0] + r.range(-spread, spread), 0, origin[2] + r.range(-spread, spread)); h.userData.ph = r() * 6; h.userData.sp = r.range(6, 9); parent.add(h); people.push(h); } return people;
}
function farmhouse() { const g = new THREE.Group(); g.add(box(14, 7, 10, mat('#f1e4d0'), [0, 3.5, 0])); const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 7.5, 5, 4), mat('#b5452c')); roof.position.y = 9.5; roof.rotation.y = Math.PI / 4; roof.scale.set(1.45, 1, 1.0); roof.castShadow = true; g.add(roof); g.add(box(1.6, 3, 1.6, mat('#7a3b2a'), [4, 10.5, 2])); g.add(box(2, 3, 0.2, mat('#5a3a1a'), [0, 1.5, 5.05])); for (const x of [-4, 4]) g.add(box(2, 1.8, 0.2, mat('#9cc7e8'), [x, 4, 5.05])); return g; }
function tractor() { const g = new THREE.Group(); g.add(box(4, 1.6, 2.2, mat('#2e8b3a'), [0, 1.5, 0])); g.add(box(2, 1.6, 1.8, mat('#1f2937'), [-0.8, 3.1, 0])); for (const z of [1.3, -1.3]) { const w = cyl(1.2, 1.2, 0.6, mat('#111'), [-1.4, 1.2, z], 10); w.rotation.x = Math.PI / 2; g.add(w); const w2 = cyl(0.7, 0.7, 0.5, mat('#111'), [1.6, 0.7, z], 10); w2.rotation.x = Math.PI / 2; g.add(w2); } return g; }
function tower(h = 18) { const g = new THREE.Group(); g.add(cyl(1.6, 2.2, h, mat('#8d99a6'), [0, h / 2, 0], 8)); g.add(cyl(4, 2.5, 3, mat('#cfd6dd'), [0, h + 1.5, 0], 8)); g.add(cyl(3.6, 3.6, 2, mat('#1b2735', { roughness: 0.15, metalness: 0.5 }), [0, h + 4, 0], 8)); g.add(cyl(4, 3.8, 0.6, mat('#cfd6dd'), [0, h + 5.3, 0], 8)); return g; }

// ---------- SCENE ----------
const SCENES = [];

// 0 · HOOK: notte di tempesta, T-Rex avanza nella strada verso la camera
SCENES.push({ env: { skyTop: '#05070f', skyBottom: '#1b2437', fog: '#141a28', fogNear: 20, fogFar: 170, sun: ['#8fa6ff', 1.2, [-30, 60, 40]], hemi: ['#3a4a7a', '#101018', 1.4], exposure: 1.0, camLight: 520, rim: 2.5 },
  build(g, r) { g.add(ground('#1a1c22')); g.add(road(400, 24)); streetCanyon(g, r, true); this.rex = trex(); this.rex.rotation.y = -Math.PI / 2; g.add(this.rex); this.rain = precipitation(g, r, { n: 2200 }); this.cars = []; for (let i = 0; i < 8; i++) { const c = car(r.pick(['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#27ae60'])); c.position.set(r.pick([-9, -6, 6, 9]), 0, -20 - i * 18); c.rotation.y = r.range(-0.3, 0.3) + (r() < 0.5 ? Math.PI : 0); g.add(c); this.cars.push(c); } this.flashes = [0.4, 2.1, 3.6, 5.0];
    this.puddle = new THREE.Mesh(new THREE.PlaneGeometry(400, 24), new THREE.MeshStandardMaterial({ color: '#0d1018', roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.6 })); this.puddle.rotation.x = -Math.PI / 2; this.puddle.position.y = 0.05; g.add(this.puddle); },
  update(tl, dur, t) { const z = lerp(-75, -4, tl / dur); this.rex.position.z = z; const roar = clamp((tl - (dur - 1.6)) / 0.5, 0, 1); this.rex.userData.anim(t, { speed: 1.3, stride: 1 - roar * 0.7, roar, lookUp: roar * 0.3 }); this.rain(t, camera.position);
    const f = this.flashes.reduce((a, ft) => a + (tl > ft ? Math.exp(-(tl - ft) * 14) * (1 + 0.6 * Math.sin((tl - ft) * 90)) : 0), 0); return { flash: clamp(f, 0, 1) }; },
  shots: [{ t: [0, 0.6], from: [[3, 1.6, 14], [0, 5, -40]], to: [[1.5, 1.8, 10], [0, 5.5, -30]], shake: 0.4, fov: [50, 52] },
          { t: [0.6, 1], from: [[-4.5, 1.3, -1], [0, 5.5, -16]], to: [[-4, 1.5, 2], [0, 6.5, -5]], shake: 1.2, fov: [58, 62] }] });

// 1 · ANNO 1: il caos in città al tramonto
SCENES.push({ env: { skyTop: '#2a1a2e', skyBottom: '#ff7a2a', fog: '#6a3a2a', fogNear: 40, fogFar: 260, sun: ['#ffb070', 3.2, [60, 35, -40]], hemi: ['#ff9a60', '#3a2a2a', 0.8], exposure: 1.0, camLight: 250 },
  build(g, r) { g.add(ground('#3a3a3e')); const rd = road(400, 30); g.add(rd); const rd2 = road(400, 30); rd2.rotation.y = Math.PI / 2; g.add(rd2); cityRing(g, r, { count: 70, rMin: 45, rMax: 170, night: true, hMin: 25, hMax: 90 });
    this.rex = trex({ color: '#5f6e33' }); g.add(this.rex); this.people = crowd(g, r, 26, [0, 0, 22], 9); this.helis = [heli(), heli('#4a4a4a')]; this.helis.forEach(h => g.add(h));
    this.cars = []; for (let i = 0; i < 10; i++) { const c = car(r.pick(['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#27ae60', '#e67e22'])); const a = r() * 6.28, d = r.range(14, 34); c.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); c.rotation.y = r() * 6.28; c.userData.base = c.position.clone(); c.userData.launch = r.range(1.5, 8); c.userData.dir = r() * 6.28; g.add(c); this.cars.push(c); }
    this.smokes = [smokeColumn(g, [-60, 10, -70], 14, r, '#3a3a3a', 8, 70), smokeColumn(g, [70, 20, 30], 12, r, '#444', 8, 60), smokeColumn(g, [0, 1, 0], 10, r, '#8a7a6a', 10, 12)];
    this.fire = new THREE.PointLight('#ff6a20', 2500, 120, 1.5); this.fire.position.set(-60, 8, -70); g.add(this.fire); },
  update(tl, dur, t) { const p = tl / dur; this.rex.position.set(lerp(-14, 6, p), 0, lerp(-34, -2, p)); this.rex.rotation.y = -0.9; const roar = clamp((tl - 9.6) / 0.4, 0, 1) * clamp((11.2 - tl) / 0.4, 0, 1); this.rex.userData.anim(t, { speed: 1.5, roar, headTurn: p > 0.72 ? -0.5 : 0, lookUp: roar * 0.2 });
    this.people.forEach((h, i) => { h.userData.anim(t, h.userData.ph, h.userData.sp); const dx = h.position.x - this.rex.position.x, dz = h.position.z - this.rex.position.z; const d = Math.hypot(dx, dz) || 1; h.position.x += dx / d * 0.09 * 2; h.position.z += dz / d * 0.09 * 2; h.rotation.y = Math.atan2(dx, dz); });
    this.helis.forEach((h, i) => { const a = t * 0.35 + i * Math.PI; h.position.set(Math.cos(a) * 45, 28 + i * 6, Math.sin(a) * 45); h.rotation.y = -a - Math.PI / 2; h.rotation.z = 0.15; h.userData.anim(t); });
    this.cars.forEach(c => { const dtl = tl - c.userData.launch; if (dtl > 0 && dtl < 2.2) { const b = c.userData.base; c.position.set(b.x + Math.cos(c.userData.dir) * dtl * 9, Math.max(0, 14 * dtl - 9.8 * dtl * dtl * 0.75), b.z + Math.sin(c.userData.dir) * dtl * 9); c.rotation.x = dtl * 5; c.rotation.z = dtl * 3; } else if (dtl >= 2.2) { c.position.y = 0.6; c.rotation.set(0.2, c.userData.dir, Math.PI); } });
    this.smokes[0](t); this.smokes[1](t); this.fire.intensity = 2500 + Math.sin(t * 17) * 500 + Math.sin(t * 31) * 300; return {}; },
  shots: [{ t: [0, 0.38], from: [[2, 1.7, 36], [0, 5, -5]], to: [[-2, 1.5, 28], [0, 6, -2]], shake: 0.7, fov: [55, 55] },
          { t: [0.38, 0.72], from: [[55, 50, 60], [0, 6, 0]], to: [[-30, 42, 60], [0, 6, 0]], shake: 0.15, fov: [50, 50] },
          { t: [0.72, 1], rel: 'rex', from: [[14, 2.5, 12], [3, 6.5, 1]], to: [[9, 2.2, 9], [3, 7, 1]], shake: 0.9, fov: [50, 58] }] });

// 2 · ANNO 2: campagna, brachiosauri divorano i raccolti
SCENES.push({ env: { skyTop: '#2f7ad8', skyBottom: '#ffe3a8', fog: '#f4ddb0', fogNear: 120, fogFar: 520, sun: ['#fff1d0', 3.4, [-70, 60, 30]], hemi: ['#bcd8ff', '#8a7a4a', 0.9], exposure: 1.05 },
  build(g, r) { g.add(ground('#b7a35a')); this.bs = [brachio(), brachio({ color: '#7f7a5e' }), brachio({ color: '#948a62', scale: 0.85 })]; this.bs[0].position.set(-6, 0, -12); this.bs[1].position.set(38, 0, -46); this.bs[1].rotation.y = 0.6; this.bs[2].position.set(-55, 0, -58); this.bs[2].rotation.y = -0.5; this.bs.forEach(b => g.add(b));
    const fh = farmhouse(); fh.position.set(42, 0, 30); fh.rotation.y = -0.4; g.add(fh); const tr = tractor(); tr.position.set(28, 0, 38); tr.rotation.y = 0.5; g.add(tr);
    this.wheat = wheatField(g, r, { n: 8000, size: 240, exclude: (x, z) => (x > 20 && z > 18 && x < 62 && z < 50) });
    for (let i = 0; i < 40; i++) { const tt = tree(r.range(7, 12), r, r() < 0.5 ? 'pine' : 'round'); const a = r() * 6.28, d = r.range(130, 200); tt.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); g.add(tt); }
    cloudField(g, r, 10, 140, 400); this.people = crowd(g, r, 4, [36, 0, 36], 3); },
  update(tl, dur, t) { const p = tl / dur; this.bs.forEach((b, i) => b.userData.anim(t, { speed: 0.25, phase: i * 2, eat: 0.5 + 0.5 * Math.sin(t * 0.9 + i * 2.1) }));
    const grow = 6 + p * 26; this.wheat(t, this.bs.map((b, i) => ({ x: b.position.x + Math.cos(b.rotation.y) * 10, z: b.position.z - Math.sin(b.rotation.y) * 10, r: grow * (1 - i * 0.15) })));
    this.people.forEach(h => { h.userData.anim(t, h.userData.ph, 2); h.rotation.y = Math.atan2(-6 - h.position.x, -12 - h.position.z); }); return {}; },
  shots: [{ t: [0, 0.36], from: [[70, 22, 90], [0, 9, -10]], to: [[48, 16, 62], [0, 10, -10]], shake: 0.1, fov: [52, 50] },
          { t: [0.36, 0.7], from: [[8, 2.2, 14], [-6, 7, -8]], to: [[3, 2.0, 8], [-6, 4, -8]], shake: 0.25, fov: [60, 62] },
          { t: [0.7, 1], from: [[62, 6, 56], [10, 9, -20]], to: [[54, 7, 48], [5, 10, -25]], shake: 0.1, fov: [48, 46] }] });

// 3 · ANNO 3: aeroporto, pterosauri nel cielo
SCENES.push({ env: { skyTop: '#1d5fd1', skyBottom: '#bfe3ff', fog: '#cfe4f5', fogNear: 200, fogFar: 900, sun: ['#ffffff', 3.2, [40, 80, 20]], hemi: ['#9ec5ff', '#b8b0a0', 1.5], exposure: 1.0 },
  build(g, r) { g.add(ground('#7a9a55')); const rw = road(600, 45, '#404448'); g.add(rw); const term = building(120, 14, 30, windowTexture(9, 0.3, false), '#dfe6ee', false); term.position.set(0, 0, 90); g.add(term); const tw = tower(26); tw.position.set(-70, 0, 70); g.add(tw);
    this.parked = []; for (let i = 0; i < 4; i++) { const pl = plane(); pl.position.set(-60 + i * 40, 3, 60); pl.rotation.y = Math.PI / 2; pl.scale.setScalar(0.8); g.add(pl); this.parked.push(pl); }
    this.flying = plane(); g.add(this.flying); this.pts = []; for (let i = 0; i < 14; i++) { const pt = ptero({ color: r.pick(['#8b5a3c', '#6b4a3c', '#9a6a4a']), scale: r.range(1.3, 2.0) }); pt.userData.ph = r() * 6.28; pt.userData.rad = r.range(14, 40); pt.userData.h = r.range(-8, 10); pt.userData.sp = r.range(0.25, 0.45); g.add(pt); this.pts.push(pt); }
    this.perched = []; for (let i = 0; i < 5; i++) { const pt = ptero({ scale: 2 }); pt.position.set(-50 + i * 25, 15.5, 90); pt.rotation.y = r.range(-0.5, 0.5); g.add(pt); this.perched.push(pt); }
    cloudField(g, r, 24, 160, 600); this.people = crowd(g, r, 10, [0, 0, 70], 12); },
  update(tl, dur, t) { const p = tl / dur; const px = lerp(-90, 90, p), py = 40 + p * 35, pz = -60; this.flying.position.set(px, py, pz); this.flying.rotation.z = 0.12 + Math.sin(t * 0.8) * 0.08; this.flying.rotation.y = 0;
    this.pts.forEach((pt, i) => { const u = pt.userData; const a = t * u.sp + u.ph; const cx = px - 10, cy = py + u.h, cz = pz; pt.position.set(cx + Math.cos(a) * u.rad, cy + Math.sin(a * 1.7) * 6, cz + Math.sin(a) * u.rad * 0.7); pt.rotation.y = -a; pt.rotation.z = 0.3; pt.userData.anim(t, { flap: 3 + i * 0.1, phase: u.ph, glide: (i % 3 === 0) ? 0.8 : 0 }); });
    this.perched.forEach((pt, i) => pt.userData.anim(t, { flap: 0.6, phase: i, glide: 0.9 })); this.people.forEach(h => { h.userData.anim(t, h.userData.ph, 1.5); }); return {}; },
  shots: [{ t: [0, 0.34], rel: 'flying', from: [[34, -28, 50], [-6, 2, 0]], to: [[22, -30, 34], [0, 0, 0]], shake: 0.15, fov: [60, 60] },
          { t: [0.34, 0.68], from: [[-40, 48, -20], [-30, 58, -60]], to: [[30, 68, -15], [40, 72, -60]], shake: 0.3, fov: [50, 50] },
          { t: [0.68, 1], from: [[110, 55, 230], [0, 12, 70]], to: [[40, 40, 190], [0, 14, 75]], shake: 0.1, fov: [50, 48] }] });

// 4 · ANNO 5: mura, droni, dino-turismo
SCENES.push({ env: { skyTop: '#2b6fd6', skyBottom: '#dff0ff', fog: '#d8e6ee', fogNear: 150, fogFar: 700, sun: ['#fff6e0', 3.4, [60, 70, 70]], hemi: ['#a8c8ff', '#6e7a5a', 1.0], exposure: 1.0 },
  build(g, r) { g.add(ground('#8aa05a')); const inner = new THREE.Mesh(new THREE.CircleGeometry(108, 48), mat('#55585e', { flatShading: false })); inner.rotation.x = -Math.PI / 2; inner.position.y = 0.05; g.add(inner); cityRing(g, r, { count: 60, rMin: 40, rMax: 95, night: false, hMin: 20, hMax: 110 });
    const wallM = mat('#9a9a94'); const wall = new THREE.Mesh(new THREE.CylinderGeometry(112, 114, 30, 64, 1, true), new THREE.MeshStandardMaterial({ color: '#9a9a94', side: THREE.DoubleSide, roughness: 0.9 })); wall.position.y = 15; wall.castShadow = true; wall.receiveShadow = true; g.add(wall); const cap = new THREE.Mesh(new THREE.TorusGeometry(113, 2.2, 6, 64), mat('#777')); cap.rotation.x = Math.PI / 2; cap.position.y = 30; g.add(cap);
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; const tw = cyl(4, 4.5, 38, wallM, [Math.cos(a) * 113, 19, Math.sin(a) * 113], 8); g.add(tw); const top = box(9, 2.5, 9, mat('#666'), [Math.cos(a) * 113, 39, Math.sin(a) * 113]); g.add(top); }
    this.drones = []; for (let i = 0; i < 6; i++) { const d = drone(); d.scale.setScalar(2.5); d.userData.ph = i / 6 * 6.28; g.add(d); this.drones.push(d); }
    this.rex = trex(); this.rex.position.set(60, 0, 190); this.rex.rotation.y = 2.2; g.add(this.rex); this.br = brachio(); this.br.position.set(-40, 0, 230); this.br.rotation.y = 0.4; g.add(this.br); this.br2 = brachio({ color: '#7f7a5e', scale: 0.9 }); this.br2.position.set(140, 0, 260); g.add(this.br2);
    const rd = road(260, 14); rd.rotation.y = Math.PI / 2; rd.position.set(0, 0, 150); g.add(rd); this.buses = [bus(), bus('#f97316')]; this.buses.forEach(b => { b.position.set(0, 0, 150); g.add(b); });
    const plat = group([-10, 0, 165], g); plat.add(box(26, 1, 10, mat('#8b5a2b'), [0, 6, 0])); for (const x of [-11, 11]) for (const z of [-4, 4]) plat.add(cyl(0.4, 0.4, 6, mat('#6b4a2b'), [x, 3, z], 6)); plat.add(box(26, 1.2, 0.2, mat('#6b4a2b'), [0, 7.5, 5])); const stairs = box(4, 6, 6, mat('#8b5a2b'), [-15, 3, 0]); plat.add(stairs);
    this.tourists = crowd(g, r, 9, [-10, 6.5, 168], 10); this.tourists.forEach(h => { h.position.y = 6.5; h.position.z = 165 + rng(h.userData.ph * 100)() * 4; h.rotation.y = Math.PI; });
    for (let i = 0; i < 60; i++) { const tt = tree(r.range(6, 11), r, 'round', ['#5f8f3a', '#7aa84a', '#4f7f2a']); const a = r.range(-0.4, 3.5), d = r.range(135, 330); tt.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); g.add(tt); } cloudField(g, r, 14, 170, 600); },
  update(tl, dur, t) { const p = tl / dur; this.drones.forEach((d, i) => { const a = t * 0.25 + d.userData.ph; d.position.set(Math.cos(a) * 122, 36 + Math.sin(t + i) * 2, Math.sin(a) * 122); d.rotation.y = -a; d.rotation.x = 0.15; d.userData.anim(t); });
    this.rex.position.x = 60 - p * 30; this.rex.userData.anim(t, { speed: 1.0 }); this.br.userData.anim(t, { speed: 0.2, eat: 0.3 + 0.3 * Math.sin(t * 0.6) }); this.br2.userData.anim(t, { speed: 0.2, phase: 2, eat: 0.6 });
    this.buses.forEach((b, i) => { b.position.x = -120 + ((t * 9 + i * 90) % 260); }); this.tourists.forEach((h, i) => { h.userData.anim(t, h.userData.ph, 1.2); h.position.y = 6.5; }); return {}; },
  shots: [{ t: [0, 0.4], from: [[60, 26, 265], [0, 45, 0]], to: [[15, 42, 190], [0, 34, 0]], shake: 0.05, fov: [58, 54] },
          { t: [0.4, 0.7], from: [[6, 7.5, 158], [-40, 12, 235]], to: [[2, 7.2, 160], [-40, 14, 235]], shake: 0.1, fov: [55, 55] },
          { t: [0.7, 1], rel: 'rex', from: [[18, 6, -26], [-2, 5, -3]], to: [[12, 5, -21], [-3, 5.5, -4]], shake: 0.1, fov: [50, 50] }] });

// 5 · ANNO 7: freddo, neve, i giganti si ammalano
SCENES.push({ env: { skyTop: '#59697a', skyBottom: '#c9d3dc', fog: '#b9c4cf', fogNear: 15, fogFar: 140, sun: ['#dfe8f5', 1.6, [20, 50, 30]], hemi: ['#c9d3dc', '#50585f', 1.0], exposure: 0.95 },
  build(g, r) { g.add(ground('#e9eef2')); for (let i = 0; i < 50; i++) { const d = deadTree(r.range(6, 11)); const a = r() * 6.28, dist = r.range(18, 110); d.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist); d.rotation.y = r() * 6; g.add(d); }
    this.rex = trex({ color: '#5a5d47', belly: '#a8a58c' }); g.add(this.rex); this.br = brachio({ color: '#6e6a55' }); this.br.position.set(-30, 0, -45); this.br.rotation.y = 0.9; g.add(this.br); this.snow = precipitation(g, r, { n: 3000, snow: true, box: [140, 60, 140] });
    this.breath = smokeColumn(g, [0, 0, 0], 8, r, '#ffffff', 1.2, 4); this.rocks = []; for (let i = 0; i < 20; i++) { const rk = sphere(r.range(1, 3), mat('#8b8f94'), [r.range(-80, 80), 0, r.range(-80, 80)], 6); rk.scale.y = 0.5; g.add(rk); } },
  update(tl, dur, t) { const p = tl / dur; this.rex.position.set(lerp(6, -4, p), 0, lerp(-6, 4, p)); this.rex.rotation.y = -0.4; this.rex.userData.anim(t, { speed: 0.55, stride: 0.6, lookUp: -0.45 }); this.br.userData.anim(t, { speed: 0.2, lying: 1, eat: 0.2 });
    this.snow(t, camera.position); const hp = new THREE.Vector3(); this.rex.userData.parts.head.getWorldPosition(hp); this.breathPos = hp; this.breath(t, 2.5); return {}; },
  shots: [{ t: [0, 0.36], from: [[34, 7, 42], [0, 5, 0]], to: [[22, 5, 30], [0, 4, 0]], shake: 0.08, fov: [50, 50] },
          { t: [0.36, 0.68], from: [[-8, 2.6, 14], [2, 4, 0]], to: [[-5, 2.2, 10], [1, 3.6, 0]], shake: 0.1, fov: [55, 58] },
          { t: [0.68, 1], from: [[-5, 4, -15], [-30, 4, -45]], to: [[-14, 6, -20], [-30, 4, -45]], shake: 0.06, fov: [52, 50] }] });

// 6 · ANNO 10: alba, scheletro, foresta che riconquista
SCENES.push({ env: { skyTop: '#3a3f8f', skyBottom: '#ffb46a', fog: '#f0b88a', fogNear: 60, fogFar: 420, sun: ['#ffc48a', 2.8, [-120, 25, -60]], hemi: ['#ffd0a0', '#4a5a3a', 0.9], exposure: 1.0 },
  build(g, r) { g.add(ground('#5f7f3a')); this.sk = skeleton(1.4); this.sk.position.set(0, 0, 0); this.sk.rotation.y = 0.4; g.add(this.sk);
    const grassGeo = new THREE.ConeGeometry(0.25, 1.6, 4); grassGeo.translate(0, 0.8, 0); const gm = new THREE.InstancedMesh(grassGeo, mat('#6f9d3c'), 6000); const d = new THREE.Object3D(); for (let i = 0; i < 6000; i++) { d.position.set(r.range(-120, 120), 0, r.range(-120, 120)); d.rotation.y = r() * 6; const s = r.range(0.6, 1.4); d.scale.set(s, s, s); d.updateMatrix(); gm.setMatrixAt(i, d.matrix); } g.add(gm);
    this.trees = []; for (let i = 0; i < 90; i++) { const tt = tree(r.range(5, 14), r, r() < 0.6 ? 'round' : 'pine', ['#5f8f3a', '#7aa84a', '#3f7f2a']); const a = r() * 6.28, dist = r.range(14, 130); tt.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist); tt.userData.base = tt.scale.y; g.add(tt); this.trees.push(tt); }
    const city = new THREE.Group(); city.position.set(-60, 0, -220); cityRing(city, r, { count: 36, rMin: 0, rMax: 120, night: false, hMin: 20, hMax: 90 }); city.children.forEach((b, i) => { if (i % 3 === 0) { b.rotation.z = r.range(-0.08, 0.08); } const ivy = sphere(6, mat('#4f8f3a'), [0, r.range(10, 30), 6], 6); ivy.scale.set(1.5, 1, 0.6); b.add(ivy); }); g.add(city);
    this.sunMesh = sphere(14, new THREE.MeshBasicMaterial({ color: '#fff0c0', fog: false }), [-420, 60, -220], 16); g.add(this.sunMesh); cloudField(g, r, 8, 120, 400, '#ffd8b0'); },
  update(tl, dur, t) { const p = tl / dur; this.trees.forEach((tt, i) => { const s = 0.3 + 0.7 * smooth(p * 1.4 - (i % 7) * 0.08); tt.scale.setScalar(s); }); return {}; },
  shots: [{ t: [0, 0.4], from: [[13, 1.4, 6], [10, 3, 0]], to: [[10, 9, 16], [0, 4, -40]], shake: 0.05, fov: [52, 50] },
          { t: [0.4, 0.72], from: [[-30, 10, 60], [-60, 25, -220]], to: [[-10, 14, 40], [-60, 20, -220]], shake: 0.05, fov: [50, 46] },
          { t: [0.72, 1], from: [[40, 6, 30], [-420, 60, -220]], to: [[20, 14, 20], [-420, 50, -220]], shake: 0.04, fov: [48, 42] }] });

// 7 · CTA: il T-Rex ci guarda
SCENES.push({ env: { skyTop: '#05070f', skyBottom: '#1b2437', fog: '#141a28', fogNear: 15, fogFar: 150, sun: ['#8fa6ff', 1.4, [-30, 60, 40]], hemi: ['#3a4a7a', '#101018', 1.4], exposure: 1.0, camLight: 520, rim: 2.5 },
  build(g, r) { g.add(ground('#1a1c22')); g.add(road(400, 24)); streetCanyon(g, r, true); this.rex = trex(); this.rex.position.set(0, 0, -16); this.rex.rotation.y = -Math.PI / 2 + 0.25; g.add(this.rex); this.rain = precipitation(g, r, { n: 1800 }); this.flashes = [0.8, 3.4, 5.6]; },
  update(tl, dur, t) { this.rex.userData.anim(t, { speed: 0.8, stride: 0.15, headTurn: Math.sin(t * 0.6) * 0.25 + 0.3, lookUp: 0.1, roar: clamp((tl - 4.6) / 0.4, 0, 1) * clamp((6.2 - tl) / 0.4, 0, 1) }); this.rain(t, camera.position);
    const f = this.flashes.reduce((a, ft) => a + (tl > ft ? Math.exp(-(tl - ft) * 14) : 0), 0); return { flash: clamp(f, 0, 1) }; },
  shots: [{ t: [0, 1], from: [[2, 2.2, 4], [0, 6, -14]], to: [[1, 2.4, 0], [0, 6.5, -14]], shake: 0.35, fov: [55, 58] }] });

// ---------- timeline ----------
const [script, timing] = await Promise.all([fetch('./script.json').then(r => r.json()), fetch('./audio/timing.json').then(r => r.json())]);
let cursor = 0; const TL = [];
timing.forEach((tm, i) => { const dur = LEAD + tm.duration + GAP; TL.push({ i, start: cursor, dur, audioAt: cursor + LEAD, words: tm.words.map(w => ({ w: w.w, t: cursor + LEAD + w.t, e: cursor + LEAD + w.t + w.d })), meta: script[i] }); cursor += dur; });
const TOTAL = cursor + 0.6;
// chunk di parole (max 3, spezza su pause > 0.5s)
TL.forEach(S => { const chunks = []; let cur = null; S.words.forEach((w, k) => { if (!cur || cur.words.length >= 3 || w.t - cur.end > 0.5) { cur = { words: [], start: w.t, end: w.e }; chunks.push(cur); } cur.words.push(w); cur.end = w.e; }); S.chunks = chunks; });

const YEARS = { hook: 0, y1: 1, y2: 2, y3: 3, y5: 5, y7: 7, y10: 10, cta: 10 };
const FACTS = { y1: 'T-REX: <b>8 TONNELLATE</b> · <b>30 KM/H</b>', y2: '1 BRACHIOSAURO = <b>400 KG</b> DI PIANTE AL GIORNO', y3: 'QUETZALCOATLUS: <b>10 METRI</b> DI APERTURA ALARE', y5: 'MURA ALTE <b>30 M</b>: COME UN PALAZZO DI 10 PIANI', y7: 'OSSIGENO: OGGI <b>21%</b> · AI LORO TEMPI FINO AL <b>30%</b>', y10: 'DOPO 10 ANNI RESTANO SOLO <b>LE OSSA</b>' };

// costruzione scene
const skyMesh = sky('#000', '#000'); scene.add(skyMesh);
TL.forEach(S => { const sc = SCENES[S.i]; const g = new THREE.Group(); g.visible = false; sc.build.call(sc, g, rng(100 + S.i * 7)); scene.add(g); S.group = g; S.def = sc; });
const barEl = $('bar'); for (let i = 0; i < 10; i++) { const s = document.createElement('i'); barEl.appendChild(s); }

function applyEnv(env) { skyMesh.userData.mat.uniforms.top.value.set(env.skyTop); skyMesh.userData.mat.uniforms.bottom.value.set(env.skyBottom); scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar); sun.color.set(env.sun[0]); sun.intensity = env.sun[1]; sun.position.set(...env.sun[2]); hemi.color.set(env.hemi[0]); hemi.groundColor.set(env.hemi[1]); hemi.intensity = env.hemi[2]; renderer.toneMappingExposure = env.exposure || 1; camLight.intensity = env.camLight || 0; rim.intensity = env.rim || 0; }

const _p = new THREE.Vector3(), _l = new THREE.Vector3();
function placeCamera(S, tl) { const def = S.def; const u = tl / S.dur; const shot = def.shots.find(s => u >= s.t[0] && u < s.t[1]) || def.shots[def.shots.length - 1]; const k = easeInOut((u - shot.t[0]) / (shot.t[1] - shot.t[0]));
  _p.set(...shot.from[0]).lerp(V3(...shot.to[0]), k); _l.set(...shot.from[1]).lerp(V3(...shot.to[1]), k);
  if (shot.rel) { const b = def[shot.rel].position; _p.add(b); _l.add(b); }
  const sh = shot.shake || 0; const tt = S.start + tl; _p.x += Math.sin(tt * 13.1) * 0.08 * sh + Math.sin(tt * 7.3) * 0.12 * sh; _p.y += Math.sin(tt * 11.7) * 0.07 * sh; _p.z += Math.cos(tt * 9.4) * 0.06 * sh;
  camera.position.copy(_p); camera.lookAt(_l); camLight.position.copy(_p); rim.position.set(_l.x - (_p.x - _l.x), _l.y + 30, _l.z - (_p.z - _l.z)); rim.target.position.copy(_l); camera.rotation.z += Math.sin(tt * 5.1) * 0.006 * sh; camera.fov = lerp(shot.fov[0], shot.fov[1], k); camera.updateProjectionMatrix();
  sun.target.position.copy(_l); sun.position.set(_l.x + def.env.sun[2][0], def.env.sun[2][1], _l.z + def.env.sun[2][2]); sun.shadow.camera.updateProjectionMatrix(); }

function ui(S, tl, t) {
  const m = S.meta; const chip = $('chip'), title = $('title'), caps = $('caps'), fact = $('fact'), flash = $('flash'), fade = $('fade'), stage = $('stage'), cta2 = $('cta2');
  // chip + barra
  const hasLabel = !!m.label; chip.style.opacity = hasLabel ? 1 : 0; barEl.style.opacity = hasLabel ? 1 : 0; chip.textContent = m.label;
  const yr = YEARS[m.id]; const prevYr = S.i > 0 ? YEARS[TL[S.i - 1].meta.id] : 0; const fill = prevYr + (yr - prevYr) * smooth(tl / 1.2); [...barEl.children].forEach((el, i) => el.classList.toggle('on', i < Math.round(fill)));
  // titolo
  title.className = 'title ' + (m.id === 'hook' ? 'hook' : m.id === 'cta' ? 'cta' : ''); title.textContent = m.title;
  if (m.id === 'hook' || m.id === 'cta') { const a = easeOut(tl / 0.35); title.style.opacity = a; title.style.transform = `scale(${1.5 - 0.5 * a}) rotate(${(1 - a) * -4}deg)`; }
  else { const a = easeOut(tl / 0.25), out = 1 - smooth((tl - 1.5) / 0.4); title.style.opacity = a * out; title.style.transform = `scale(${1.6 - 0.6 * a}) rotate(${(1 - a) * -3}deg)`; }
  // sottotitoli karaoke
  const ch = S.chunks.find(c => t >= c.start - 0.08 && t <= c.end + 0.3); caps.innerHTML = ''; if (ch) { ch.words.forEach(w => { const s = document.createElement('span'); s.textContent = w.w; if (t >= w.t - 0.03 && t < (w.e + 0.08)) s.classList.add('on'); caps.appendChild(s); }); }
  // fatto
  const f = FACTS[m.id]; if (f) { fact.innerHTML = f; const fi = clamp((tl - S.dur * 0.42) / 0.3, 0, 1), fo = clamp((S.dur - 0.25 - tl) / 0.25, 0, 1); const a = easeOut(fi) * fo; fact.style.opacity = a; fact.style.transform = `scale(${0.7 + 0.3 * easeOut(fi)}) rotate(${(1 - easeOut(fi)) * 3}deg)`; } else fact.style.opacity = 0;
  cta2.style.opacity = m.id === 'cta' ? easeOut((tl - 1.4) / 0.4) : 0;
  // taglio: flash + zoom punch
  const cut = clamp(1 - tl / 0.1, 0, 1); flash.style.opacity = Math.max(cut * 0.9, S.flashLevel || 0); stage.style.transform = `scale(${1 + 0.07 * (1 - easeOut(tl / 0.35))})`;
  fade.style.opacity = clamp((t - (TOTAL - 0.7)) / 0.7, 0, 1);
}

let current = null;
window.__frame = function (t) {
  t = Math.min(t, TOTAL - 0.001); const S = TL.find(s => t >= s.start && t < s.start + s.dur) || TL[TL.length - 1]; const tl = t - S.start;
  if (current !== S) { if (current) current.group.visible = false; S.group.visible = true; applyEnv(S.def.env); current = S; }
  const out = S.def.update.call(S.def, tl, S.dur, t) || {}; S.flashLevel = out.flash || 0; placeCamera(S, tl);
  if (out.flash) skyMesh.userData.mat.uniforms.flash.value = out.flash * 0.6; else skyMesh.userData.mat.uniforms.flash.value = 0;
  if (out.flash) hemi.intensity = S.def.env.hemi[2] + out.flash * 6; else hemi.intensity = S.def.env.hemi[2];
  ui(S, tl, t); renderer.render(scene, camera);
};
window.__timeline = { total: TOTAL, scenes: TL.map(s => ({ i: s.i, start: s.start, dur: s.dur, audioAt: s.audioAt, id: s.meta.id })) };
window.__ready = true;
