// Ichiban Drag Race - tampilan balapan di layar TV (canvas).
(function () {
  const H = 1080;
  const LANE_Y = [655, 830];           // garis tanah tiap lajur
  const LANE_S = [0.76, 0.9];          // skala (lajur kiri lebih jauh)
  const VIS_DELAY = 120;               // ms: motor digambar sedikit di belakang waktu nyata supaya tap yang masih di jalan ikut terhitung
  const GRADE = {
    perfect: { text: 'PERFECT!', color: '#2bff88' }, bagus: { text: 'BAGUS', color: '#ffd23f' },
    cepat: { text: 'TERLALU CEPAT', color: '#ff9d3f' }, telat: { text: 'TELAT!', color: '#ff4d4d' },
  };
  const imgs = {};
  function loadImg(src) { if (!src) return null; if (!imgs[src]) { const i = new Image(); i.src = src; imgs[src] = i; } return imgs[src]; }
  loadImg('img/can-aerosol.png'); loadImg('img/can-nc.png');

  function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (f > 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  const THEMES = {
    siang: { sky: ['#4fb3ff', '#bfe6ff'], stand: '#c9ced8', standDark: '#8d94a3', roof: '#e7eaf0', wall: '#e9ecf2', asphalt: '#3a3d45', asphalt2: '#33363d', grass: '#3f8f3a', lights: false, ambient: 0 },
    senja: { sky: ['#2b1e4e', '#ff8a4c'], stand: '#7d6a86', standDark: '#4c3d58', roof: '#a68fa6', wall: '#d9c6c9', asphalt: '#2f2c35', asphalt2: '#29262e', grass: '#2f5c33', lights: true, ambient: 0.15 },
    malam: { sky: ['#03040c', '#16204a'], stand: '#2a3044', standDark: '#1a1f2e', roof: '#3a4157', wall: '#c9cfdc', asphalt: '#23252c', asphalt2: '#1e2026', grass: '#183a1e', lights: true, ambient: 0.35 },
  };

  class RaceView {
    constructor(canvas, audio) {
      this.cv = canvas; this.ctx = canvas.getContext('2d'); this.audio = audio;
      this.b = { title: 'ICHIBAN DRAG RACE', primaryColor: '#d71920', accentColor: '#ffc400', lane1Color: '#e3262d', lane2Color: '#1f7bff', lane1Name: 'LAJUR KIRI', lane2Name: 'LAJUR KANAN', theme: 'malam', showBillboards: true, trackM: 201 };
      this.mode = 'idle'; this.race = null; this.particles = []; this.popups = []; this.ppm = 60; this.camX = -6;
      this.crowd = this.makeCrowd(); this.engines = [null, null]; this.lastT = performance.now(); this.time = 0;
      this.resize(); addEventListener('resize', () => this.resize());
      requestAnimationFrame((t) => this.frame(t));
    }
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.cv.width = Math.round(innerWidth * dpr); this.cv.height = Math.round(innerHeight * dpr);
      this.scale = this.cv.height / H; this.W = this.cv.width / this.scale;
    }
    setBranding(b) { this.b = { ...this.b, ...b }; if (b.logo) loadImg(b.logo); }
    laneColor(i) { return i === 0 ? this.b.lane1Color : this.b.lane2Color; }
    laneName(i) { return i === 0 ? this.b.lane1Name : this.b.lane2Name; }
    makeCrowd() {
      const r = rnd(42), list = [];
      const cols = ['#e53935', '#fdd835', '#1e88e5', '#ffffff', '#43a047', '#fb8c00', '#8e24aa', '#212121', '#ff80ab', '#00acc1'];
      for (let row = 0; row < 7; row++) for (let i = 0; i < 70; i++) list.push({ row, x: i * 28 + r() * 14 + (row % 2) * 14, c: cols[(r() * cols.length) | 0], ph: r() * 6.28, h: 0.8 + r() * 0.4, sign: r() < 0.04 });
      return list;
    }

    // ---------- kontrol dari tv.html ----------
    startIdle() {
      this.mode = 'idle'; this.race = null; this.stopEngines(); this.popups = []; this.camX = -6; this.ppm = 60;
      this.audio.setDuck(1); this.audio.crowdOn(0.25); this.audio.playMusic();
    }
    startRace(info, clock) {
      this.clock = clock; this.mode = 'race'; this.particles = []; this.popups = [];
      const cfg = info.cfg;
      this.race = {
        ...info, cfg, trackM: cfg.trackM, cheered: false, result: null,
        lanes: info.lanes.map((l) => l && { lane: l.lane, name: l.name, racer: new DragSim.Racer(cfg), shiftsSeen: 0, launched: false, finished: false, fsSeen: false, wheelie: 0, spin: 0, flame: 0 }),
        beeps: {},
      };
      this.race.lanes.forEach((l, i) => l && info.lanes[i].taps && l.racer.setTaps(info.lanes[i].taps));
      this.ppm = 60; this.camX = -4;
      this.audio.setDuck(0.25); this.audio.crowdOn(0.7);
      this.stopEngines();
      this.race.lanes.forEach((l, i) => { if (l) this.engines[i] = this.audio.createEngine(i === 0 ? -0.55 : 0.55); });
    }
    setTaps(lane, taps) { const l = this.race && this.race.lanes[lane]; if (l) l.racer.setTaps(taps); }
    showResult(res) {
      if (!this.race) return;
      this.race.result = res;
      this.mode = 'result';
      this.audio.setDuck(0.6);
      setTimeout(() => this.stopEngines(), 2500);
    }
    stopEngines() { this.engines.forEach((e) => e && e.stop()); this.engines = [null, null]; }

    // ---------- loop ----------
    frame(ts) {
      const dt = Math.min(0.05, (ts - this.lastT) / 1000); this.lastT = ts; this.time += dt;
      try { this.update(dt); this.draw(); } catch (e) { console.error(e); }
      requestAnimationFrame((t) => this.frame(t));
    }

    lights(now) {
      const r = this.race;
      if (!r) return null;
      const L = { prestage: now >= r.t0, stage: now >= r.stageAt, amber: r.ambers.map((a) => now >= a && now < r.greenAt + 400), green: [false, false], red: [false, false] };
      r.lanes.forEach((l, i) => {
        if (!l) return;
        const s = l.racer.s;
        const fsT = s.falseStart ? r.greenAt + s.fsT * 1000 : null;
        if (fsT !== null && now >= fsT) L.red[i] = true;
        else if (now >= r.greenAt) L.green[i] = true;
      });
      return L;
    }

    update(dt) {
      // partikel
      for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= p.rise * dt; p.r += p.grow * dt; }
      this.particles = this.particles.filter((p) => p.life > 0);
      for (const p of this.popups) p.life -= dt;
      this.popups = this.popups.filter((p) => p.life > 0);
      const r = this.race;
      if (!r || !this.clock) return;
      const now = this.clock.now();
      const tVis = (now - VIS_DELAY - r.greenAt) / 1000;
      // bunyi lampu
      const bp = (key, cond, fn) => { if (cond && !r.beeps[key]) { r.beeps[key] = 1; fn(); } };
      bp('pre', now >= r.t0, () => this.audio.beepStage());
      bp('stage', now >= r.stageAt, () => this.audio.beepStage());
      r.ambers.forEach((a, i) => bp('a' + i, now >= a && (i === 0 || a !== r.ambers[0]), () => this.audio.beepAmber()));
      const anyGreen = r.lanes.some((l) => l && !(l.racer.s.falseStart && l.racer.s.fsT * 1000 + r.greenAt <= r.greenAt));
      bp('green', now >= r.greenAt && anyGreen, () => this.audio.beepGreen());

      let leadX = -1e9, trailX = 1e9, activeN = 0, allFin = true;
      r.lanes.forEach((l, i) => {
        if (!l) return;
        const s = l.racer.advance(Math.max(l.racer.s.t, tVis));
        if (s.falseStart && !l.fsSeen && now >= r.greenAt + s.fsT * 1000) {
          l.fsSeen = true; this.audio.beepRed();
          this.popup(i, r.cfg.falseStartRule === 'diskualifikasi' ? 'FALSE START! DISKUALIFIKASI' : `FALSE START! +${r.cfg.falseStartPenaltySec}s`, '#ff3b3b', 2.4);
        }
        if (s.launched && !l.launched && tVis >= s.launchT) {
          l.launched = true; l.wheelie = 1;
          this.audio.screech(i ? 0.5 : -0.5);
          this.smoke(i, 26, 1.5);
          if (s.launchT !== null && !s.falseStart && !s.autoLaunch) this.popup(i, 'REAKSI ' + s.launchT.toFixed(3) + ' s', s.launchT < 0.25 ? '#2bff88' : s.launchT < 0.45 ? '#ffd23f' : '#ff9d3f', 1.6);
        }
        while (l.shiftsSeen < s.shifts.length) {
          const sh = s.shifts[l.shiftsSeen++];
          const g = GRADE[sh.grade];
          this.popup(i, g.text, g.color, 1.1);
          this.audio.pop(i ? 0.5 : -0.5, sh.grade === 'perfect');
          if (sh.grade === 'perfect') this.audio.perfect();
          l.flame = 0.25; l.wheelie = Math.max(l.wheelie, sh.grade === 'perfect' ? 0.35 : 0.15);
        }
        if (s.finishT !== null && !l.finished) {
          l.finished = true;
          this.popup(i, 'FINISH ' + s.finishT.toFixed(3) + ' s', '#ffffff', 3);
          if (!r.cheered) { r.cheered = true; this.audio.cheer(); this.audio.crowdOn(1); }
        }
        l.wheelie = Math.max(0, l.wheelie - dt * (l.wheelie > 0.5 ? 0.9 : 1.6));
        l.flame = Math.max(0, l.flame - dt);
        l.x = this.visX(l, tVis);
        l.spin += (s.v || 0) * dt * 1.6;
        if (s.dq) l.x = 0;
        activeN++;
        leadX = Math.max(leadX, l.x); trailX = Math.min(trailX, l.x);
        if (!l.finished && !s.dq) allFin = false;
        // asap ban saat burnout & mulai
        if (now >= r.t0 && now < r.stageAt && Math.random() < 0.6) this.smoke(i, 1, 1);
        if (l.launched && tVis - s.launchT < 0.8 && Math.random() < 0.7) this.smoke(i, 2, 1.2);
        // suara mesin
        const e = this.engines[i];
        if (e) {
          const throttle = s.finishT !== null ? Math.max(0, 1 - (tVis - s.finishT) * 0.7) : !s.launched ? (now >= r.t0 ? 0.6 : 0.2) : now < r.greenAt + s.shiftUntil * 1000 ? 0.3 : 1;
          const rpm = s.finishT !== null ? Math.max(r.cfg.redline * 0.3, s.rpm * (1 - (tVis - s.finishT) * 0.25)) : s.rpm;
          e.set(rpm, throttle, s.dq ? 0.3 : 1);
        }
      });
      // kamera
      if (activeN) {
        const gap = leadX - trailX;
        const target = tVis < 0 ? 60 : Math.max(16, Math.min(58, (this.W * 0.55) / (gap + 5)));
        this.ppm += (target - this.ppm) * Math.min(1, dt * 2.5);
        this.camX = (leadX + trailX) / 2 - 2;
        if (tVis < 0) this.camX = -3.5;
      }
      if (allFin && !r.cheerEnd) r.cheerEnd = true;
    }
    visX(l, tVis) {
      const s = l.racer.s;
      if (s.finishT === null) return s.x;
      // setelah finish motor melambat (hanya visual)
      const vF = s.v, tau = Math.max(0, tVis - s.finishT), dec = 9;
      const tStop = vF / dec;
      const tt = Math.min(tau, tStop);
      return this.race.trackM + vF * tt - 0.5 * dec * tt * tt;
    }
    popup(lane, text, color, life) { this.popups.push({ lane, text, color, life, max: life }); }
    smoke(lane, n, power) {
      const l = this.race && this.race.lanes[lane];
      const sx = this.sx(l ? l.x : 0) - 235 * LANE_S[lane];
      for (let k = 0; k < n; k++) this.particles.push({ lane, x: sx + (Math.random() - 0.5) * 30, y: LANE_Y[lane] - 10, vx: -80 - Math.random() * 220 * power, vy: -(10 + Math.random() * 40), rise: 18, r: 18 + Math.random() * 16, grow: 70 * power, life: 0.9 + Math.random() * 0.8, max: 1.6 });
    }
    sx(xm) { return this.W * 0.5 + (xm - this.camX) * this.ppm; }

    // ---------- gambar ----------
    draw() {
      const c = this.ctx, W = this.W;
      c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      const th = THEMES[this.b.theme] || THEMES.malam;
      this.drawBackground(c, W, th);
      this.drawTrack(c, W, th);
      // asap di belakang motor
      for (const p of this.particles) {
        const a = Math.max(0, p.life / p.max) * 0.45;
        c.fillStyle = `rgba(225,225,230,${a})`;
        c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill();
      }
      // motor
      const r = this.race;
      const lanes = r ? r.lanes : [{ idle: true }, { idle: true }];
      const showLanes = r ? [0, 1].filter((i) => r.lanes[i]) : this.b.mode === 'solo' ? [0] : [0, 1];
      for (const i of showLanes) {
        const l = lanes[i];
        const x = r ? l.x : 0;
        const s = r ? l.racer.s : null;
        const bx = this.sx(x);
        const shake = s && s.launched && s.finishT === null ? Math.sin(this.time * 70 + i) * 1.2 : 0;
        this.drawBike(c, bx, LANE_Y[i] + shake * 0.5, LANE_S[i], this.laneColor(i), {
          wheelie: r ? l.wheelie * 0.22 : 0, spin: r ? l.spin : this.time * 0.5, flame: r ? l.flame : 0, num: i + 1, dq: s && s.dq,
        });
        // indikator kalau motor tertinggal di luar layar
        if (bx < 40) {
          c.fillStyle = this.laneColor(i); c.font = '900 30px system-ui';
          c.textAlign = 'left'; c.fillText('◀ ' + this.laneName(i), 20, LANE_Y[i] - 60 * LANE_S[i]);
        }
      }
      this.drawFinishGantry(c, W);
      // popup teks di atas motor
      for (const p of this.popups) {
        if (!r || !r.lanes[p.lane]) continue;
        const k = 1 - p.life / p.max;
        const x = Math.max(260, Math.min(W - 260, this.sx(r.lanes[p.lane].x) - 120));
        const y = LANE_Y[p.lane] - 210 * LANE_S[p.lane] - k * 50;
        c.globalAlpha = Math.min(1, p.life * 3);
        c.font = `900 ${p.lane === 0 ? 44 : 52}px system-ui`; c.textAlign = 'center';
        c.lineWidth = 9; c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(p.text, x, y);
        c.fillStyle = p.color; c.fillText(p.text, x, y);
        c.globalAlpha = 1;
      }
      if (th.ambient > 0) { // sedikit gelap di pinggir layar
        const g = c.createRadialGradient(W / 2, 600, 300, W / 2, 600, W * 0.75);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${th.ambient})`);
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
      if (r) { this.drawHud(c, W); this.drawTree(c, W); this.drawIntro(c, W); }
    }

    drawBackground(c, W, th) {
      const g = c.createLinearGradient(0, 0, 0, 420);
      g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
      c.fillStyle = g; c.fillRect(0, 0, W, 470);
      if (th.lights) { // bintang
        const r = rnd(9);
        c.fillStyle = 'rgba(255,255,255,.7)';
        for (let i = 0; i < 90; i++) c.fillRect(r() * W, r() * 220, 2, 2);
      }
      // tribun penonton (paralaks 0.35)
      const par = 0.35, period = 1960;
      const off = -((this.camX * this.ppm * par) % period + period) % period;
      const cheering = this.race && (this.race.cheered || this.mode === 'result');
      for (let base = off - period; base < W + period; base += period) {
        // atap
        c.fillStyle = th.roof; c.fillRect(base, 170, period - 40, 22);
        c.fillStyle = th.standDark; for (let k = 0; k < 8; k++) c.fillRect(base + 20 + k * 240, 190, 10, 60);
        c.fillStyle = th.stand; c.fillRect(base, 248, period - 40, 200);
        c.fillStyle = th.standDark;
        for (let row = 0; row < 7; row++) c.fillRect(base, 262 + row * 27, period - 40, 4);
        for (const p of this.crowd) {
          if (p.x > period - 60) continue;
          const jump = cheering ? Math.abs(Math.sin(this.time * 9 + p.ph)) * 8 : Math.sin(this.time * 2 + p.ph) * 1.2;
          const x = base + p.x + 10, y = 258 + p.row * 27 - jump;
          c.fillStyle = p.c; c.fillRect(x - 6, y - 10 * p.h, 12, 12 * p.h);
          c.fillStyle = '#e0b48a'; c.beginPath(); c.arc(x, y - 14 * p.h, 5.5, 0, 7); c.fill();
          if (p.sign) { c.fillStyle = this.b.primaryColor; c.fillRect(x - 14, y - 46 - jump, 28, 18); }
        }
      }
      // lampu sorot (malam/senja)
      if (th.lights) {
        const off2 = -((this.camX * this.ppm * 0.6) % 900 + 900) % 900;
        for (let x = off2 - 900; x < W + 900; x += 900) {
          c.fillStyle = '#555b6e'; c.fillRect(x + 440, 40, 8, 400);
          c.fillStyle = '#fffbe0'; c.fillRect(x + 410, 30, 68, 22);
          const lg = c.createRadialGradient(x + 444, 42, 5, x + 444, 42, 260);
          lg.addColorStop(0, 'rgba(255,250,210,.45)'); lg.addColorStop(1, 'rgba(255,250,210,0)');
          c.fillStyle = lg; c.fillRect(x + 184, 0, 520, 320);
        }
      }
    }

    drawTrack(c, W, th) {
      const ppm = this.ppm;
      // tembok + billboard (bergerak bersama lintasan, paralaks 0.9)
      c.fillStyle = th.wall; c.fillRect(0, 448, W, 92);
      c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, 530, W, 10);
      const wallX = (xm) => this.W * 0.5 + (xm - this.camX) * ppm * 0.9;
      if (this.b.showBillboards) {
        const spacing = 30; // meter
        const start = Math.floor((this.camX - W / ppm) / spacing) - 1;
        for (let k = start; k < start + W / (ppm * 0.9 * spacing) + 4; k++) {
          const x = wallX(k * spacing + 8);
          if (x < -700 || x > W + 50) continue;
          this.drawBillboard(c, x, 456, k);
        }
      }
      // papan jarak di tembok
      const tm = this.race ? this.race.trackM : this.b.trackM || 201;
      const marks = [];
      for (let m = 50; m < tm; m += 50) marks.push(m);
      for (const m of marks) {
        const x = this.sx(m);
        if (x < -100 || x > W + 100) continue;
        c.fillStyle = '#111'; c.fillRect(x - 54, 400, 108, 48);
        c.fillStyle = '#fff'; c.font = '800 30px system-ui'; c.textAlign = 'center'; c.fillText(m + ' m', x, 436);
        c.fillStyle = '#666'; c.fillRect(x - 3, 448, 6, 90);
      }
      // aspal
      const ag = c.createLinearGradient(0, 540, 0, 880);
      ag.addColorStop(0, th.asphalt2); ag.addColorStop(1, th.asphalt);
      c.fillStyle = ag; c.fillRect(0, 540, W, 340);
      // bekas ban dekat garis start
      c.fillStyle = 'rgba(0,0,0,.35)';
      for (const ly of LANE_Y) { const x0 = this.sx(-2), x1 = this.sx(40); c.fillRect(x0, ly - 8, Math.max(0, x1 - x0), 5); c.fillRect(x0, ly + 2, Math.max(0, x1 - x0), 4); }
      // garis tepi & pemisah lajur
      c.fillStyle = '#f2f2f2'; c.fillRect(0, 556, W, 6); c.fillRect(0, 862, W, 6);
      c.fillStyle = '#ffd400';
      const dash = 6 * ppm, off = -((this.camX * ppm) % dash + dash) % dash;
      for (let x = off - dash; x < W; x += dash) c.fillRect(x, 722, dash * 0.55, 7);
      // garis start
      const xs = this.sx(0);
      c.fillStyle = '#fff'; c.fillRect(xs - 5, 562, 10, 300);
      c.save(); c.translate(xs - 50, 845); c.rotate(-Math.PI / 2); c.font = '900 34px system-ui'; c.fillStyle = 'rgba(255,255,255,.75)'; c.textAlign = 'left'; c.fillText('START', 0, 0); c.restore();
      // garis finish (kotak-kotak)
      const xf = this.sx(tm);
      if (xf > -60 && xf < W + 60) {
        for (let k = 0; k < 20; k++) for (let j = 0; j < 2; j++) { c.fillStyle = (k + j) % 2 ? '#111' : '#fff'; c.fillRect(xf - 20 + j * 20, 562 + k * 15, 20, 15); }
      }
      // rumput depan
      c.fillStyle = th.grass; c.fillRect(0, 868, W, 30);
    }

    drawBillboard(c, x, y, k) {
      const w = 560, h = 72, b = this.b;
      c.fillStyle = k % 2 ? b.primaryColor : '#14161f'; c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 3; c.strokeRect(x + 3, y + 3, w - 6, h - 6);
      const can = imgs[k % 2 ? 'img/can-aerosol.png' : 'img/can-nc.png'];
      if (can && can.complete && can.naturalWidth) { const ch = h - 8, cw = ch * can.naturalWidth / can.naturalHeight; c.drawImage(can, x + 12, y + 4, cw, ch); }
      const logo = b.logo && imgs[b.logo];
      c.fillStyle = k % 2 ? '#fff' : b.accentColor; c.textAlign = 'left';
      if (logo && logo.complete && logo.naturalWidth && k % 3 === 0) { const lh = h - 16, lw = Math.min(w - 110, lh * logo.naturalWidth / logo.naturalHeight); c.drawImage(logo, x + 90, y + 8, lw, lh); }
      else {
        c.font = '900 34px system-ui';
        const txt = k % 3 === 2 ? 'ICHIBAN PAINT' : b.title;
        c.fillText(txt.length > 22 ? txt.slice(0, 22) : txt, x + 90, y + 48, w - 110);
      }
    }

    drawFinishGantry(c, W) {
      const tm = this.race ? this.race.trackM : this.b.trackM || 201;
      const x = this.sx(tm);
      if (x < -200 || x > W + 200) return;
      c.fillStyle = '#2a2d36'; c.fillRect(x - 12, 330, 18, 540); c.fillRect(x + 4, 330, 10, 230);
      c.fillStyle = this.b.primaryColor; c.fillRect(x - 160, 300, 320, 70);
      c.fillStyle = '#fff'; c.font = '900 46px system-ui'; c.textAlign = 'center'; c.fillText('FINISH', x, 352);
      for (let k = 0; k < 16; k++) { c.fillStyle = k % 2 ? '#111' : '#fff'; c.fillRect(x - 160 + k * 20, 290, 20, 10); }
    }

    // Motor drag tampak samping. (x, y) = titik roda depan menyentuh tanah.
    drawBike(c, x, y, s, color, o) {
      c.save();
      c.translate(x, y); c.scale(s, s);
      // bayangan
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(-150, 4, 190, 12, 0, 0, 7); c.fill();
      // wheelie: putar di titik roda belakang
      c.translate(-235, 0); c.rotate(-(o.wheelie || 0)); c.translate(235, 0);
      if (o.dq) c.globalAlpha = 0.55;
      const wheel = (cx, cy, r, fat) => {
        c.fillStyle = '#0d0d0f'; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
        c.fillStyle = '#2a2a2e'; c.beginPath(); c.arc(cx, cy, r * (fat ? 0.62 : 0.72), 0, 7); c.fill();
        c.strokeStyle = '#b9bec8'; c.lineWidth = 3;
        c.beginPath(); c.arc(cx, cy, r * (fat ? 0.6 : 0.7), 0, 7); c.stroke();
        for (let k = 0; k < 5; k++) {
          const a = (o.spin || 0) * (fat ? 1 : 1.25) + (k * Math.PI * 2) / 5;
          c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6); c.stroke();
        }
        c.fillStyle = '#d0d4dc'; c.beginPath(); c.arc(cx, cy, 6, 0, 7); c.fill();
      };
      // wheelie bar
      c.strokeStyle = '#9aa0ab'; c.lineWidth = 6;
      c.beginPath(); c.moveTo(-245, -44); c.lineTo(-345, -14); c.stroke();
      c.fillStyle = '#111'; c.beginPath(); c.arc(-345, -8, 8, 0, 7); c.fill();
      // swingarm
      c.strokeStyle = '#4b4f5a'; c.lineWidth = 14; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-235, -44); c.lineTo(-150, -66); c.stroke();
      wheel(-235, -44, 44, true);
      wheel(-22, -34, 34, false);
      // garpu depan
      c.strokeStyle = '#c3c8d2'; c.lineWidth = 9;
      c.beginPath(); c.moveTo(-22, -34); c.lineTo(-58, -124); c.stroke();
      // mesin
      c.fillStyle = '#3a3e48'; c.beginPath(); c.roundRect(-176, -100, 82, 52, 10); c.fill();
      c.fillStyle = '#5a5f6b'; for (let k = 0; k < 4; k++) c.fillRect(-170 + k * 19, -96, 12, 20);
      // knalpot
      c.strokeStyle = '#d7dbe3'; c.lineWidth = 11;
      c.beginPath(); c.moveTo(-110, -56); c.quadraticCurveTo(-170, -60, -238, -84); c.stroke();
      c.fillStyle = '#7d828c'; c.beginPath(); c.ellipse(-242, -86, 6, 9, 0.3, 0, 7); c.fill();
      if (o.flame > 0) {
        const f = o.flame * 4;
        c.fillStyle = 'rgba(80,160,255,.9)'; c.beginPath(); c.moveTo(-244, -92); c.lineTo(-244 - 60 * f, -96 - 8 * f); c.lineTo(-244, -78); c.fill();
        c.fillStyle = 'rgba(255,170,40,.95)'; c.beginPath(); c.moveTo(-244, -90); c.lineTo(-244 - 40 * f, -90); c.lineTo(-244, -80); c.fill();
      }
      // body / fairing
      const dark = shade(color, -0.35), light = shade(color, 0.35);
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(-250, -122); c.lineTo(-190, -112); c.lineTo(-150, -126); c.lineTo(-96, -134); c.lineTo(-62, -128);
      c.lineTo(-30, -104); c.lineTo(-42, -78); c.lineTo(-96, -66); c.lineTo(-120, -82); c.lineTo(-176, -100); c.lineTo(-222, -104); c.closePath(); c.fill();
      c.fillStyle = dark; c.beginPath(); c.moveTo(-96, -66); c.lineTo(-42, -78); c.lineTo(-30, -104); c.lineTo(-60, -96); c.closePath(); c.fill();
      c.fillStyle = light; c.beginPath(); c.moveTo(-230, -118); c.lineTo(-150, -124); c.lineTo(-96, -131); c.lineTo(-100, -126); c.lineTo(-170, -118); c.closePath(); c.fill();
      // nomor
      c.fillStyle = '#fff'; c.beginPath(); c.ellipse(-78, -98, 20, 16, 0, 0, 7); c.fill();
      c.fillStyle = '#111'; c.font = '900 24px system-ui'; c.textAlign = 'center'; c.fillText(o.num, -78, -89);
      // kaca
      c.fillStyle = 'rgba(170,220,255,.55)'; c.beginPath(); c.moveTo(-62, -128); c.lineTo(-44, -150); c.lineTo(-36, -124); c.closePath(); c.fill();
      // pembalap
      c.strokeStyle = '#17181d'; c.lineWidth = 22; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-176, -138); c.lineTo(-128, -104); c.lineTo(-152, -70); c.stroke();     // kaki
      c.lineWidth = 30; c.beginPath(); c.moveTo(-182, -146); c.lineTo(-96, -166); c.stroke();          // badan
      c.strokeStyle = color; c.lineWidth = 8; c.beginPath(); c.moveTo(-178, -150); c.lineTo(-100, -168); c.stroke();
      c.strokeStyle = '#17181d'; c.lineWidth = 14; c.beginPath(); c.moveTo(-100, -160); c.lineTo(-60, -128); c.stroke(); // lengan
      // helm
      c.fillStyle = color; c.beginPath(); c.arc(-76, -170, 22, 0, 7); c.fill();
      c.fillStyle = '#16181f'; c.beginPath(); c.moveTo(-70, -178); c.lineTo(-54, -176); c.lineTo(-56, -162); c.lineTo(-70, -164); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(-82, -178, 7, 0, 7); c.fill();
      c.restore();
    }

    drawTree(c, W) {
      const r = this.race, now = this.clock.now();
      const lt = this.lights(now);
      const sinceGreen = (now - r.greenAt) / 1000;
      const big = sinceGreen < 1.6;
      const s = big ? 1 : 0.55;
      const cx = big ? W * 0.29 : 110, top = big ? 40 : 18;
      c.save(); c.translate(cx, top); c.scale(s, s);
      c.fillStyle = 'rgba(12,13,18,.92)'; c.beginPath(); c.roundRect(-150, 0, 300, 620, 26); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.15)'; c.lineWidth = 3; c.stroke();
      c.fillStyle = '#2b2e38'; c.fillRect(-10, 0, 20, 620);
      const bulb = (x, y, rad, on, col) => {
        c.fillStyle = on ? col : 'rgba(80,80,90,.45)';
        if (on) { c.shadowColor = col; c.shadowBlur = 40; }
        c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill(); c.shadowBlur = 0;
        c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 3; c.stroke();
      };
      for (const side of [0, 1]) {
        const x = side === 0 ? -75 : 75;
        const active = !!r.lanes[side];
        c.fillStyle = active ? this.laneColor(side) : '#444'; c.fillRect(x - 50, 14, 100, 12);
        bulb(x - 22, 50, 14, active && lt.prestage, '#fff7c2'); bulb(x + 22, 50, 14, active && lt.prestage, '#fff7c2');
        bulb(x - 22, 90, 14, active && lt.stage, '#fff7c2'); bulb(x + 22, 90, 14, active && lt.stage, '#fff7c2');
        for (let k = 0; k < 3; k++) bulb(x, 160 + k * 92, 38, active && lt.amber[k], '#ffb300');
        bulb(x, 160 + 3 * 92, 38, active && lt.green[side], '#20ff6a');
        bulb(x, 160 + 4 * 92, 38, active && lt.red[side], '#ff2020');
      }
      c.restore();
      if (big && now < r.greenAt && now >= r.t0) {
        c.textAlign = 'center'; c.font = '900 40px system-ui'; c.fillStyle = '#fff';
        c.lineWidth = 8; c.strokeStyle = 'rgba(0,0,0,.6)';
        const txt = now < r.stageAt ? 'BURNOUT... SIAP-SIAP!' : 'TUNGGU LAMPU HIJAU!';
        c.strokeText(txt, cx, 712); c.fillText(txt, cx, 712);
      }
      if (big && sinceGreen >= 0 && sinceGreen < 1.2) {
        c.textAlign = 'center'; c.font = '900 120px system-ui';
        c.globalAlpha = 1 - sinceGreen / 1.2;
        c.lineWidth = 12; c.strokeStyle = '#000'; c.strokeText('GAS!!!', cx, 760);
        c.fillStyle = '#20ff6a'; c.fillText('GAS!!!', cx, 760); c.globalAlpha = 1;
      }
    }

    drawIntro(c, W) {
      const r = this.race, now = this.clock.now();
      if (now >= r.t0 + 300) return;
      const a = Math.min(1, (r.t0 + 300 - now) / 400);
      c.globalAlpha = a;
      c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, 300, W, 260);
      c.textAlign = 'center'; c.font = '900 84px system-ui';
      const names = r.lanes.filter(Boolean);
      if (names.length === 2) {
        c.fillStyle = this.laneColor(0); c.textAlign = 'right'; c.fillText(names[0].name.toUpperCase(), W / 2 - 90, 460);
        c.fillStyle = this.laneColor(1); c.textAlign = 'left'; c.fillText(names[1].name.toUpperCase(), W / 2 + 90, 460);
        c.fillStyle = this.b.accentColor; c.textAlign = 'center'; c.fillText('VS', W / 2, 460);
      } else if (names.length) {
        c.fillStyle = '#fff'; c.fillText(names[0].name.toUpperCase(), W / 2, 450);
        c.font = '700 40px system-ui'; c.fillStyle = this.b.accentColor; c.fillText('LAWAN JAM: KEJAR WAKTU TERCEPAT!', W / 2, 515);
      }
      c.globalAlpha = 1;
    }

    drawHud(c, W) {
      const r = this.race, now = this.clock.now();
      const tVis = (now - VIS_DELAY - r.greenAt) / 1000;
      // peta lintasan
      const mx0 = W * 0.32, mx1 = W * 0.68, my = 46;
      c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.roundRect(mx0 - 30, my - 30, mx1 - mx0 + 60, 80, 18); c.fill();
      c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(mx0, my - 3, mx1 - mx0, 6);
      for (let k = 0; k < 10; k++) { c.fillStyle = k % 2 ? '#111' : '#fff'; c.fillRect(mx1 - 4, my - 15 + k * 3, 8, 3); }
      r.lanes.forEach((l, i) => {
        if (!l) return;
        const x = mx0 + (mx1 - mx0) * Math.min(1, Math.max(0, l.x / r.trackM));
        c.fillStyle = this.laneColor(i); c.beginPath(); c.arc(x, my + (i ? 9 : -9), 11, 0, 7); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
      });
      c.fillStyle = '#fff'; c.font = '800 22px system-ui'; c.textAlign = 'center';
      c.fillText(`${r.trackM} m`, (mx0 + mx1) / 2, my + 38);
      // jam balapan
      const tt = Math.max(0, tVis);
      c.font = '900 40px ui-monospace, Menlo, monospace'; c.textAlign = 'right';
      c.fillStyle = '#fff'; c.fillText(tt.toFixed(2) + ' s', W - 30, 60);

      // dasbor tiap lajur
      const lanesShown = r.lanes.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
      const pw = lanesShown.length === 2 ? W / 2 : W;
      lanesShown.forEach((i, k) => this.drawDash(c, k * pw, 898, pw, 182, i));
    }

    drawDash(c, x, y, w, h, i) {
      const r = this.race, l = r.lanes[i], s = l.racer.s, cfg = r.cfg;
      const col = this.laneColor(i);
      c.fillStyle = 'rgba(8,9,14,.92)'; c.fillRect(x, y, w, h);
      c.fillStyle = col; c.fillRect(x, y, w, 6);
      if (i === 1 && x > 0) { c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(x, y, 2, h); }
      c.textAlign = 'left';
      c.fillStyle = col; c.font = '800 22px system-ui'; c.fillText(this.laneName(i), x + 30, y + 40);
      c.fillStyle = '#fff'; c.font = '900 46px system-ui'; c.fillText(l.name.toUpperCase().slice(0, 18), x + 30, y + 92, w * 0.5);
      // statistik
      const res = l.racer.result();
      const rtTxt = s.falseStart ? 'FALSE' : s.launched && s.launchT !== null && !s.autoLaunch ? s.launchT.toFixed(3) : s.autoLaunch ? 'TELAT' : '-.---';
      const etTxt = s.finishT !== null ? res.et.toFixed(3) : s.launched ? Math.max(0, s.t - s.launchT).toFixed(2) : '-.---';
      const stats = [['REAKSI', rtTxt, s.falseStart ? '#ff4d4d' : '#fff'], ['WAKTU', etTxt, s.finishT !== null ? this.b.accentColor : '#fff'], ['KM/J', String(Math.round(s.v * 3.6)), '#fff']];
      stats.forEach(([lab, val, colr], k) => {
        const sx = x + 30 + k * Math.min(200, w * 0.15);
        c.fillStyle = '#9aa1b2'; c.font = '700 18px system-ui'; c.fillText(lab, sx, y + 128);
        c.fillStyle = colr; c.font = '900 34px ui-monospace, Menlo, monospace'; c.fillText(val, sx, y + 164);
      });
      // takometer
      const gx = x + w - 150, gy = y + 160, R = 125;
      const a0 = Math.PI * 1.0, a1 = Math.PI * 2.0;
      const ang = (p) => a0 + (a1 - a0) * Math.min(1.05, p);
      c.lineWidth = 18; c.lineCap = 'butt';
      c.strokeStyle = '#2a2d38'; c.beginPath(); c.arc(gx, gy, R, a0, a1); c.stroke();
      c.strokeStyle = '#ffd23f'; c.beginPath(); c.arc(gx, gy, R, ang(cfg.goodFromPct / 100), ang(cfg.perfectFromPct / 100)); c.stroke();
      c.strokeStyle = '#2bff88'; c.beginPath(); c.arc(gx, gy, R, ang(cfg.perfectFromPct / 100), ang(0.995)); c.stroke();
      c.strokeStyle = '#ff2b2b'; c.beginPath(); c.arc(gx, gy, R, ang(0.995), a1 + 0.08); c.stroke();
      c.fillStyle = '#aaa'; c.font = '700 16px system-ui'; c.textAlign = 'center';
      const maxK = Math.floor(cfg.redline / 1000);
      for (let k = 0; k <= maxK; k += maxK > 12 ? 2 : 1) { const a = ang((k * 1000) / cfg.redline); c.fillText(k, gx + Math.cos(a) * (R - 28), gy + Math.sin(a) * (R - 28) + 6); }
      const p = s.rpm / cfg.redline;
      const na = ang(p);
      c.strokeStyle = '#ff3d3d'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + Math.cos(na) * (R + 6), gy + Math.sin(na) * (R + 6)); c.stroke();
      c.fillStyle = '#ddd'; c.beginPath(); c.arc(gx, gy, 10, 0, 7); c.fill();
      // gigi
      c.fillStyle = p >= cfg.perfectFromPct / 100 && s.launched && s.gear < l.racer.m.n - 1 ? '#2bff88' : '#fff';
      c.font = '900 52px system-ui'; c.fillText(s.launched ? String(s.gear + 1) : 'N', gx, gy - 14);
      // hasil akhir
      const rr = r.result && r.result.results[i];
      if (rr) {
        c.textAlign = 'right'; c.font = '900 34px system-ui';
        const win = r.result.winner === i;
        c.fillStyle = rr.dq ? '#ff4d4d' : win ? '#2bff88' : this.b.accentColor;
        c.fillText(rr.dq ? 'DISKUALIFIKASI' : win ? '🏆 MENANG' : `${rr.score.toLocaleString('id-ID')} poin`, gx - 150, y + 44);
      }
    }
  }
  window.RaceView = RaceView;
})();
