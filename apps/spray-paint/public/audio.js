// Ichiban Spray Paint - mesin suara (Web Audio API). Dipakai di layar TV dan HP.
// Semua suara bawaan dibuat sendiri (bebas royalti) dan disimpan offline di /sfx.
(function () {
  const FILES = {
    sprayLoop: 'sfx/spray-loop.wav', sprayStart: 'sfx/spray-start.mp3', rattle: 'sfx/rattle.mp3',
    beep: 'sfx/beep.mp3', go: 'sfx/go.mp3', tick: 'sfx/tick.mp3', drip: 'sfx/drip.mp3', warn: 'sfx/warn.mp3',
    join: 'sfx/join.mp3', finish: 'sfx/finish.mp3', count: 'sfx/count.mp3', win: 'sfx/win.mp3', good: 'sfx/good.mp3',
    musicIdle: 'sfx/music-idle.wav', musicPlay: 'sfx/music-play.wav',
  };
  const t0 = performance.now();
  const log = (window.__audioLog = []); // dipakai untuk membuat video demo (catatan waktu suara)

  class SprayAudio {
    constructor(opts = {}) {
      this.only = opts.only || null; // daftar nama suara yang dimuat (HP hanya perlu semprot)
      this.ctx = null; this.buf = {}; this.loading = null;
      this.cfg = { musicOn: true, musicVolume: 55, sfxOn: true, sfxVolume: 85, music: '' };
      this.music = { name: null, src: null, gain: null };
      this.spray = null; this.unlocked = false; this.customMusic = null; this.customMusicSrc = '';
    }
    ensureCtx() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
        this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
        this.applyVolumes();
      }
      return this.ctx;
    }
    // Browser hanya mengizinkan suara setelah ada klik/sentuhan pertama
    unlock() {
      const ctx = this.ensureCtx(); if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!this.unlocked) {
        this.unlocked = true;
        const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
      }
      this.load();
      if (this.pendingMusic) { const m = this.pendingMusic; this.pendingMusic = null; this.playMusic(m); }
    }
    get ready() { return this.ctx && this.ctx.state === 'running'; }
    load() {
      if (this.loading) return this.loading;
      const ctx = this.ensureCtx(); if (!ctx) return Promise.resolve();
      const names = Object.keys(FILES).filter((n) => !this.only || this.only.includes(n));
      this.loading = Promise.all(names.map((n) => fetch(FILES[n]).then((r) => r.arrayBuffer())
        .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
        .then((b) => { this.buf[n] = b; }).catch(() => {})));
      return this.loading;
    }
    setConfig(c) {
      if (!c) return;
      Object.assign(this.cfg, c);
      this.applyVolumes();
      if (this.music.name && !this.cfg.musicOn) this.stopMusic();
      if (this.cfg.music !== this.customMusicSrc) { this.customMusicSrc = this.cfg.music; this.customMusic = null; this.loadCustomMusic(); }
    }
    loadCustomMusic() {
      const src = this.customMusicSrc; if (!src || !this.ensureCtx()) return;
      fetch(src).then((r) => r.arrayBuffer()).then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
        .then((b) => { if (this.customMusicSrc === src) { this.customMusic = b; if (this.music.name) { const n = this.music.name; this.stopMusic(0); this.playMusic(n); } } }).catch(() => {});
    }
    applyVolumes() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      this.sfxBus.gain.setTargetAtTime(this.cfg.sfxOn ? this.cfg.sfxVolume / 100 : 0, now, 0.05);
      this.musicBus.gain.setTargetAtTime(this.cfg.musicOn ? (this.cfg.musicVolume / 100) * 0.7 : 0, now, 0.1);
    }
    play(name, { vol = 1, rate = 1 } = {}) {
      log.push({ t: performance.now() - t0, name, vol: vol * (this.cfg.sfxOn ? this.cfg.sfxVolume / 100 : 0) });
      const b = this.buf[name]; if (!b || !this.ready) return;
      const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
      const g = this.ctx.createGain(); g.gain.value = vol;
      s.connect(g); g.connect(this.sfxBus); s.start();
    }
    // Desis semprotan: loop yang dinyalakan/dimatikan dengan fade halus
    sprayOn(on, vol = 0.8) {
      if (!!this.spray === on) return;
      log.push({ t: performance.now() - t0, name: on ? 'sprayOn' : 'sprayOff', vol: vol * (this.cfg.sfxOn ? this.cfg.sfxVolume / 100 : 0) });
      if (!this.ready || !this.buf.sprayLoop) { this.spray = on ? {} : null; return; }
      const now = this.ctx.currentTime;
      if (on) {
        this.play('sprayStart', { vol: 0.6 });
        const s = this.ctx.createBufferSource(); s.buffer = this.buf.sprayLoop; s.loop = true;
        const g = this.ctx.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(vol, now + 0.05);
        s.connect(g); g.connect(this.sfxBus); s.start(now, Math.random() * 1.5);
        this.spray = { s, g };
      } else {
        const { s, g } = this.spray; this.spray = null;
        if (s && g) { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + 0.08); s.stop(now + 0.1); }
      }
    }
    playMusic(name, { rate = 1 } = {}) {
      if (!this.cfg.musicOn) return;
      if (!this.ready) { this.pendingMusic = name; return; }
      if (this.music.name === name) { if (this.music.src) this.music.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.3); return; }
      const b = this.customMusic || this.buf[name];
      if (!b) { this.load().then(() => this.buf[name] && this.music.name !== name && this.playMusic(name, { rate })); return; }
      this.stopMusic(0.6);
      log.push({ t: performance.now() - t0, name: 'music:' + name, vol: this.cfg.musicOn ? this.cfg.musicVolume / 100 : 0 });
      const now = this.ctx.currentTime;
      const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate;
      const g = this.ctx.createGain();
      const level = this.customMusic && name === 'musicIdle' ? 0.6 : 1; // musik custom lebih pelan saat menunggu
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(level, now + 0.8);
      s.connect(g); g.connect(this.musicBus); s.start(now);
      this.music = { name, src: s, gain: g };
    }
    stopMusic(fade = 0.5) {
      if (!this.music.src) { this.music.name = null; this.pendingMusic = null; return; }
      log.push({ t: performance.now() - t0, name: 'music:stop' });
      const { src, gain } = this.music; const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(0, now + fade);
      src.stop(now + fade + 0.05);
      this.music = { name: null, src: null, gain: null };
    }
    duck(on) { // kecilkan musik sebentar (misal saat hasil diumumkan)
      if (!this.music.gain) return;
      this.music.gain.gain.setTargetAtTime(on ? 0.35 : 1, this.ctx.currentTime, 0.2);
    }
  }
  window.SprayAudio = SprayAudio;
})();
