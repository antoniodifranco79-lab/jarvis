/* J.A.R.V.I.S. holographic reactor, shared by the browser app, the desktop HUD and the site.
   Usage: JarvisReactor.create(canvas, { getState: () => ({ state: "idle", level: 0 }), label: "..." }).
   States: idle, listening, thinking, transcribing, tool, loading, speaking, awaiting_approval, error. */
(function (root) {
  "use strict";
  const PALETTE = {
    idle: [86, 214, 255], speaking: [150, 236, 255], listening: [110, 255, 205],
    thinking: [255, 172, 64], transcribing: [255, 172, 64], tool: [255, 172, 64], loading: [255, 172, 64],
    awaiting_approval: [255, 118, 84], error: [255, 84, 104],
  };
  function create(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    const reduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const getState = opts.getState || (() => ({ state: "idle", level: 0 }));
    const label = (opts.label || "J.A.R.V.I.S. · JUST A RATHER VERY INTELLIGENT SYSTEM · ").toUpperCase();
    const col = PALETTE.idle.slice(), bars = new Float32Array(72);
    let W = 0, H = 0, dpr = 1, energy = 0.25, raf = 0, running = true, last = 0;
    const t0 = performance.now();
    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, root.devicePixelRatio || 1); W = Math.max(60, r.width); H = Math.max(60, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    if (root.ResizeObserver) new ResizeObserver(resize).observe(canvas); else root.addEventListener("resize", resize);
    resize();
    const rgba = (a) => "rgba(" + (col[0] | 0) + "," + (col[1] | 0) + "," + (col[2] | 0) + "," + a.toFixed(3) + ")";
    function frame(now) {
      const st = getState() || {}, s = st.state || "idle", target = PALETTE[s] || PALETTE.idle;
      for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * 0.08;
      const t = (now - t0) / 1000, busy = /thinking|tool|transcribing|loading/.test(s);
      const spd = reduced ? 0 : busy ? 2.2 : s === "speaking" ? 1.2 : s === "listening" ? 1 : 0.35;
      energy += ((busy ? 1 : s === "speaking" ? 0.8 : s === "listening" ? 0.65 : 0.25) - energy) * 0.05;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.46;
      let g = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R * 1.08);
      g.addColorStop(0, rgba(0.2 + 0.14 * energy)); g.addColorStop(0.4, rgba(0.05)); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(cx, cy); ctx.lineCap = "round"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      // outer bezel: 180 ticks and bearings
      ctx.save(); ctx.rotate(t * spd * 0.03);
      for (let i = 0; i < 180; i++) {
        const a = (i / 180) * Math.PI * 2, major = i % 15 === 0, mid = i % 5 === 0;
        const r2 = R - (major ? R * 0.065 : mid ? R * 0.035 : R * 0.018);
        ctx.strokeStyle = rgba(major ? 0.95 : mid ? 0.5 : 0.22); ctx.lineWidth = major ? 1.8 : 1;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); ctx.stroke();
      }
      ctx.fillStyle = rgba(0.75); ctx.font = Math.max(8, R * 0.036) + 'px "Share Tech Mono", monospace';
      for (let d = 0; d < 360; d += 30) { ctx.save(); ctx.rotate((d / 180) * Math.PI); ctx.fillText(String(d).padStart(3, "0"), 0, -(R - R * 0.11)); ctx.restore(); }
      ctx.restore();
      // segmented ring
      ctx.save(); ctx.rotate(t * spd * 0.25); ctx.lineCap = "butt";
      for (let i = 0, n = 24; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = a0 + ((Math.PI * 2) / n) * 0.72;
        ctx.strokeStyle = rgba(i % 6 === 0 ? 0.95 : i % 2 ? 0.3 : 0.58); ctx.lineWidth = R * (i % 6 === 0 ? 0.036 : 0.022);
        ctx.beginPath(); ctx.arc(0, 0, R * 0.82, a0, a1); ctx.stroke();
      }
      ctx.restore(); ctx.lineCap = "round";
      // counter-rotating arcs with markers
      ctx.save(); ctx.rotate(-t * spd * 0.45); ctx.lineWidth = 1.6;
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3, rr = R * 0.745, m = a + 1.4;
        ctx.strokeStyle = rgba(0.75); ctx.beginPath(); ctx.arc(0, 0, rr, a, m); ctx.stroke();
        ctx.fillStyle = rgba(0.95); ctx.beginPath();
        ctx.moveTo(Math.cos(m) * (rr + R * 0.032), Math.sin(m) * (rr + R * 0.032)); ctx.lineTo(Math.cos(m + 0.05) * rr, Math.sin(m + 0.05) * rr);
        ctx.lineTo(Math.cos(m) * (rr - R * 0.032), Math.sin(m) * (rr - R * 0.032)); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // circular legend
      ctx.save(); ctx.rotate(t * spd * 0.12); ctx.fillStyle = rgba(0.55); ctx.font = Math.max(7, R * 0.042) + 'px "Share Tech Mono", monospace';
      const step = (Math.PI * 2) / label.length;
      for (let i = 0; i < label.length; i++) { ctx.save(); ctx.rotate(i * step); ctx.fillText(label[i], 0, -R * 0.665); ctx.restore(); }
      ctx.restore();
      // voice spectrum
      const n = bars.length, active = s === "speaking" || s === "listening";
      for (let i = 0; i < n; i++) {
        const env = active ? (s === "listening" ? Math.max(0.15, st.level || 0) : 0.35 + 0.65 * Math.abs(Math.sin(t * 6 + i * 0.9)) * Math.random()) : 0.06 + 0.04 * Math.sin(t * 2 + i);
        bars[i] += (env * (0.5 + 0.5 * Math.abs(Math.sin(i * 2.3 + t * 3))) - bars[i]) * (reduced ? 1 : 0.22);
      }
      ctx.save(); ctx.rotate(-Math.PI / 2); ctx.lineWidth = Math.max(1.5, R * 0.012);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, r0 = R * 0.5, h = R * 0.015 + bars[i] * R * 0.11;
        ctx.strokeStyle = rgba(0.32 + bars[i] * 0.6); ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * (r0 + h), Math.sin(a) * (r0 + h)); ctx.stroke();
      }
      ctx.restore();
      // radar sweep while working
      if ((busy || energy > 0.6) && ctx.createConicGradient) {
        ctx.save(); ctx.rotate(t * 3.2);
        const sw = ctx.createConicGradient(0, 0, 0); sw.addColorStop(0, rgba(0)); sw.addColorStop(0.88, rgba(0)); sw.addColorStop(1, rgba(0.4 * energy));
        ctx.fillStyle = sw; ctx.beginPath(); ctx.arc(0, 0, R * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      // reactor coils
      ctx.save(); ctx.rotate(t * spd * 0.08); ctx.lineWidth = 1.2;
      for (let i = 0, c = 10; i < c; i++) {
        ctx.save(); ctx.rotate((i / c) * Math.PI * 2); ctx.fillStyle = rgba(0.14 + 0.2 * energy); ctx.strokeStyle = rgba(0.85);
        ctx.beginPath(); ctx.moveTo(-R * 0.034, -R * 0.42); ctx.lineTo(R * 0.034, -R * 0.42); ctx.lineTo(R * 0.056, -R * 0.27); ctx.lineTo(-R * 0.056, -R * 0.27); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      ctx.strokeStyle = rgba(0.9); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.44, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, R * 0.25, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // core
      const pulse = reduced ? 0.7 : 0.6 + 0.4 * Math.sin(t * (busy ? 7 : 2.2)) * (0.5 + energy * 0.5);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.24);
      g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.25, rgba(0.95)); g.addColorStop(0.6, rgba(0.35 * pulse)); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = rgba(1); ctx.shadowBlur = R * 0.15 * pulse; ctx.fillStyle = "rgba(235,252,255,0.96)";
      ctx.beginPath(); ctx.arc(0, 0, R * 0.075, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      // satellites
      for (let k = 0; k < 3; k++) { const a = t * spd * (0.6 + k * 0.25) + k * 2.1, rr = R * (0.9 + k * 0.025); ctx.fillStyle = rgba(0.9); ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, Math.max(1.5, R * 0.011), 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      last = now;
      if (!running) return;
      if (reduced) setTimeout(() => { raf = requestAnimationFrame(frame); }, 400); else raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; raf = requestAnimationFrame(frame); }
    });
    return { stop() { running = false; cancelAnimationFrame(raf); }, get lastFrame() { return last; } };
  }
  root.JarvisReactor = { create };
})(typeof window !== "undefined" ? window : globalThis);
