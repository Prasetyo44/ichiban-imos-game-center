// Ichiban Drag Race - modul bersama TV & HP: sinkronisasi jam dan mesin suara.
(function () {
  // ---------- Sinkronisasi jam dengan server ----------
  // Beberapa kali ping, ambil sampel dengan waktu bolak-balik tercepat.
  class Clock {
    constructor(socket) {
      this.socket = socket; this.offset = 0; this.rtt = 999; this.samples = [];
      socket.on('connect', () => this.burst());
      setInterval(() => this.burst(3), 15000);
    }
    burst(n = 8) {
      let i = 0;
      const one = () => {
        const t0 = Date.now();
        this.socket.timeout(3000).emit('sync', 0, (err, srv) => {
          if (!err && typeof srv === 'number') {
            const t1 = Date.now(), rtt = t1 - t0;
            this.samples.push({ rtt, off: srv - (t0 + t1) / 2 });
            this.samples = this.samples.sort((a, b) => a.rtt - b.rtt).slice(0, 6);
            this.offset = this.samples[0].off; this.rtt = this.samples[0].rtt;
          }
          if (++i < n) setTimeout(one, 60);
        });
      };
      one();
    }
    now() { return Date.now() + this.offset; }
  }

  // ---------- Suara ----------
  // Suara mesin, lampu start, oper gigi dibuat langsung (WebAudio) sehingga 100% offline.
  // Musik, sorakan penonton, fanfare dari file mp3 bawaan di /sfx.
  class DragAudio {
    constructor() {
      this.ctx = null; this.enabled = true; this.buffers = {}; this.engines = []; this.vol = {};
      this.musicSrc = null; this.crowdSrc = null; this.musicUrl = null; this.wantMusic = false; this.duck = 1;
    }
    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          this.ctx = new AC();
          const c = this.ctx;
          this.master = c.createGain();
          const comp = c.createDynamicsCompressor();
          comp.threshold.value = -12; comp.ratio.value = 4;
          this.master.connect(comp); comp.connect(c.destination); this.comp = comp;
          for (const b of ['music', 'engine', 'sfx', 'crowd']) { this[b] = c.createGain(); this[b].connect(this.master); }
          this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
          const d = this.noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          this.applyVolumes();
          this.load('cheer', 'sfx/cheer.mp3'); this.load('win', 'sfx/win.mp3'); this.load('lose', 'sfx/lose.mp3'); this.load('crowd', 'sfx/crowd.mp3');
          if (this.musicUrl) this.load('music', this.musicUrl).then(() => this.wantMusic && this.playMusic());
        }
        if (this.ctx.state !== 'running') this.ctx.resume();
      } catch (e) { console.warn('audio', e); }
      return this.ctx;
    }
    startRec() {
      const dest = this.ctx.createMediaStreamDestination();
      this.comp.connect(dest);
      const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data); rec.start(500);
      const t0 = Date.now();
      window.__stopRec = () => new Promise((res) => { rec.onstop = async () => { const b = new Blob(chunks); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); res({ t0, data: btoa(s) }); }; rec.stop(); });
      return t0;
    }
    get ready() { return !!this.ctx && this.ctx.state === 'running'; }
    async load(name, url) {
      try {
        const r = await fetch(url);
        const ab = await r.arrayBuffer();
        this.buffers[name] = await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
      } catch (e) { console.warn('gagal memuat suara', url, e); }
    }
    configure(b, phone = false) {
      this.enabled = phone ? b.sound !== false && b.phoneSound !== false : b.sound !== false;
      const k = (v, d) => (v === undefined ? d : v) / 100;
      this.vol = phone
        ? { master: k(b.volPhone, 70), music: 0, engine: k(b.volEngine, 80), sfx: k(b.volSfx, 85), crowd: 0 }
        : { master: k(b.volMaster, 85), music: b.musicOn === false ? 0 : k(b.volMusic, 45), engine: k(b.volEngine, 80), sfx: k(b.volSfx, 85), crowd: k(b.volCrowd, 60) };
      if (!phone && b.music && b.music !== this.musicUrl) {
        this.musicUrl = b.music;
        if (this.ctx) { this.stopMusic(); this.load('music', b.music).then(() => this.wantMusic && this.playMusic()); }
      }
      this.applyVolumes();
    }
    applyVolumes() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, v = this.vol, on = this.enabled ? 1 : 0;
      this.master.gain.setTargetAtTime((v.master ?? 0.8) * on, t, 0.05);
      this.music.gain.setTargetAtTime((v.music ?? 0.4) * this.duck, t, 0.4);
      this.engine.gain.setTargetAtTime(v.engine ?? 0.8, t, 0.05);
      this.sfx.gain.setTargetAtTime(v.sfx ?? 0.8, t, 0.05);
      this.crowd.gain.setTargetAtTime(v.crowd ?? 0.6, t, 0.3);
    }
    setDuck(d) { this.duck = d; this.applyVolumes(); }

    playLoop(name, bus) {
      const buf = this.buffers[name];
      if (!this.ctx || !buf) return null;
      const s = this.ctx.createBufferSource();
      s.buffer = buf; s.loop = true;
      // lewati jeda pendek di awal file mp3 supaya loop mulus
      s.loopStart = 0.05; s.loopEnd = buf.duration - 0.03;
      s.connect(bus); s.start(0, 0.05);
      return s;
    }
    playMusic() {
      this.wantMusic = true;
      if (!this.ctx || this.musicSrc) return;
      this.musicSrc = this.playLoop('music', this.music);
    }
    stopMusic() { this.wantMusic = false; try { this.musicSrc && this.musicSrc.stop(); } catch {} this.musicSrc = null; }
    crowdOn(level = 1) {
      if (!this.ctx) return;
      if (!this.crowdSrc && this.buffers.crowd) { this.crowdGain = this.ctx.createGain(); this.crowdGain.connect(this.crowd); this.crowdSrc = this.playLoop('crowd', this.crowdGain); }
      if (this.crowdGain) this.crowdGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
    }
    playBuf(name, gain = 1, bus) {
      const buf = this.buffers[name];
      if (!this.ctx || !buf) return;
      const s = this.ctx.createBufferSource(); s.buffer = buf;
      const g = this.ctx.createGain(); g.gain.value = gain;
      s.connect(g); g.connect(bus || this.sfx); s.start();
    }
    cheer() { this.playBuf('cheer', 1, this.crowd); }
    win() { this.playBuf('win', 0.8); }
    lose() { this.playBuf('lose', 0.6); }

    tone(freq, dur, type = 'square', gain = 0.25, when = 0, pan = 0) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime + when;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005);
      g.gain.setValueAtTime(gain, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur);
      let out = g;
      if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
      o.connect(g); out.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
    }
    noise(dur, f, q, gain, when = 0, decay = true, pan = 0, bus) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime + when;
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      if (decay) g.gain.exponentialRampToValueAtTime(0.001, t + dur); else g.gain.setValueAtTime(0, t + dur);
      s.connect(bp); bp.connect(g);
      let out = g;
      if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
      out.connect(bus || this.sfx);
      s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }
    // Lampu start
    beepStage() { this.tone(660, 0.09, 'square', 0.12); }
    beepAmber() { this.tone(988, 0.16, 'square', 0.2); }
    beepGreen() { this.tone(1568, 0.55, 'square', 0.22); this.tone(784, 0.55, 'sawtooth', 0.12); }
    beepRed() { this.tone(180, 0.6, 'sawtooth', 0.3); this.tone(186, 0.6, 'square', 0.2); }
    click() { this.tone(1800, 0.03, 'square', 0.08); }
    countdown() { this.tone(523, 0.12, 'triangle', 0.25); }
    whoosh() { this.noise(0.6, 900, 0.7, 0.35); }
    // Ban berdecit saat GAS
    screech(pan = 0) { this.noise(0.9, 2600, 6, 0.28, 0, true, pan); this.noise(0.7, 1400, 3, 0.18, 0, true, pan); }
    // Letupan knalpot saat oper gigi
    pop(pan = 0, big = false) {
      if (!this.ctx) return;
      this.noise(big ? 0.18 : 0.1, 180, 1.2, big ? 0.9 : 0.6, 0, true, pan);
      this.noise(0.06, 900, 1, 0.4, 0.02, true, pan);
      if (big) this.noise(0.08, 220, 1, 0.6, 0.11, true, pan);
    }
    perfect() { this.tone(1318, 0.08, 'triangle', 0.18, 0); this.tone(1760, 0.14, 'triangle', 0.18, 0.07); }

    // Mesin motor (sintesis berdasarkan RPM)
    createEngine(pan = 0) {
      if (!this.ctx) return null;
      const c = this.ctx;
      const out = c.createGain(); out.gain.value = 0;
      let dest = out;
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; out.connect(p); p.connect(this.engine); } else out.connect(this.engine);
      const shaper = c.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.2); }
      shaper.curve = curve;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
      const am = c.createGain(); am.gain.value = 0.85;
      shaper.connect(lp); lp.connect(am); am.connect(dest);
      const o1 = c.createOscillator(); o1.type = 'sawtooth';
      const o2 = c.createOscillator(); o2.type = 'square';
      const o3 = c.createOscillator(); o3.type = 'sawtooth';
      const g1 = c.createGain(), g2 = c.createGain(), g3 = c.createGain();
      g1.gain.value = 0.5; g2.gain.value = 0.35; g3.gain.value = 0.2;
      o1.connect(g1); o2.connect(g2); o3.connect(g3);
      g1.connect(shaper); g2.connect(shaper); g3.connect(shaper);
      const ns = c.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true;
      const nbp = c.createBiquadFilter(); nbp.type = 'bandpass'; nbp.Q.value = 1.2;
      const ng = c.createGain(); ng.gain.value = 0.25;
      ns.connect(nbp); nbp.connect(ng); ng.connect(shaper);
      // getaran "beat" mesin 4 silinder
      const lfo = c.createOscillator(); lfo.type = 'square';
      const lfoG = c.createGain(); lfoG.gain.value = 0.15;
      lfo.connect(lfoG); lfoG.connect(am.gain);
      [o1, o2, o3, ns, lfo].forEach((n) => n.start());
      const self = this;
      return {
        set(rpm, throttle = 1, vol = 1) {
          const t = c.currentTime;
          const f = Math.max(25, rpm / 30);               // frekuensi letupan 4 silinder 4-tak
          o1.frequency.setTargetAtTime(f, t, 0.015);
          o2.frequency.setTargetAtTime(f / 2, t, 0.015);
          o3.frequency.setTargetAtTime(f * 1.505, t, 0.015);
          nbp.frequency.setTargetAtTime(f * 3, t, 0.02);
          lfo.frequency.setTargetAtTime(f / 4, t, 0.02);
          lp.frequency.setTargetAtTime(500 + rpm * 0.28 * (0.5 + throttle * 0.5), t, 0.02);
          out.gain.setTargetAtTime((0.12 + 0.2 * throttle) * vol * (self.enabled ? 1 : 0), t, 0.03);
        },
        stop() {
          const t = c.currentTime;
          out.gain.setTargetAtTime(0, t, 0.15);
          setTimeout(() => [o1, o2, o3, ns, lfo].forEach((n) => { try { n.stop(); } catch {} }), 800);
        },
      };
    }
  }

  window.Clock = Clock;
  window.DragAudio = DragAudio;
})();
