// Ichiban Drag Race - simulasi balapan (dipakai bersama oleh server, layar TV, dan HP).
// Simulasi deterministik: dengan pengaturan + daftar waktu TAP yang sama, hasilnya selalu sama.
// Waktu tap dihitung relatif terhadap lampu HIJAU (detik). Tap sebelum hijau = false start.
(function (root) {
  const DT = 1 / 240;

  function makeModel(cfg) {
    const n = Math.max(2, Math.min(6, cfg.gears | 0));
    const vTop = cfg.topKmh / 3.6;
    // Kecepatan maksimum tiap gigi (di garis merah RPM)
    const vg = [];
    for (let i = 0; i < n; i++) vg.push(vTop * (0.36 + 0.64 * Math.pow(i / (n - 1), 0.82)));
    const K = 11.5 * (cfg.power / 100);              // tenaga dasar (m/s² di gigi 1)
    const cd = (K * 1.0 * 0.62 * (vg[0] / vg[n - 1])) / (vTop * vTop);
    return { n, vg, K, cd, R: cfg.redline, launchPct: 0.62 };
  }

  function grade(cfg, pct, limiterMs) {
    if (limiterMs > cfg.limiterGraceMs) return 'telat';
    if (pct >= cfg.perfectFromPct / 100) return 'perfect';
    if (pct >= cfg.goodFromPct / 100) return 'bagus';
    return 'cepat';
  }

  // Racer: simulasi satu motor. taps = waktu tap relatif hijau (detik), urut naik.
  class Racer {
    constructor(cfg) {
      this.cfg = cfg;
      this.m = makeModel(cfg);
      this.taps = [];
      this.reset();
    }
    reset() {
      this.s = {
        t: 0, x: 0, v: 0, gear: 0, rpm: this.m.R * 0.3, launched: false, launchT: null, falseStart: false, fsT: null,
        dq: false, shiftUntil: -1, boostUntil: -1, bogUntil: -1, limiterSince: null, shifts: [], finishT: null, topV: 0, tapIdx: 0,
        lastShiftT: -9, lastGrade: null, autoLaunch: false,
      };
      // tap sebelum hijau
      for (const tt of this.taps) {
        if (tt < 0) { this.s.falseStart = true; this.s.fsT = tt; break; }
      }
      if (this.s.falseStart && this.cfg.falseStartRule === 'diskualifikasi') this.s.dq = true;
      this.s.tapIdx = this.taps.findIndex((tt) => tt >= 0);
      if (this.s.tapIdx < 0) this.s.tapIdx = this.taps.length;
    }
    addTap(tt) {
      // sisipkan urut; kalau tap berada sebelum waktu simulasi sekarang, ulang dari awal
      let i = this.taps.length;
      while (i > 0 && this.taps[i - 1] > tt) i--;
      this.taps.splice(i, 0, tt);
      if (tt < this.s.t + 1e-9 || tt < 0) { this.reset(); }
    }
    setTaps(list) { this.taps = [...list].sort((a, b) => a - b); this.reset(); }

    pct() { return Math.min(1.08, this.s.rpm / this.m.R); }

    // jalankan simulasi sampai waktu t (detik relatif hijau)
    advance(t) {
      const s = this.s;
      if (s.dq) { s.t = Math.max(s.t, t); return s; }
      while (s.t + DT <= t + 1e-9 && s.finishT === null) this.step();
      return s;
    }

    step() {
      const s = this.s, c = this.cfg, m = this.m;
      const t1 = s.t + DT;
      // jadwal peluncuran
      const minLaunch = s.falseStart ? c.falseStartPenaltySec : 0;
      // proses tap dalam langkah ini
      while (s.tapIdx < this.taps.length && this.taps[s.tapIdx] < t1) {
        const tt = this.taps[s.tapIdx++];
        if (!s.launched) {
          if (tt >= minLaunch) { s.launched = true; s.launchT = Math.max(tt, minLaunch); }
        } else if (tt >= s.shiftUntil && s.gear < m.n - 1) {
          const pct = this.pct();
          const limMs = s.limiterSince === null ? 0 : (tt - s.limiterSince) * 1000;
          const g = grade(c, pct, limMs);
          s.shifts.push({ gear: s.gear + 1, pct: Math.round(pct * 1000) / 10, grade: g, t: tt });
          s.lastGrade = g; s.lastShiftT = tt;
          s.gear++;
          s.shiftUntil = tt + c.shiftMs / 1000;
          if (g === 'perfect') s.boostUntil = s.shiftUntil + 0.5;
          if (g === 'cepat') s.bogUntil = s.shiftUntil + 0.35;
          s.limiterSince = null;
        }
      }
      if (!s.launched) {
        const auto = minLaunch + c.autoLaunchSec;
        if (t1 >= auto) { s.launched = true; s.launchT = auto; s.autoLaunch = true; }
      }
      if (!s.launched) {
        // idle / menahan gas: jarum naik turun sedikit
        s.rpm = m.R * (t1 < -0.5 ? 0.32 : 0.55) + Math.sin(t1 * 9) * m.R * 0.03;
        s.t = t1;
        return;
      }
      // gerak
      let drive = 0;
      const vgear = m.vg[s.gear];
      let rpmPct = Math.max(s.gear === 0 ? m.launchPct : 0.25, s.v / vgear);
      if (s.t >= s.shiftUntil) {
        if (s.v < vgear - 1e-6) {
          const tq = 0.45 + 0.55 * Math.pow(Math.min(1, rpmPct), 1.4);
          drive = m.K * tq * (m.vg[0] / vgear);
          if (s.t < s.boostUntil) drive *= 1.12;
          if (s.t < s.bogUntil) drive *= 0.7;
        }
      }
      const a = drive - m.cd * s.v * s.v;
      s.v = Math.max(0, s.v + a * DT);
      if (s.v >= vgear) {
        s.v = vgear;
        if (s.limiterSince === null) s.limiterSince = t1;
      } else if (s.limiterSince !== null && s.v < vgear * 0.995) s.limiterSince = null;
      const x0 = s.x;
      s.x += s.v * DT;
      s.topV = Math.max(s.topV, s.v);
      rpmPct = Math.max(s.gear === 0 ? m.launchPct : 0.2, s.v / vgear);
      if (s.limiterSince !== null) rpmPct = 1 - 0.03 * (Math.floor(t1 * 30) % 2); // rev limiter bergetar
      s.rpm = m.R * rpmPct;
      s.t = t1;
      if (s.x >= c.trackM) {
        const frac = (c.trackM - x0) / Math.max(1e-6, s.x - x0);
        s.finishT = s.t - DT + frac * DT;
        s.x = c.trackM;
      }
    }

    // ringkasan hasil
    result() {
      const s = this.s, c = this.cfg;
      const rt = s.launchT === null ? null : s.falseStart ? null : s.launchT;
      const et = s.finishT === null ? null : s.finishT - (s.launchT ?? 0);
      const total = s.finishT; // waktu dari lampu hijau sampai garis finish (termasuk reaksi & penalti)
      return {
        falseStart: s.falseStart, dq: s.dq, rt, et, total, finished: s.finishT !== null,
        topKmh: Math.round(s.topV * 3.6), shifts: s.shifts.slice(), autoLaunch: s.autoLaunch,
      };
    }
  }

  // Waktu tempuh terbaik secara teori (start reaksi 0, oper gigi tepat sebelum garis merah).
  function bestTime(cfg) {
    const r = new Racer(cfg);
    r.setTaps([0]);
    const m = r.m;
    let guard = 0;
    while (r.s.finishT === null && r.s.t < 120 && guard++ < 200000) {
      r.step();
      const s = r.s;
      if (s.launched && s.gear < m.n - 1 && s.t >= s.shiftUntil && s.v >= m.vg[s.gear] * 0.995) {
        // tap tepat di garis merah
        r.taps.push(s.t + 1e-6);
      }
    }
    return r.s.finishT ?? 999;
  }

  function score(cfg, res, best) {
    if (res.dq || !res.finished) return { total: 0, reaction: 0, shift: 0, time: 0 };
    const reaction = res.rt === null ? 0 : Math.round(cfg.reactPtsMax * Math.max(0, 1 - res.rt / cfg.reactZeroSec));
    let shift = 0;
    for (const sh of res.shifts) shift += sh.grade === 'perfect' ? cfg.shiftPerfectPts : sh.grade === 'bagus' ? cfg.shiftGoodPts : 0;
    const slow = best * 1.5;
    const time = Math.round(cfg.timePtsMax * Math.min(1, Math.max(0, (slow - res.total) / (slow - best))));
    return { total: reaction + shift + time, reaction, shift, time };
  }

  const api = { Racer, bestTime, score, makeModel, DT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DragSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
