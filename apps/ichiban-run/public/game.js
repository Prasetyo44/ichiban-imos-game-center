// Ichiban Run - mesin game (berjalan di layar TV / laptop)
// Dunia game memakai koordinat tetap 1920x1080 lalu diskalakan ke ukuran layar.
(function () {
  const W = 1920, H = 1080, GROUND = 870, PLAYER_X = 330;

  const THEMES = {
    siang: { sky: ['#3fb6ff', '#a9e3ff', '#e9f8ff'], sun: '#fff3b0', far: '#9cc7e3', mid: '#79a6c9', near: '#5d86aa', grass: '#5cb83e', grassDark: '#3f8f2a', road: '#3a3d45', line: '#f4f4f4', win: 'rgba(255,255,255,.35)', cloud: 'rgba(255,255,255,.9)' },
    senja: { sky: ['#2d1b5a', '#c4456b', '#ffb36b'], sun: '#ffd27a', far: '#8a4a7c', mid: '#5e2f63', near: '#43204d', grass: '#6e8f3a', grassDark: '#4f6a28', road: '#2f2a36', line: '#ffd9a0', win: 'rgba(255,210,140,.55)', cloud: 'rgba(255,200,190,.65)' },
    malam: { sky: ['#050816', '#101c46', '#26346e'], sun: '#f3f1d8', far: '#1f2a55', mid: '#151d40', near: '#0e142e', grass: '#1f5a3a', grassDark: '#143d27', road: '#1d1f27', line: '#c9c9c9', win: 'rgba(255,220,120,.8)', cloud: 'rgba(160,170,210,.25)' },
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // angka acak tetap per indeks (untuk gedung latar yang konsisten)
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  const imgCache = new Map();
  function loadImg(src) {
    if (!src) return null;
    if (imgCache.has(src)) return imgCache.get(src);
    const im = new Image();
    im.src = src;
    imgCache.set(src, im);
    return im;
  }

  // ---------- Suara sederhana (WebAudio, tanpa file) ----------
  const Sfx = {
    ctx: null, on: true,
    unlock() {
      try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume(); } catch {}
    },
    tone(f1, f2, dur, type = 'square', vol = 0.12) {
      if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    jump() { this.tone(380, 760, 0.16, 'square', 0.08); },
    coin() { this.tone(988, 1480, 0.12, 'triangle', 0.12); },
    heart() { this.tone(523, 1046, 0.3, 'sine', 0.18); },
    hit() { this.tone(220, 60, 0.35, 'sawtooth', 0.16); },
    over() { this.tone(440, 110, 0.9, 'triangle', 0.18); },
    beep(hi) { this.tone(hi ? 1046 : 660, hi ? 1046 : 660, hi ? 0.4 : 0.15, 'square', 0.1); },
  };

  class RunnerGame {
    constructor(canvas, hooks = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.hooks = hooks;
      this.branding = { title: 'ICHIBAN RUN', primaryColor: '#d71920', accentColor: '#ffc400', theme: 'siang', showBillboards: true, sprites: [] };
      this.mode = 'idle'; // idle (demo otomatis) | countdown | playing | over
      this.keys = { up: false, down: false };
      this.camX = 0;
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.startIdle();
      this.last = performance.now();
      const loop = (now) => {
        const dt = Math.min(0.033, (now - this.last) / 1000);
        this.last = now;
        this.update(dt, now);
        this.render(now);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = this.cv.getBoundingClientRect();
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
      // isi penuh layar: skala berdasarkan tinggi, lebar dunia menyesuaikan
      this.scale = this.cv.height / H;
      this.viewW = this.cv.width / this.scale;
    }

    setBranding(b) {
      this.branding = { ...this.branding, ...b };
      Sfx.on = b.sound !== false;
      (b.sprites || []).forEach((s) => loadImg(s.src));
      if (b.logo) loadImg(b.logo);
    }

    baseConfig() {
      return { lives: 3, maxLives: 5, heartChance: 0, invincibleSec: 1, startSpeed: 620, maxSpeed: 900, accel: 4, jumpHeight: 300, gravity: 2800, doubleJump: false,
        playerSize: 170, obsMinGap: 1.1, obsMaxGap: 2.2, flyingChance: 30, flyingStartM: 0, doubleObsChance: 10, maxDurationSec: 0,
        pointsPerMeter: 1, coinChance: 40, coinPoints: 25, pxPerMeter: 40, countdownSec: 3 };
    }

    reset(cfg) {
      this.cfg = { ...this.baseConfig(), ...cfg };
      const c = this.cfg;
      this.speed = c.startSpeed;
      this.dist = 0; this.coins = 0; this.lives = c.lives; this.elapsed = 0;
      this.obs = []; this.items = []; this.parts = []; this.popups = [];
      this.spawnIn = 1.2;
      this.invUntil = 0; this.shake = 0; this.flash = 0;
      this.p = { y: 0, vy: 0, grounded: true, duck: 0, usedDouble: false, squash: 0, rot: 0, lastGround: 0, jumpBuf: -1 };
      this.keys = { up: false, down: false };
      this.time = 0;
      this.tickAcc = 0;
      this.jumpV = Math.sqrt(2 * c.gravity * c.jumpHeight);
      this.airTime = (2 * this.jumpV) / c.gravity;
    }

    startIdle() {
      const sprites = this.branding.sprites || [];
      this.idleSpriteIdx = ((this.idleSpriteIdx ?? -1) + 1) % Math.max(1, sprites.length);
      this.reset({});
      this.sprite = sprites[this.idleSpriteIdx] || null;
      this.mode = 'idle';
    }

    start(cfg) {
      this.reset(cfg);
      this.sprite = cfg.sprite;
      this.playerName = cfg.name;
      loadImg(cfg.sprite && cfg.sprite.src);
      this.mode = 'countdown';
      this.countStart = performance.now();
      this.lastBeep = -1;
      if (!cfg.countdownSec) this.go();
    }

    go() {
      this.mode = 'playing';
      this.startedAt = performance.now();
      this.hooks.onRunning && this.hooks.onRunning();
    }

    forceEnd() {
      if (this.mode === 'playing' || this.mode === 'countdown') this.gameOver('admin');
    }

    get meters() { return Math.floor(this.dist / this.cfg.pxPerMeter); }
    get score() { return Math.floor(this.meters * this.cfg.pointsPerMeter + this.coins * this.cfg.coinPoints); }

    input(k, down) {
      if (k === 'up') {
        if (down && !this.keys.up) this.p.jumpBuf = this.time;
        this.keys.up = down;
      } else this.keys.down = down;
    }

    // ---------- Logika ----------
    update(dt, now) {
      if (this.mode === 'countdown') {
        const left = this.cfg.countdownSec - (now - this.countStart) / 1000;
        const n = Math.ceil(left);
        if (n !== this.lastBeep && n >= 0) { this.lastBeep = n; Sfx.beep(n === 0); }
        if (left <= 0) this.go();
        this.updateWorld(dt * 0.15, false);
        this.updatePlayer(dt);
        return;
      }
      if (this.mode === 'over') {
        this.speed = Math.max(0, this.speed - this.speed * 2.5 * dt);
        this.updateWorld(dt, false);
        this.updatePlayer(dt);
        return;
      }
      if (this.mode === 'idle') this.autopilot();
      this.time += dt;
      const c = this.cfg;
      this.speed = Math.min(c.maxSpeed, this.speed + c.accel * dt);
      if (this.mode === 'playing') {
        this.elapsed += dt;
        this.dist += this.speed * dt;
        if (c.maxDurationSec > 0 && this.elapsed >= c.maxDurationSec) return this.gameOver('waktu');
        this.tickAcc += dt;
        if (this.tickAcc > 0.25) {
          this.tickAcc = 0;
          this.hooks.onTick && this.hooks.onTick({ lives: this.lives, score: this.score, distance: this.meters });
        }
      } else this.dist += this.speed * dt;
      this.updateWorld(dt, true);
      this.updatePlayer(dt);
      this.collide();
    }

    autopilot() {
      const ph = this.cfg.playerSize;
      const next = this.obs.find((o) => o.x + o.w > PLAYER_X - 20);
      this.keys.down = false;
      if (!next) return;
      const d = next.x - (PLAYER_X + ph * 0.35);
      if (next.fly) { if (d < this.speed * 0.25) this.keys.down = true; }
      else if (d < this.speed * this.airTime * 0.42 - next.w * 0.3 && d > 0 && this.p.grounded) this.p.jumpBuf = this.time;
    }

    updateWorld(dt, spawn) {
      const move = this.speed * dt;
      this.camX += move;
      for (const o of this.obs) { o.x -= move; o.t += dt; }
      for (const it of this.items) { it.x -= move; it.t += dt; }
      this.obs = this.obs.filter((o) => o.x + o.w > -200);
      this.items = this.items.filter((i) => i.x > -200 && !i.taken);
      for (const pt of this.parts) { pt.x += (pt.vx - (pt.ground ? this.speed : 0)) * dt; pt.y += pt.vy * dt; pt.vy += (pt.g ?? 900) * dt; pt.life -= dt; }
      this.parts = this.parts.filter((p) => p.life > 0);
      for (const pp of this.popups) { pp.y -= 60 * dt; pp.life -= dt; pp.x -= move * 0.5; }
      this.popups = this.popups.filter((p) => p.life > 0);
      this.shake = Math.max(0, this.shake - dt * 30);
      this.flash = Math.max(0, this.flash - dt * 2.5);
      if (!spawn) return;
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) this.spawn();
    }

    spawn() {
      const c = this.cfg, ph = c.playerSize;
      const meters = this.dist / c.pxPerMeter;
      // Jeda minimum supaya rintangan selalu bisa dilewati
      const fairMin = this.airTime * 0.85 + 0.12;
      let gap = rand(c.obsMinGap, c.obsMaxGap);
      gap = Math.max(gap, fairMin);
      this.spawnIn = gap;
      const x = this.viewW + 80;
      const canFly = meters >= c.flyingStartM && c.flyingChance > 0;
      const maxH = Math.min(150, c.jumpHeight * 0.55);
      let o;
      if (canFly && Math.random() * 100 < c.flyingChance) {
        const kind = Math.random() < 0.5 ? 'drone' : 'splat';
        o = { fly: true, kind, x, w: 120, h: 70, y: ph * 0.6 + 6 };
      } else {
        const kinds = [
          { kind: 'cone', w: 70, h: 100 },
          { kind: 'bucket', w: 92, h: 82 },
          { kind: 'tires', w: 96, h: 120 },
          { kind: 'barrier', w: 150, h: 78 },
        ];
        const k = kinds[Math.floor(Math.random() * kinds.length)];
        o = { fly: false, kind: k.kind, x, w: k.w, h: Math.min(k.h, maxH), y: 0 };
        if (Math.random() * 100 < c.doubleObsChance && k.kind !== 'barrier') o.double = true, o.w = k.w * 2 + 6;
      }
      o.t = 0;
      this.obs.push(o);

      // Bintang bonus
      if (Math.random() * 100 < c.coinChance) {
        if (o.fly) {
          for (let i = 0; i < 3; i++) this.items.push({ type: 'coin', x: x + 10 + i * 55, y: 40, t: i });
        } else if (Math.random() < 0.6) {
          // busur di atas rintangan (dapat kalau melompat)
          const span = this.speed * this.airTime * 0.7;
          for (let i = 0; i < 5; i++) {
            const f = i / 4;
            this.items.push({ type: 'coin', x: x + o.w / 2 - span / 2 + f * span, y: o.h + 40 + Math.sin(f * Math.PI) * (c.jumpHeight - o.h - 40) * 0.8, t: i });
          }
        } else {
          const gx = x + o.w + (gap * this.speed) / 2 - 60;
          for (let i = 0; i < 3; i++) this.items.push({ type: 'coin', x: gx + i * 55, y: 50, t: i });
        }
      }
      // Hati tambahan
      if (this.mode === 'playing' && this.lives < c.maxLives && Math.random() * 100 < c.heartChance) {
        this.items.push({ type: 'heart', x: x + o.w + (gap * this.speed) / 2, y: Math.min(c.jumpHeight * 0.7, 200), t: 0 });
      }
    }

    updatePlayer(dt) {
      const c = this.cfg, p = this.p;
      const ducking = this.keys.down && p.grounded && this.mode !== 'over';
      p.duck += ((ducking ? 1 : 0) - p.duck) * Math.min(1, dt * 22);
      const wantJump = p.jumpBuf >= 0 && this.time - p.jumpBuf < 0.14 && this.mode !== 'over' && this.mode !== 'countdown';
      if (wantJump) {
        const coyote = this.time - p.lastGround < 0.08;
        if (p.grounded || coyote) {
          p.vy = this.jumpV; p.grounded = false; p.usedDouble = false; p.jumpBuf = -1; p.squash = -0.25;
          Sfx.jump(); this.spray(8);
        } else if (c.doubleJump && !p.usedDouble) {
          p.vy = this.jumpV * 0.85; p.usedDouble = true; p.jumpBuf = -1; Sfx.jump(); this.spray(10);
        }
      }
      if (!p.grounded) {
        let g = c.gravity;
        if (this.keys.down) g *= 2.6; // tekan DOWN di udara = turun cepat
        p.vy -= g * dt;
        p.y += p.vy * dt;
        p.rot = clamp(-p.vy / 3000, -0.35, 0.35);
        if (p.y <= 0) {
          p.y = 0; p.vy = 0; p.grounded = true; p.squash = 0.3; p.lastGround = this.time;
          this.dust(6);
        }
      } else {
        p.lastGround = this.time;
        p.rot *= 0.8;
        if (this.mode === 'playing' && Math.random() < dt * 14) this.dust(1);
      }
      p.squash *= Math.pow(0.0005, dt);
    }

    playerBox() {
      const c = this.cfg, p = this.p;
      const h = c.playerSize * (1 - 0.5 * p.duck);
      const w = this.spriteW(c.playerSize) * (1 + 0.25 * p.duck);
      const shrink = 0.14;
      return { x: PLAYER_X - w / 2 + w * shrink, w: w * (1 - 2 * shrink), y: p.y + h * 0.04, h: h * (1 - shrink) };
    }

    spriteW(h) {
      const im = this.sprite && loadImg(this.sprite.src);
      const ar = im && im.naturalWidth ? im.naturalWidth / im.naturalHeight : 0.4;
      return h * ar;
    }

    collide() {
      const b = this.playerBox();
      const hitBox = (o, pad = 0.12) => {
        const ox = o.x + o.w * pad, ow = o.w * (1 - 2 * pad), oy = o.y + o.h * 0.05, oh = o.h * 0.88;
        return b.x < ox + ow && b.x + b.w > ox && b.y < oy + oh && b.y + b.h > oy;
      };
      for (const it of this.items) {
        if (it.taken) continue;
        const s = it.type === 'heart' ? 60 : 50;
        if (b.x < it.x + s / 2 && b.x + b.w > it.x - s / 2 && b.y < it.y + s && b.y + b.h > it.y) {
          it.taken = true;
          if (it.type === 'coin') {
            if (this.mode === 'playing') this.coins++;
            Sfx.coin();
            if (this.mode === 'playing' && this.cfg.coinPoints) this.popups.push({ x: it.x, y: it.y + 40, text: '+' + this.cfg.coinPoints, life: 0.8, color: this.branding.accentColor });
          } else if (this.mode === 'playing') {
            this.lives = Math.min(this.cfg.maxLives, this.lives + 1);
            Sfx.heart();
            this.popups.push({ x: it.x, y: it.y + 50, text: '+1 ❤', life: 1, color: '#ff4d6d' });
          }
        }
      }
      if (this.mode !== 'playing') return;
      if (this.time < this.invUntil) return;
      for (const o of this.obs) {
        if (o.hit) continue;
        if (hitBox(o)) {
          o.hit = true;
          this.lives--;
          this.invUntil = this.time + this.cfg.invincibleSec;
          this.shake = 14; this.flash = 1;
          Sfx.hit();
          this.burst(o);
          this.hooks.onHit && this.hooks.onHit({ lives: this.lives });
          this.hooks.onTick && this.hooks.onTick({ lives: this.lives, score: this.score, distance: this.meters });
          if (this.lives <= 0) return this.gameOver('nyawa');
          break;
        }
      }
    }

    gameOver(reason) {
      if (this.mode === 'over') return;
      this.mode = 'over';
      Sfx.over();
      const res = { score: this.score, distance: this.meters, coins: this.coins, durationMs: Math.round(this.elapsed * 1000), reason };
      this.finalResult = res;
      this.hooks.onOver && this.hooks.onOver(res);
    }

    dust(n) {
      for (let i = 0; i < n; i++) this.parts.push({ x: PLAYER_X - 20 + rand(-20, 20), y: rand(0, 10), vx: rand(-120, 40), vy: rand(60, 200), g: -50, life: rand(0.3, 0.6), r: rand(5, 11), color: 'rgba(210,200,180,.7)', ground: false });
    }
    spray(n) {
      const cols = [this.branding.primaryColor, this.branding.accentColor, '#2f80ed', '#27ae60'];
      for (let i = 0; i < n; i++) this.parts.push({ x: PLAYER_X - 25, y: this.p.y + rand(10, 60), vx: rand(-500, -200), vy: rand(-150, 150), g: 600, life: rand(0.4, 0.8), r: rand(4, 9), color: cols[i % cols.length] });
    }
    burst(o) {
      for (let i = 0; i < 18; i++) this.parts.push({ x: o.x + o.w / 2, y: o.y + o.h / 2, vx: rand(-400, 400), vy: rand(100, 600), g: 1500, life: rand(0.5, 1), r: rand(4, 10), color: i % 2 ? '#ffcf3a' : '#ff5a36' });
    }

    // ---------- Gambar ----------
    render(now) {
      const ctx = this.ctx, s = this.scale;
      const th = THEMES[this.branding.theme] || THEMES.siang;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      const sx = this.shake ? rand(-this.shake, this.shake) : 0, sy = this.shake ? rand(-this.shake, this.shake) : 0;
      ctx.translate(sx, sy);
      const VW = this.viewW;

      // langit
      const g = ctx.createLinearGradient(0, 0, 0, GROUND);
      g.addColorStop(0, th.sky[0]); g.addColorStop(0.6, th.sky[1]); g.addColorStop(1, th.sky[2]);
      ctx.fillStyle = g; ctx.fillRect(-20, -20, VW + 40, GROUND + 40);
      if (this.branding.theme === 'malam') {
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 90; i++) {
          const x = (hash(i) * VW * 1.2 - this.camX * 0.01) % (VW * 1.2);
          ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(now / 900 + i));
          ctx.fillRect((x + VW * 1.2) % (VW * 1.2), hash(i + 99) * 520, 3, 3);
        }
        ctx.globalAlpha = 1;
      }
      // matahari / bulan
      ctx.fillStyle = th.sun;
      ctx.shadowColor = th.sun; ctx.shadowBlur = 60;
      ctx.beginPath(); ctx.arc(VW - 330, 200, 85, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      // awan
      ctx.fillStyle = th.cloud;
      for (let i = 0; i < 7; i++) {
        const span = VW + 600;
        const x = ((hash(i + 5) * span - this.camX * 0.06) % span + span) % span - 300;
        const y = 90 + hash(i + 17) * 260, k = 0.6 + hash(i + 33) * 0.8;
        this.cloud(ctx, x, y, k);
      }

      // gedung jauh & dekat
      this.skyline(ctx, 0.15, th.far, 260, 520, 1, th);
      this.skyline(ctx, 0.35, th.mid, 160, 380, 2, th);
      if (this.branding.showBillboards !== false) this.billboards(ctx, th);

      // tanah
      ctx.fillStyle = th.grass; ctx.fillRect(-20, GROUND, VW + 40, 26);
      ctx.fillStyle = th.grassDark; ctx.fillRect(-20, GROUND + 22, VW + 40, 8);
      ctx.fillStyle = th.road; ctx.fillRect(-20, GROUND + 30, VW + 40, H - GROUND);
      ctx.fillStyle = th.line;
      const dash = 160, off = this.camX % dash;
      for (let x = -off; x < VW + dash; x += dash) ctx.fillRect(x, GROUND + 112, 80, 12);
      // garis tepi jalan warna brand
      ctx.fillStyle = this.branding.primaryColor; ctx.fillRect(-20, GROUND + 30, VW + 40, 6);

      // benda
      for (const it of this.items) this.drawItem(ctx, it, now);
      for (const o of this.obs) this.drawObstacle(ctx, o, now);
      for (const pt of this.parts) {
        ctx.globalAlpha = clamp(pt.life * 2, 0, 1);
        ctx.fillStyle = pt.color;
        ctx.beginPath(); ctx.arc(pt.x, GROUND - pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.drawPlayer(ctx, now);
      for (const pp of this.popups) {
        ctx.globalAlpha = clamp(pp.life * 2, 0, 1);
        ctx.font = '900 44px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.strokeText(pp.text, pp.x, GROUND - pp.y);
        ctx.fillStyle = pp.color; ctx.fillText(pp.text, pp.x, GROUND - pp.y);
      }
      ctx.globalAlpha = 1;

      ctx.setTransform(s, 0, 0, s, 0, 0);
      if (this.flash) { ctx.fillStyle = `rgba(255,40,40,${this.flash * 0.35})`; ctx.fillRect(0, 0, VW, H); }
      if (this.mode !== 'idle') this.hud(ctx, now);
      if (this.mode === 'countdown') this.countdown(ctx, now);
    }

    cloud(ctx, x, y, k) {
      for (const [dx, dy, rx, ry] of [[0, 0, 90, 34], [60, -18, 60, 40], [-55, -8, 50, 30], [10, -34, 48, 34]]) {
        ctx.beginPath(); ctx.ellipse(x + dx * k, y + dy * k, rx * k, ry * k, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    skyline(ctx, par, color, minH, maxH, seed, th) {
      const bw = 150, off = this.camX * par;
      const first = Math.floor(off / bw) - 1;
      for (let i = first; i < first + Math.ceil(this.viewW / bw) + 3; i++) {
        const h = minH + hash(i * 7 + seed * 1000) * (maxH - minH);
        const w = bw * (0.7 + hash(i * 3 + seed) * 0.35);
        const x = i * bw - off;
        ctx.fillStyle = color;
        ctx.fillRect(x, GROUND - h, w, h);
        if (seed === 2) {
          ctx.fillStyle = th.win;
          for (let wy = GROUND - h + 24; wy < GROUND - 30; wy += 46) {
            for (let wx = x + 16; wx < x + w - 26; wx += 36) if (hash(wx * 0.37 + wy) > 0.45) ctx.fillRect(wx, wy, 16, 22);
          }
        }
      }
    }

    billboards(ctx, th) {
      const gapB = 2400, par = 0.55, off = this.camX * par;
      const first = Math.floor(off / gapB) - 1;
      for (let i = first; i < first + 3; i++) {
        const x = i * gapB - off + 600;
        if (x > this.viewW + 50 || x < -700) continue;
        const bw = 620, bh = 230, by = GROUND - 420;
        ctx.fillStyle = '#555c66';
        ctx.fillRect(x + 140, by + bh, 22, 420 - bh); ctx.fillRect(x + bw - 162, by + bh, 22, 420 - bh);
        ctx.fillStyle = '#2b2f36'; ctx.fillRect(x - 10, by - 10, bw + 20, bh + 20);
        const gg = ctx.createLinearGradient(x, by, x + bw, by + bh);
        gg.addColorStop(0, this.branding.primaryColor); gg.addColorStop(1, shade(this.branding.primaryColor, -0.35));
        ctx.fillStyle = gg; ctx.fillRect(x, by, bw, bh);
        const logo = this.branding.logo && loadImg(this.branding.logo);
        const sp = (this.branding.sprites || [])[((i % 2) + 2) % 2] || (this.branding.sprites || [])[0];
        const im = sp && loadImg(sp.src);
        let tx = x + 30;
        if (im && im.complete && im.naturalWidth) {
          const h = bh - 30, w = h * im.naturalWidth / im.naturalHeight;
          ctx.drawImage(im, x + bw - w - 20, by + 15, w, h);
        }
        if (logo && logo.complete && logo.naturalWidth) {
          const h = 70, w = h * logo.naturalWidth / logo.naturalHeight;
          ctx.drawImage(logo, tx, by + 24, w, h);
        }
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
        ctx.font = '900 64px system-ui, sans-serif';
        fitText(ctx, this.branding.title || '', tx, by + (logo ? 160 : 120), bw - 230);
        ctx.fillStyle = this.branding.accentColor; ctx.font = '700 30px system-ui, sans-serif';
        fitText(ctx, this.branding.footer || '', tx, by + (logo ? 205 : 175), bw - 230);
      }
    }

    drawObstacle(ctx, o, now) {
      const x = o.x, base = GROUND - o.y;
      ctx.save();
      if (o.hit) ctx.globalAlpha = 0.45;
      if (o.fly) {
        const bob = Math.sin(o.t * 6) * 8;
        const y = base - o.h + bob;
        if (o.kind === 'drone') {
          ctx.fillStyle = '#ffd23f'; roundRect(ctx, x + 20, y + 25, o.w - 40, 34, 12); ctx.fill();
          ctx.lineWidth = 4; ctx.strokeStyle = '#1b1d26'; ctx.stroke();
          ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(x + o.w / 2, y + 42, 8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#596075'; ctx.fillRect(x + 8, y + 18, o.w - 16, 8);
          ctx.fillStyle = 'rgba(220,230,255,.85)';
          const sp = Math.abs(Math.sin(now / 30)) * 34 + 8;
          ctx.fillRect(x + 22 - sp / 2, y + 8, sp, 6); ctx.fillRect(x + o.w - 22 - sp / 2, y + 8, sp, 6);
          ctx.fillStyle = '#596075'; ctx.fillRect(x + 20, y + 10, 4, 12); ctx.fillRect(x + o.w - 24, y + 10, 4, 12);
        } else {
          // gumpalan cat terbang
          ctx.fillStyle = '#7b2ff7';
          ctx.beginPath();
          const cx = x + o.w / 2, cy = y + o.h / 2;
          for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 8) {
            const r = (a / (Math.PI / 8)) % 2 ? 26 : 40 + Math.sin(o.t * 8 + a) * 4;
            ctx.lineTo(cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r);
          }
          ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - 18, cy - 6, 10, 0, 7); ctx.arc(cx + 18, cy - 6, 10, 0, 7); ctx.fill();
          ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx - 20, cy - 4, 5, 0, 7); ctx.arc(cx + 16, cy - 4, 5, 0, 7); ctx.fill();
          // jejak tetesan
          ctx.fillStyle = 'rgba(123,47,247,.5)';
          for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.arc(cx + 50 + i * 26, cy + Math.sin(o.t * 5 + i) * 10, 9 - i * 2, 0, 7); ctx.fill(); }
        }
      } else {
        const n = o.double ? 2 : 1, uw = o.double ? (o.w - 6) / 2 : o.w;
        for (let i = 0; i < n; i++) this.groundThing(ctx, o.kind, x + i * (uw + 6), base, uw, o.h);
      }
      ctx.restore();
    }

    groundThing(ctx, kind, x, base, w, h) {
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.ellipse(x + w / 2, base + 4, w * 0.6, 9, 0, 0, Math.PI * 2); ctx.fill();
      if (kind === 'cone') {
        ctx.fillStyle = '#ff6a00';
        ctx.beginPath(); ctx.moveTo(x + w * 0.38, base - h); ctx.lineTo(x + w * 0.62, base - h); ctx.lineTo(x + w * 0.9, base - 12); ctx.lineTo(x + w * 0.1, base - 12); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(x + w * 0.27, base - h * 0.62, w * 0.46, h * 0.13); ctx.fillRect(x + w * 0.19, base - h * 0.36, w * 0.62, h * 0.12);
        ctx.fillStyle = '#e05500'; ctx.fillRect(x, base - 14, w, 14);
      } else if (kind === 'bucket') {
        ctx.fillStyle = '#e8e8ea';
        ctx.beginPath(); ctx.moveTo(x + 4, base - h); ctx.lineTo(x + w - 4, base - h); ctx.lineTo(x + w - 12, base); ctx.lineTo(x + 12, base); ctx.fill();
        ctx.fillStyle = '#2f80ed'; ctx.fillRect(x + 8, base - h * 0.62, w - 18, h * 0.3);
        ctx.fillStyle = '#2f80ed';
        ctx.beginPath(); ctx.ellipse(x + w / 2, base - h, w / 2 - 4, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x + 14, base - h, 10, 26); ctx.beginPath(); ctx.arc(x + 19, base - h + 26, 5, 0, 7); ctx.fill();
        ctx.strokeStyle = '#777'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x + w / 2, base - h, w / 2 - 6, Math.PI, 0); ctx.stroke();
      } else if (kind === 'tires') {
        const rows = 3, rh = h / rows;
        for (let r = 0; r < rows; r++) {
          const y = base - (r + 1) * rh;
          ctx.fillStyle = '#1e1e22'; roundRect(ctx, x, y, w, rh - 2, rh / 2.4); ctx.fill();
          ctx.fillStyle = '#3a3a40'; roundRect(ctx, x + 10, y + rh * 0.3, w - 20, rh * 0.3, 6); ctx.fill();
        }
      } else {
        // pembatas jalan
        ctx.fillStyle = '#cfd3da'; ctx.fillRect(x + 12, base - h * 0.5, 12, h * 0.5); ctx.fillRect(x + w - 24, base - h * 0.5, 12, h * 0.5);
        ctx.fillStyle = '#fff'; roundRect(ctx, x, base - h, w, h * 0.55, 6); ctx.fill();
        ctx.save(); ctx.beginPath(); roundRect(ctx, x, base - h, w, h * 0.55, 6); ctx.clip();
        ctx.fillStyle = '#e8262e';
        for (let i = -2; i < 8; i++) { ctx.beginPath(); ctx.moveTo(x + i * 36, base - h); ctx.lineTo(x + i * 36 + 18, base - h); ctx.lineTo(x + i * 36 + 18 + 40, base - h + h * 0.55); ctx.lineTo(x + i * 36 + 40, base - h + h * 0.55); ctx.fill(); }
        ctx.restore();
      }
    }

    drawItem(ctx, it, now) {
      const x = it.x, y = GROUND - it.y;
      if (it.type === 'coin') {
        const k = Math.abs(Math.cos(now / 220 + it.t));
        ctx.fillStyle = '#ffbf00';
        ctx.save(); ctx.translate(x, y - 25); ctx.scale(0.35 + 0.65 * k, 1);
        star(ctx, 0, 0, 26, 12); ctx.fill();
        ctx.fillStyle = '#fff3a6'; star(ctx, -3, -3, 12, 6); ctx.fill();
        ctx.restore();
      } else {
        const sc = 1 + Math.sin(now / 160) * 0.08;
        ctx.save(); ctx.translate(x, y - 30); ctx.scale(sc, sc);
        ctx.shadowColor = '#ff4d6d'; ctx.shadowBlur = 25;
        heart(ctx, 0, 0, 30, '#ff2e55');
        ctx.restore();
      }
    }

    drawPlayer(ctx, now) {
      const c = this.cfg, p = this.p;
      const im = this.sprite && loadImg(this.sprite.src);
      const baseH = c.playerSize;
      const h = baseH * (1 - 0.5 * p.duck) * (1 - p.squash * 0.5);
      const w = this.spriteW(baseH) * (1 + 0.25 * p.duck) * (1 + p.squash * 0.35);
      const bob = p.grounded && this.mode !== 'over' && this.mode !== 'countdown' ? Math.abs(Math.sin(this.dist / 55)) * 7 : 0;
      const yb = GROUND - p.y - bob;
      // bayangan
      const sh = clamp(1 - p.y / 500, 0.3, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.28 * sh})`;
      ctx.beginPath(); ctx.ellipse(PLAYER_X, GROUND + 6, w * 0.7 * sh, 12 * sh, 0, 0, Math.PI * 2); ctx.fill();
      if (this.mode === 'playing' && this.time < this.invUntil && Math.floor(now / 90) % 2) ctx.globalAlpha = 0.3;
      ctx.save();
      ctx.translate(PLAYER_X, yb - h / 2);
      ctx.rotate(p.rot + (p.grounded ? Math.sin(this.dist / 55) * 0.04 : 0));
      if (im && im.complete && im.naturalWidth) ctx.drawImage(im, -w / 2, -h / 2, w, h);
      else { ctx.fillStyle = this.branding.primaryColor; roundRect(ctx, -w / 2, -h / 2, w, h, 14); ctx.fill(); }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    hud(ctx, now) {
      const c = this.cfg;
      // nyawa
      const maxShown = Math.max(c.lives, this.lives);
      for (let i = 0; i < maxShown; i++) {
        const full = i < this.lives;
        heart(ctx, 70 + i * 74, 70, 28, full ? '#ff2e55' : 'rgba(0,0,0,.35)', full ? '#fff' : 'rgba(255,255,255,.6)');
      }
      ctx.textAlign = 'left';
      ctx.font = '800 40px system-ui, sans-serif';
      outlined(ctx, this.playerName || '', 40, 165, '#fff');
      // skor
      ctx.textAlign = 'right';
      ctx.font = '900 96px system-ui, sans-serif';
      outlined(ctx, String(this.mode === 'over' && this.finalResult ? this.finalResult.score : this.score), this.viewW - 40, 105, this.branding.accentColor);
      ctx.font = '700 36px system-ui, sans-serif';
      let line = `${this.meters} m  ·  ★ ${this.coins}`;
      if (c.maxDurationSec > 0) line += `  ·  ⏱ ${Math.max(0, Math.ceil(c.maxDurationSec - this.elapsed))}s`;
      outlined(ctx, line, this.viewW - 40, 155, '#fff');
    }

    countdown(ctx, now) {
      const left = this.cfg.countdownSec - (now - this.countStart) / 1000;
      const n = Math.ceil(left);
      const f = left - Math.floor(left);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, this.viewW, H);
      ctx.save();
      ctx.translate(this.viewW / 2, H / 2 - 40);
      const k = 1 + f * 0.6;
      ctx.scale(k, k);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '900 260px system-ui, sans-serif';
      outlined(ctx, n > 0 ? String(n) : 'GO!', 0, 0, this.branding.accentColor, 18);
      ctx.restore();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = '700 46px system-ui, sans-serif';
      outlined(ctx, '▲ UP = Lompat     ▼ DOWN = Merunduk', this.viewW / 2, H - 260, '#fff');
    }
  }

  // ---------- helper gambar ----------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function star(ctx, x, y, R, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath();
  }
  function heart(ctx, x, y, s, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.8, y - s * 1.3, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.8, y - s * 1.3, x + s * 1.6, y - s * 0.1, x, y + s * 0.9);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.lineWidth = 4; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function outlined(ctx, text, x, y, color, lw = 10) {
    ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function fitText(ctx, text, x, y, maxW) {
    let size = parseInt(ctx.font.match(/(\d+)px/)[1], 10);
    while (ctx.measureText(text).width > maxW && size > 14) { size -= 2; ctx.font = ctx.font.replace(/\d+px/, size + 'px'); }
    ctx.fillText(text, x, y);
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt)), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  window.RunnerGame = RunnerGame;
  window.RunnerSfx = Sfx;
  window.drawHeart = heart;
})();
