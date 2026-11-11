// Render dello short: serve la cartella in locale, apre scene.html in Chromium headless e cattura i fotogrammi.
//   node render.js stills 0.5,7,20          -> frames/still_*.png (anteprime)
//   node render.js video [fps] [scale]      -> frames/video.mp4 (solo video, senza audio) + audio/timeline.json
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname, W = 1080, H = 1920;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png' };
function serve() {
  return new Promise(res => { const srv = http.createServer((req, r) => { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }); srv.listen(0, '127.0.0.1', () => res(srv)); });
}
async function open(scale = 1) {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/scene.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  const timeline = await page.evaluate(() => window.__timeline);
  fs.writeFileSync(path.join(ROOT, 'audio', 'timeline.json'), JSON.stringify(timeline, null, 1));
  return { browser, page, srv, timeline };
}
(async () => {
  const mode = process.argv[2] || 'stills';
  if (mode === 'stills') {
    const { browser, page, srv, timeline } = await open(Number(process.env.SCALE || 0.5));
    const times = (process.argv[3] || '1').split(',').map(Number);
    fs.mkdirSync(path.join(ROOT, 'frames'), { recursive: true });
    for (const t of times) { const t0 = Date.now(); await page.evaluate(t => window.__frame(t), t); await page.screenshot({ path: path.join(ROOT, 'frames', `still_${t.toFixed(1).replace('.', '_')}.png`) }); console.log(`t=${t}s  ${Date.now() - t0}ms`); }
    console.log('totale', timeline.total.toFixed(2), 's'); await browser.close(); srv.close(); return;
  }
  if (mode === 'video') {
    const fps = Number(process.argv[3] || 30), scale = Number(process.argv[4] || 1);
    const { browser, page, srv, timeline } = await open(scale);
    const nAll = Math.ceil(timeline.total * fps); const from = Number(process.argv[5] || 0), to = Math.min(nAll, Number(process.argv[6] || nAll)); const out = process.argv[7] || path.join(ROOT, 'frames', 'video.mp4'); const n = to;
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-vf', `scale=${W}:${H}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let i = from; i < n; i++) {
      const t = i / fps; await page.evaluate(t => window.__frame(t), t);
      const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % (fps * 5) === 0) { const el = (Date.now() - t0) / 1000; console.log(`frame ${i}/${n}  t=${t.toFixed(1)}s  ${el.toFixed(0)}s trascorsi, stima rimanente ${(el / Math.max(1, i - from) * (n - i)).toFixed(0)}s`); }
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r)); console.log('video pronto', out, 'in', ((Date.now() - t0) / 1000).toFixed(0), 's');
    await browser.close(); srv.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
