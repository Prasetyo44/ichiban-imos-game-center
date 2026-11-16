// Ichiban Spray Paint Challenge - mesin game (berjalan di layar TV).
// Kanvas 1920x1080. Motor/template ditaruh di tengah; HP mengirim posisi semprot (0..1).
// Ketebalan cat dihitung per sel 8x8 piksel: cukup (rata), terlalu tebal (meleleh), di luar area (meleber).
(function () {
  const W = 1920, H = 1080;
  const CELL = 8, GW = W / CELL, GH = H / CELL;
  const PAD_MARGIN = 0.08; // area kontrol HP = template + 8% di setiap sisi (harus sama dengan play.html)
  const STAGE = (() => { // posisi template 1200x700 di layar
    const s = Math.min(1560 / 1200, 860 / 700);
    const w = 1200 * s, h = 700 * s;
    return { x: (W - w) / 2, y: 196 + (870 - h) / 2, w, h, s };
  })();
  const COAT_OK = 0.9;       // ketebalan minimal supaya dihitung "tertutup"
  const OVER_MIN = 0.35;     // ketebalan minimal cat di luar area dihitung "meleber"
  const BASE_RATE = 4.2;     // lapisan per detik di pusat semprotan (sprayPower 100%)

  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const mk = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ---------- Template: SVG berlapis (base / paint / cover / gloss) atau gambar upload ----------
  const tplCache = new Map();
  async function buildTemplate(t) {
    const key = t.id + '|' + t.src + '|' + (t.maskSrc || '');
    if (tplCache.has(key)) return tplCache.get(key);
    const L = { base: mk(), mask: mk(), cover: null, gloss: null };
    const place = (ctx, img) => {
      // gambar upload: muat proporsional di area template
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const s = Math.min(STAGE.w / iw, STAGE.h / ih);
      const w = iw * s, h = ih * s;
      ctx.drawImage(img, STAGE.x + (STAGE.w - w) / 2, STAGE.y + (STAGE.h - h) / 2, w, h);
    };
    if (t.kind === 'svg') {
      const txt = await (await fetch(t.src)).text();
      const variant = async (show, extraCss = '') => {
        const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
        for (const g of doc.querySelectorAll('svg > g[id]')) if (!show.includes(g.id)) g.setAttribute('display', 'none');
        if (extraCss) { const st = doc.createElementNS('http://www.w3.org/2000/svg', 'style'); st.textContent = extraCss; doc.documentElement.appendChild(st); }
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
        try { return await loadImg(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      };
      const [base, paint, cover, gloss] = await Promise.all([
        variant(['base', 'paint']),
        variant(['paint'], '#paint, #paint * { fill:#000 !important; stroke:#000 !important; stroke-width:0 !important }'),
        variant(['cover']), variant(['gloss']),
      ]);
      const draw = (img) => { const c = mk(); c.getContext('2d').drawImage(img, STAGE.x, STAGE.y, STAGE.w, STAGE.h); return c; };
      L.base = draw(base); L.mask = draw(paint); L.cover = draw(cover); L.gloss = draw(gloss);
      const m = L.mask.getContext('2d'); m.globalCompositeOperation = 'destination-out'; m.drawImage(L.cover, 0, 0);
    } else {
      const img = await loadImg(t.src);
      place(L.base.getContext('2d'), img);
      const mimg = t.maskSrc ? await loadImg(t.maskSrc) : img;
      place(L.mask.getContext('2d'), mimg);
      if (t.maskSrc) { // mask upload: area gelap/tidak transparan = area cat
        const ctx = L.mask.getContext('2d'); const d = ctx.getImageData(0, 0, W, H); const a = d.data;
        for (let i = 0; i < a.length; i += 4) { const lum = (a[i] + a[i + 1] + a[i + 2]) / 3; a[i + 3] = a[i + 3] > 40 && lum < 200 ? 255 : 0; }
        ctx.putImageData(d, 0, 0);
      }
    }
    // grid sel area cat
    const md = L.mask.getContext('2d').getImageData(0, 0, W, H).data;
    const cells = new Uint8Array(GW * GH); let count = 0;
    let bx0 = GW, by0 = GH, bx1 = 0, by1 = 0;
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2;
      if (md[(py * W + px) * 4 + 3] > 128) {
        cells[gy * GW + gx] = 1; count++;
        if (gx < bx0) bx0 = gx; if (gy < by0) by0 = gy; if (gx > bx1) bx1 = gx; if (gy > by1) by1 = gy;
      }
    }
    // thumbnail untuk HP / hasil: area kontrol (template + margin)
    L.cells = cells; L.count = Math.max(1, count);
    L.bbox = { x: bx0 * CELL, y: by0 * CELL, w: (bx1 - bx0 + 1) * CELL, h: (by1 - by0 + 1) * CELL };
    tplCache.set(key, L);
    return L;
  }

  // ---------- Latar booth per tema ----------
  function drawBackdrop(theme, b, cans) {
    const c = mk(); const g = c.getContext('2d');
    const floorY = STAGE.y + STAGE.h * 0.93;
    if (theme === 'showroom') {
      let gr = g.createLinearGradient(0, 0, 0, floorY); gr.addColorStop(0, '#fafafa'); gr.addColorStop(1, '#d9dce2');
      g.fillStyle = gr; g.fillRect(0, 0, W, floorY);
      g.fillStyle = b.primaryColor; g.globalAlpha = 0.9; g.fillRect(0, floorY - 120, W, 14); g.globalAlpha = 0.35; g.fillRect(0, floorY - 96, W, 6); g.globalAlpha = 1;
      gr = g.createLinearGradient(0, floorY, 0, H); gr.addColorStop(0, '#c9ccd3'); gr.addColorStop(1, '#eef0f3');
      g.fillStyle = gr; g.fillRect(0, floorY, W, H - floorY);
      const rg = g.createRadialGradient(W / 2, floorY, 50, W / 2, floorY, 900); rg.addColorStop(0, 'rgba(255,255,255,.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    } else if (theme === 'malam') {
      let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0b0d1f'); gr.addColorStop(1, '#1a1033');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.lineWidth = 6; g.shadowBlur = 30;
      for (const [y, col] of [[floorY - 140, '#ff2fa8'], [floorY - 110, '#21e6ff']]) { g.strokeStyle = col; g.shadowColor = col; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.shadowBlur = 0;
      gr = g.createLinearGradient(0, floorY, 0, H); gr.addColorStop(0, '#120a24'); gr.addColorStop(1, '#2a1650');
      g.fillStyle = gr; g.fillRect(0, floorY, W, H - floorY);
      g.strokeStyle = 'rgba(33,230,255,.15)'; g.lineWidth = 2;
      for (let i = -20; i <= 20; i++) { g.beginPath(); g.moveTo(W / 2 + i * 40, floorY); g.lineTo(W / 2 + i * 160, H); g.stroke(); }
    } else { // bengkel
      let gr = g.createLinearGradient(0, 0, 0, floorY); gr.addColorStop(0, '#4a4f59'); gr.addColorStop(1, '#2b2e35');
      g.fillStyle = gr; g.fillRect(0, 0, W, floorY);
      // pegboard
      g.fillStyle = 'rgba(0,0,0,.28)';
      for (let y = 40; y < floorY - 150; y += 34) for (let x = 20 + ((y / 34) % 2) * 17; x < W; x += 34) { g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); }
      // panel dinding
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 3;
      for (let x = 0; x < W; x += 320) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, floorY); g.stroke(); }
      // pita hazard
      const hy = floorY - 70;
      g.save(); g.beginPath(); g.rect(0, hy, W, 34); g.clip();
      g.fillStyle = '#ffc400'; g.fillRect(0, hy, W, 34); g.fillStyle = '#1b1b1b';
      for (let x = -40; x < W + 40; x += 60) { g.beginPath(); g.moveTo(x, hy + 34); g.lineTo(x + 30, hy); g.lineTo(x + 60, hy); g.lineTo(x + 30, hy + 34); g.fill(); }
      g.restore();
      gr = g.createLinearGradient(0, floorY, 0, H); gr.addColorStop(0, '#24262b'); gr.addColorStop(1, '#3a3d44');
      g.fillStyle = gr; g.fillRect(0, floorY, W, H - floorY);
      // lampu sorot
      const rg = g.createRadialGradient(W / 2, STAGE.y + STAGE.h * 0.5, 80, W / 2, STAGE.y + STAGE.h * 0.5, 980);
      rg.addColorStop(0, 'rgba(255,240,210,.32)'); rg.addColorStop(1, 'rgba(255,240,210,0)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    // vignette
    const v = g.createRadialGradient(W / 2, H / 2, 500, W / 2, H / 2, 1250); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.5)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    // kaleng Ichiban dekorasi di pojok
    if (cans && cans.nc && cans.aero) {
      g.save(); g.globalAlpha = 0.95;
      const nh = 170, nw = nh * cans.nc.width / cans.nc.height;
      g.drawImage(cans.nc, 26, H - nh - 18, nw, nh);
      g.drawImage(cans.nc, 26 + nw * 0.55, H - nh * 0.8 - 18, nw * 0.8, nh * 0.8);
      const ah = 220, aw = ah * cans.aero.width / cans.aero.height;
      g.drawImage(cans.aero, W - aw - 40, H - ah - 18, aw, ah);
      g.drawImage(cans.aero, W - aw * 2 - 30, H - ah * 0.85 - 18, aw * 0.85, ah * 0.85);
      g.restore();
    }
    return c;
  }

  class PaintGame {
    constructor(canvas, cb = {}) {
      this.cv = canvas; this.cv.width = W; this.cv.height = H;
      this.ctx = canvas.getContext('2d');
      this.cb = cb;
      this.audio = cb.audio || null;
      this.paint = mk(); this.pctx = this.paint.getContext('2d');
      this.tmpIn = mk(); this.tmpOut = mk();
      this.density = new Float32Array(GW * GH);
      this.dripSeen = new Uint8Array(GW * GH);
      this.branding = { primaryColor: '#d71920', accentColor: '#ffc400', theme: 'bengkel', showCans: true };
      this.mode = 'idle'; // idle | countdown | playing | over
      this.tpl = null; this.cfg = null;
      this.pos = { x: W / 2, y: H / 2 }; this.target = { x: W / 2, y: H / 2 }; this.prev = null;
      this.spraying = false; this.wantSpray = false;
      this.particles = []; this.drips = []; this.popups = [];
      this.color = '#d71920'; this.colorId = null; this.colorsUsed = new Set();
      this.last = performance.now();
      this.imgs = {};
      Promise.all([loadImg('img/can-aerosol.png'), loadImg('img/can-nc.png')]).then(([a, n]) => { this.imgs.aero = a; this.imgs.nc = n; this.canImg = this.canImg || a; this.backdrop = null; }).catch(() => {});
      requestAnimationFrame(this.frame.bind(this));
    }

    setBranding(b) {
      const prev = this.branding;
      this.branding = { ...this.branding, ...b };
      if (!this.backdrop || prev.theme !== b.theme || prev.primaryColor !== b.primaryColor || prev.showCans !== b.showCans) this.backdrop = null;
      if (b.canImage && b.canImage !== this.canSrc) { this.canSrc = b.canImage; loadImg(b.canImage).then((i) => { this.canImg = i; }).catch(() => {}); }
      if (this.mode === 'idle' && b.templates && b.templates.length) this.startIdle(b.templates);
    }

    resetPaint() {
      this.pctx.clearRect(0, 0, W, H);
      this.density.fill(0); this.dripSeen.fill(0);
      this.drips = []; this.particles = []; this.popups = [];
      this.m = { cover: 0, drip: 0, over: 0 };
      this.colorsUsed = new Set();
    }

    // ---------- Mode menunggu: robot mengecat motor sebagai tampilan menarik ----------
    async startIdle(templates) {
      templates = templates || this.branding.templates || [];
      this.mode = 'idle';
      this.idleList = templates; this.idleIdx = (this.idleIdx ?? -1) + 1;
      const t = templates[this.idleIdx % Math.max(1, templates.length)];
      if (!t) return;
      const token = (this.idleToken = {});
      const L = await buildTemplate(t).catch(() => null);
      if (!L || this.idleToken !== token || this.mode !== 'idle') return;
      this.tpl = L; this.resetPaint();
      this.cfg = { sprayRadius: 70, sprayPower: 160, drips: false, dripLimit: 99 };
      const cols = (this.branding.colors || []).map((c) => c.hex);
      this.idleColors = cols.length ? cols : ['#d71920'];
      this.color = this.idleColors[this.idleIdx % this.idleColors.length];
      // jalur zig-zag melewati area cat
      const bb = L.bbox, step = 60, path = [];
      for (let y = bb.y + 20, i = 0; y < bb.y + bb.h; y += step, i++) {
        const row = [];
        for (let x = bb.x; x <= bb.x + bb.w; x += 30) { const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL); if (L.cells[gy * GW + gx]) row.push({ x, y }); }
        if (row.length) path.push(...(i % 2 ? row.reverse() : row));
      }
      this.idlePath = path; this.idleI = 0; this.idleT = 0;
    }

    // ---------- Mulai game ----------
    async start(cfg) {
      this.cfg = cfg; this.mode = 'loading'; this.idleToken = null;
      this.resetPaint();
      this.tpl = await buildTemplate(cfg.template).catch(() => buildTemplate({ id: 'sport', src: 'tpl/sport.svg', kind: 'svg' }));
      this.resetPaint();
      const cols = cfg.colors && cfg.colors.length ? cfg.colors : [{ id: 'c0', hex: '#d71920', name: 'Merah' }];
      this.palette = cols; this.setColor(cols[0].id);
      this.pos = { x: W / 2, y: STAGE.y + STAGE.h / 2 }; this.target = { ...this.pos }; this.prev = null;
      this.wantSpray = false; this.spraying = false;
      this.timeLeft = cfg.durationSec; this.elapsed = 0;
      this.countLeft = cfg.countdownSec; this.lastBeep = null; this.lastTick = null;
      this.mode = 'countdown';
      if (this.audio) { this.audio.playMusic('musicPlay'); if (cfg.countdownSec > 0) this.audio.play('rattle'); }
      if (cfg.countdownSec <= 0) this.begin();
    }
    begin() {
      this.mode = 'playing'; this.startedAt = performance.now();
      this.audio && this.audio.play('go');
      this.cb.onRunning && this.cb.onRunning();
    }
    setColor(id) {
      const c = (this.palette || []).find((x) => x.id === id) || (this.palette || [])[0];
      if (!c) return;
      this.colorId = c.id; this.color = c.hex; this.colorName = c.name;
    }
    // x, y = posisi di area kontrol HP (0..1); s = sedang menyemprot
    aim(x, y, s) {
      const tw = STAGE.w * (1 + 2 * PAD_MARGIN), th = STAGE.h * (1 + 2 * PAD_MARGIN);
      this.target = { x: STAGE.x - STAGE.w * PAD_MARGIN + x * tw, y: STAGE.y - STAGE.h * PAD_MARGIN + y * th };
      this.wantSpray = !!s;
      this.lastAim = performance.now();
    }
    aimScreen(px, py, s) { this.target = { x: px, y: py }; this.wantSpray = !!s; this.lastAim = performance.now(); }
    finishReq() { if (this.mode === 'playing') this.end('selesai'); }
    forceEnd() { if (this.mode === 'playing' || this.mode === 'countdown') this.end('admin'); }

    // ---------- Fisika cat ----------
    sprayAt(x, y, dt) {
      const R = this.cfg.sprayRadius, rate = BASE_RATE * (this.cfg.sprayPower / 100);
      const L = this.tpl; if (!L) return;
      const drips = this.cfg.drips !== false && this.mode === 'playing';
      const limit = this.cfg.dripLimit || 3;
      const g0x = Math.max(0, Math.floor((x - R) / CELL)), g1x = Math.min(GW - 1, Math.floor((x + R) / CELL));
      const g0y = Math.max(0, Math.floor((y - R) / CELL)), g1y = Math.min(GH - 1, Math.floor((y + R) / CELL));
      const R2 = R * R;
      for (let gy = g0y; gy <= g1y; gy++) {
        const cy = gy * CELL + CELL / 2, dy = cy - y;
        for (let gx = g0x; gx <= g1x; gx++) {
          const cx = gx * CELL + CELL / 2, dx = cx - x, d2 = dx * dx + dy * dy;
          if (d2 >= R2) continue;
          const w = 1 - d2 / R2, i = gy * GW + gx;
          const before = this.density[i], after = before + rate * dt * w * w;
          this.density[i] = after;
          if (L.cells[i]) {
            if (before < COAT_OK && after >= COAT_OK) this.m.cover++;
            if (before < limit && after >= limit) {
              this.m.drip++;
              if (drips) this.spawnDrip(cx, cy);
            }
          } else if (before < OVER_MIN && after >= OVER_MIN) this.m.over++;
        }
      }
      // gambar cat: gradien lembut + bintik semprotan
      const p = this.pctx, [r, gC, b] = hexRgb(this.color);
      const a = Math.min(0.5, 1.8 * rate * dt);
      const grd = p.createRadialGradient(x, y, 0, x, y, R);
      grd.addColorStop(0, `rgba(${r},${gC},${b},${a})`); grd.addColorStop(0.5, `rgba(${r},${gC},${b},${a * 0.56})`);
      grd.addColorStop(0.8, `rgba(${r},${gC},${b},${a * 0.13})`); grd.addColorStop(1, `rgba(${r},${gC},${b},0)`);
      p.fillStyle = grd; p.beginPath(); p.arc(x, y, R, 0, 6.2832); p.fill();
      p.fillStyle = `rgba(${r},${gC},${b},0.55)`;
      const n = Math.ceil(26 * dt * 60);
      for (let k = 0; k < n; k++) {
        const ang = Math.random() * 6.2832, rr = R * Math.sqrt(Math.random()) * 1.12;
        p.beginPath(); p.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, 0.8 + Math.random() * 1.8, 0, 6.2832); p.fill();
      }
    }
    spawnDrip(x, y) {
      const now = performance.now();
      for (const d of this.drips) if (Math.abs(d.x - x) < 26 && Math.abs(d.y0 - y) < 40 && now - d.born < 900) return;
      if (this.drips.length > 80) return;
      this.drips.push({ x: x + (Math.random() - 0.5) * 6, y0: y, y, len: 24 + Math.random() * 60, v: 26 + Math.random() * 30, w: 5 + Math.random() * 4, color: this.color, born: now });
      if (!this.lastDripSfx || now - this.lastDripSfx > 350) {
        this.lastDripSfx = now; this.audio && this.audio.play('drip', { vol: 0.9, rate: 0.9 + Math.random() * 0.3 });
        this.cb.onEvent && this.cb.onEvent({ type: 'drip' });
        this.popup('Terlalu tebal! Cat meleleh', '#ff8a3d', x, y - 40);
      }
    }
    popup(text, color, x, y) {
      if (this.popups.some((p) => p.text === text && p.life > 0.6)) return;
      this.popups.push({ text, color, x: Math.max(400, Math.min(W - 400, x)), y: Math.max(230, y), life: 1.4 });
    }
    metrics() {
      const L = this.tpl, m = this.m;
      const coverage = (100 * m.cover) / L.count;
      const drip = (100 * m.drip) / L.count;
      const overspray = Math.min(100, (100 * m.over) / L.count);
      return { coverage, drip, overspray, rata: Math.max(0, coverage - drip) };
    }
    liveScore(mt) {
      const c = this.cfg;
      const base = (mt.rata / 100) * c.pointsCoverage;
      const pen = mt.overspray * c.oversprayPenalty + mt.drip * c.dripPenalty;
      return Math.max(0, Math.round(base - pen));
    }

    end(reason) {
      if (this.mode === 'over') return;
      this.mode = 'over';
      this.wantSpray = false;
      if (this.audio) { this.audio.sprayOn(false); this.audio.play('finish'); this.audio.duck(true); }
      const mt = this.metrics();
      const durationMs = performance.now() - (this.startedAt || performance.now());
      // render 1 frame bersih lalu ambil foto hasil
      this.render(true);
      const snap = this.snapshot();
      this.render();
      setTimeout(() => this.cb.onOver && this.cb.onOver({
        reason, durationMs, timeLeft: reason === 'selesai' ? this.timeLeft : 0,
        coverage: mt.coverage, drip: mt.drip, overspray: mt.overspray, colors: [...this.colorsUsed], snapshot: snap,
      }), 50);
    }
    snapshot() {
      try {
        const pad = 40, s = STAGE;
        const sx = Math.max(0, s.x - pad), sy = Math.max(0, s.y - pad), sw = Math.min(W - sx, s.w + pad * 2), sh = Math.min(H - sy, s.h + pad * 2);
        const c = mk(800, Math.round((800 * sh) / sw));
        c.getContext('2d').drawImage(this.cv, sx, sy, sw, sh, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.82);
      } catch { return ''; }
    }

    // ---------- Loop ----------
    frame(now) {
      requestAnimationFrame(this.frame.bind(this));
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      try { this.update(dt, now); this.render(); } catch (e) { console.error(e); }
    }
    update(dt, now) {
      if (this.mode === 'idle' && this.tpl && this.idlePath && this.idlePath.length) {
        this.idleT += dt;
        const target = this.idlePath[Math.min(this.idlePath.length - 1, this.idleI)];
        this.target = target; this.wantSpray = true;
        const d = Math.hypot(target.x - this.pos.x, target.y - this.pos.y);
        if (d < 30) this.idleI++;
        if (this.idleI >= this.idlePath.length) {
          this.wantSpray = false;
          if (!this.idleDone) this.idleDone = now;
          if (now - this.idleDone > 4000) { this.idleDone = null; this.startIdle(this.idleList); }
        }
        if (this.idleI && this.idleI % 90 === 0) this.color = this.idleColors[(Math.floor(this.idleI / 90) + this.idleIdx) % this.idleColors.length];
      }
      if (this.mode === 'countdown') {
        this.countLeft -= dt;
        const n = Math.ceil(this.countLeft);
        if (n !== this.lastBeep && n > 0) { this.lastBeep = n; this.audio && this.audio.play('beep'); }
        if (this.countLeft <= 0) this.begin();
      }
      if (this.mode === 'playing') {
        this.timeLeft -= dt; this.elapsed += dt;
        const n = Math.ceil(this.timeLeft);
        if (n <= 10 && n > 0 && n !== this.lastTick) { this.lastTick = n; this.audio && this.audio.play('tick', { vol: n <= 5 ? 1 : 0.7 }); }
        if (this.audio && this.timeLeft < 10) this.audio.playMusic('musicPlay', { rate: 1.08 });
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.end('waktu'); }
        const mt = this.metrics();
        if (this.cfg.autoFinishPct > 0 && mt.rata >= this.cfg.autoFinishPct) this.end('selesai');
        if (!this.lastTickSent || now - this.lastTickSent > 250) {
          this.lastTickSent = now;
          this.cb.onTick && this.cb.onTick({ t: Math.max(0, this.timeLeft), coverage: Math.round(mt.coverage), rata: Math.round(mt.rata), overspray: Math.round(mt.overspray), drip: Math.round(mt.drip), score: this.liveScore(mt) });
        }
        // peringatan meleber
        if (this.spraying) {
          const gx = Math.floor(this.pos.x / CELL), gy = Math.floor(this.pos.y / CELL);
          const inside = gx >= 0 && gy >= 0 && gx < GW && gy < GH && this.tpl.cells[gy * GW + gx];
          this.outTime = inside ? 0 : (this.outTime || 0) + dt;
          if (this.outTime > 0.45) {
            this.outTime = -1.2;
            this.popup('Meleber! Arahkan ke bodi motor', '#ff4d5e', this.pos.x, this.pos.y - 60);
            this.audio && this.audio.play('warn', { vol: 0.5 });
            this.cb.onEvent && this.cb.onEvent({ type: 'overspray' });
          }
        }
      }
      // gerak kursor halus
      const k = Math.min(1, dt * (this.mode === 'idle' ? 6 : 22));
      const step = this.mode === 'idle' ? Math.min(1, (900 * dt) / Math.max(1, Math.hypot(this.target.x - this.pos.x, this.target.y - this.pos.y))) : k;
      const nx = this.pos.x + (this.target.x - this.pos.x) * step, ny = this.pos.y + (this.target.y - this.pos.y) * step;
      const canSpray = this.mode === 'playing' || this.mode === 'idle';
      const sp = canSpray && this.wantSpray && this.tpl;
      if (sp) {
        if (this.mode === 'playing') this.colorsUsed.add(this.colorId);
        // interpolasi supaya garis semprot tidak putus-putus saat HP bergerak cepat
        const from = this.spraying && this.prev ? this.prev : { x: nx, y: ny };
        const dist = Math.hypot(nx - from.x, ny - from.y);
        const steps = Math.max(1, Math.ceil(dist / (this.cfg.sprayRadius * 0.25)));
        for (let i = 1; i <= steps; i++) this.sprayAt(from.x + ((nx - from.x) * i) / steps, from.y + ((ny - from.y) * i) / steps, dt / steps);
        if (this.mode === 'playing' || Math.random() < 0.5) this.emitMist(nx, ny);
      }
      if (this.mode === 'playing' && this.audio) this.audio.sprayOn(!!sp);
      if (this.mode !== 'playing' && this.audio && this.mode !== 'idle') this.audio.sprayOn(false);
      this.spraying = !!sp;
      this.pos = { x: nx, y: ny }; this.prev = { x: nx, y: ny };
      // lelehan cat turun
      const p = this.pctx;
      for (const d of this.drips) {
        if (d.y - d.y0 >= d.len) continue;
        const ny2 = Math.min(d.y0 + d.len, d.y + d.v * dt);
        const [r, g, b] = hexRgb(d.color);
        p.strokeStyle = `rgba(${r},${g},${b},0.9)`; p.lineWidth = d.w * (1 - (ny2 - d.y0) / d.len * 0.4); p.lineCap = 'round';
        p.beginPath(); p.moveTo(d.x, d.y); p.lineTo(d.x, ny2); p.stroke();
        if (ny2 - d.y0 >= d.len - 0.5) { p.fillStyle = `rgba(${r},${g},${b},0.95)`; p.beginPath(); p.arc(d.x, ny2, d.w * 0.75, 0, 6.3); p.fill(); }
        d.y = ny2; d.v *= 1 - dt * 0.6;
      }
      for (const q of this.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
      this.particles = this.particles.filter((q) => q.life > 0);
      for (const q of this.popups) { q.life -= dt; q.y -= 40 * dt; }
      this.popups = this.popups.filter((q) => q.life > 0);
    }
    canPose() { // kaleng ada di kanan-bawah titik semprot, nozel mengarah ke titik itu
      const x = this.pos.x, y = this.pos.y;
      return { nx: x + 120, ny: y + 70, ang: -0.95 };
    }
    emitMist(x, y) {
      const c = this.canPose();
      for (let i = 0; i < 5; i++) {
        const t = 0.12 + Math.random() * 0.12;
        const tx = x + (Math.random() - 0.5) * this.cfg.sprayRadius * 0.9, ty = y + (Math.random() - 0.5) * this.cfg.sprayRadius * 0.9;
        this.particles.push({ x: c.nx, y: c.ny, vx: (tx - c.nx) / t, vy: (ty - c.ny) / t, life: t, max: t, color: this.color, r: 2 + Math.random() * 3 });
      }
    }

    // ---------- Gambar ----------
    render(clean = false) {
      const g = this.ctx;
      if (!this.backdrop) this.backdrop = drawBackdrop(this.branding.theme, this.branding, this.branding.showCans ? this.imgs : null);
      g.drawImage(this.backdrop, 0, 0);
      const L = this.tpl;
      if (L) {
        g.drawImage(L.base, 0, 0);
        // cat di dalam area bodi
        const ti = this.tmpIn.getContext('2d');
        ti.globalCompositeOperation = 'copy'; ti.drawImage(this.paint, 0, 0);
        ti.globalCompositeOperation = 'destination-in'; ti.drawImage(L.mask, 0, 0);
        g.drawImage(this.tmpIn, 0, 0);
        if (L.cover) g.drawImage(L.cover, 0, 0);
        if (L.gloss) g.drawImage(L.gloss, 0, 0);
        // cat yang meleber ke luar bodi
        const to = this.tmpOut.getContext('2d');
        to.globalCompositeOperation = 'copy'; to.drawImage(this.paint, 0, 0);
        to.globalCompositeOperation = 'destination-out'; to.drawImage(L.mask, 0, 0);
        g.globalAlpha = 0.92; g.drawImage(this.tmpOut, 0, 0); g.globalAlpha = 1;
      }
      if (clean) return;
      // kabut semprot
      for (const q of this.particles) {
        g.globalAlpha = Math.max(0, q.life / q.max) * 0.7; g.fillStyle = q.color;
        g.beginPath(); g.arc(q.x, q.y, q.r, 0, 6.3); g.fill();
      }
      g.globalAlpha = 1;
      if (this.mode === 'playing' || this.mode === 'countdown' || this.mode === 'idle') this.drawCan(g);
      for (const q of this.popups) {
        g.globalAlpha = Math.min(1, q.life * 2);
        g.font = '800 40px system-ui, sans-serif'; g.textAlign = 'center';
        g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(q.text, q.x, q.y);
        g.fillStyle = q.color; g.fillText(q.text, q.x, q.y);
      }
      g.globalAlpha = 1;
      if (this.mode !== 'idle' && this.mode !== 'loading' && this.cfg && this.tpl) this.drawHud(g);
      if (this.mode === 'countdown') this.drawCountdown(g);
    }
    drawCan(g) {
      const R = this.cfg ? this.cfg.sprayRadius : 70;
      // lingkar bidik
      g.save();
      g.lineWidth = 4; g.setLineDash(this.spraying ? [] : [14, 10]);
      g.strokeStyle = this.spraying ? this.color : 'rgba(255,255,255,.85)';
      g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 6;
      g.beginPath(); g.arc(this.pos.x, this.pos.y, R, 0, 6.3); g.stroke();
      g.setLineDash([]); g.beginPath(); g.arc(this.pos.x, this.pos.y, 5, 0, 6.3); g.fillStyle = '#fff'; g.fill();
      g.restore();
      const img = this.canImg; if (!img) return;
      const c = this.canPose();
      const h = 250, w = (h * img.width) / img.height;
      g.save();
      g.translate(c.nx, c.ny); g.rotate(c.ang + (this.spraying ? Math.sin(performance.now() / 40) * 0.015 : 0));
      g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 24; g.shadowOffsetY = 10;
      g.drawImage(img, -w / 2, 0, w, h);
      g.shadowColor = 'transparent';
      // tutup nozel berwarna = warna cat aktif
      g.fillStyle = this.color; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3;
      g.beginPath(); g.roundRect ? g.roundRect(-w * 0.16, -18, w * 0.32, 24, 6) : g.rect(-w * 0.16, -18, w * 0.32, 24); g.fill(); g.stroke();
      g.restore();
    }
    drawHud(g) {
      const b = this.branding, c = this.cfg;
      const mt = this.metrics();
      const card = (x, y, w, h) => { g.fillStyle = 'rgba(10,12,22,.78)'; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, 22) : g.rect(x, y, w, h); g.fill(); };
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      // kiri: peserta + warna
      card(28, 24, 560, 140);
      g.fillStyle = 'rgba(255,255,255,.65)'; g.font = '600 22px system-ui, sans-serif'; g.fillText('PENGECAT', 54, 62);
      g.fillStyle = '#fff'; g.font = '900 40px system-ui, sans-serif';
      g.fillText(this.ellipsis(g, c.name || '', 510), 54, 108);
      g.fillStyle = this.color; g.beginPath(); g.arc(70, 138, 13, 0, 6.3); g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '700 22px system-ui, sans-serif'; g.fillText(this.colorName || '', 94, 146);
      // tengah: waktu
      const tl = this.mode === 'countdown' ? c.durationSec : this.timeLeft;
      const frac = Math.max(0, tl / c.durationSec);
      const cx = W / 2, cy = 100;
      card(cx - 160, 18, 320, 160);
      g.lineWidth = 14; g.strokeStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(cx - 82, cy, 56, 0, 6.3); g.stroke();
      const warn = tl <= 10 && this.mode === 'playing';
      g.strokeStyle = warn ? '#ff3b3b' : b.accentColor; g.lineCap = 'round';
      g.beginPath(); g.arc(cx - 82, cy, 56, -Math.PI / 2, -Math.PI / 2 + 6.2832 * frac); g.stroke(); g.lineCap = 'butt';
      g.textAlign = 'center'; g.fillStyle = warn && Math.floor(tl * 2) % 2 ? '#ff6b6b' : '#fff';
      g.font = '900 60px system-ui, sans-serif'; g.fillText(fmtTime(tl), cx + 64, cy + 21);
      g.font = '700 18px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText('WAKTU', cx - 82, cy + 7);
      // meter
      const bar = (x, y, w, label, val, col, max = 100, big = true) => {
        g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `700 ${big ? 22 : 17}px system-ui, sans-serif`; g.fillText(label, x, y);
        g.textAlign = 'right'; g.fillStyle = col; g.font = `900 ${big ? 30 : 22}px system-ui, sans-serif`; g.fillText(Math.round(val) + '%', x + w, y + 2);
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y + 12, w, 14);
        g.fillStyle = col; g.fillRect(x, y + 12, (w * Math.min(max, val)) / max, 14);
      };
      card(1130, 24, 400, 140);
      bar(1156, 64, 348, 'RATA', mt.rata, '#3ee07a');
      bar(1156, 126, 164, 'MELEBER', mt.overspray, '#ff5a6a', 50, false);
      bar(1340, 126, 164, 'MELELEH', mt.drip, '#ff9b3d', 25, false);
      // kanan: skor
      card(1550, 24, 342, 140);
      g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.65)'; g.font = '600 22px system-ui, sans-serif'; g.fillText('SKOR', W - 54, 62);
      g.fillStyle = b.accentColor; g.font = '900 72px system-ui, sans-serif'; g.fillText(this.liveScore(mt).toLocaleString('id-ID'), W - 54, 140);
      g.textAlign = 'left';
    }
    drawCountdown(g) {
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, W, H);
      const n = Math.max(1, Math.ceil(this.countLeft));
      const f = this.countLeft - Math.floor(this.countLeft);
      g.textAlign = 'center';
      g.font = '800 54px system-ui, sans-serif'; g.fillStyle = '#fff';
      g.fillText('Kocok kalengnya… siap-siap!', W / 2, H / 2 - 190);
      g.save(); g.translate(W / 2, H / 2 + 110); g.scale(1 + f * 0.4, 1 + f * 0.4);
      g.font = '900 300px system-ui, sans-serif'; g.fillStyle = this.branding.accentColor;
      g.lineWidth = 14; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(n, 0, 0); g.fillText(n, 0, 0);
      g.restore();
      if (this.canImg) {
        const h = 300, w = (h * this.canImg.width) / this.canImg.height;
        const sh = Math.sin(performance.now() / 45) * 40;
        g.save(); g.translate(W / 2 + 420, H / 2 - 30 + sh); g.rotate(Math.sin(performance.now() / 45) * 0.25);
        g.drawImage(this.canImg, -w / 2, -h / 2, w, h); g.restore();
        g.save(); g.translate(W / 2 - 420, H / 2 - 30 - sh); g.rotate(-Math.sin(performance.now() / 45) * 0.25);
        g.drawImage(this.canImg, -w / 2, -h / 2, w, h); g.restore();
      }
    }
    ellipsis(g, s, max) { if (g.measureText(s).width <= max) return s; while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1); return s + '…'; }
  }

  // Thumbnail area kontrol untuk HP: template + margin, sama persis dengan pemetaan aim()
  PaintGame.PAD_MARGIN = PAD_MARGIN;
  window.PaintGame = PaintGame;
})();
