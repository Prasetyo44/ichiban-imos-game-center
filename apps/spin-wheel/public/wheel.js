// Roda yang dipakai bersama oleh halaman HP dan TV.
// Segmen 0 dimulai dari atas (posisi jarum) dan berurutan searah jarum jam.
class Wheel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.prizes = [];
    this.rotation = 0; // derajat, searah jarum jam
    this.anim = null;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  setPrizes(prizes) {
    this.prizes = prizes || [];
    this.draw();
  }

  reset() {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = null;
    this.rotation = 0;
    this.draw();
  }

  resize() {
    const size = this.canvas.clientWidth || 300;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.scale = dpr;
    this.draw();
  }

  draw() {
    const { ctx, canvas, prizes } = this;
    const W = canvas.width;
    const r = W / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    if (!prizes.length) return;
    const n = prizes.length;
    const seg = (Math.PI * 2) / n;
    ctx.translate(r, r);
    ctx.rotate((this.rotation * Math.PI) / 180);
    const rim = r * 0.06;
    const R = r - rim;

    // Bingkai luar
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1b2f';
    ctx.fill();

    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * seg;
      const a1 = a0 + seg;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = prizes[i].color;
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.008);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();

      // Teks hadiah
      ctx.save();
      ctx.rotate(a0 + seg / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = textColor(prizes[i].color);
      let fs = Math.min(R * 0.11, (R * seg) * 0.38);
      ctx.font = `700 ${fs}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      const maxW = R * 0.68;
      const label = prizes[i].name;
      while (ctx.measureText(label).width > maxW && fs > 8) {
        fs -= 1;
        ctx.font = `700 ${fs}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      }
      ctx.fillText(label, R * 0.9, 0);
      ctx.restore();
    }

    // Lampu di bingkai
    const bulbs = Math.max(12, n * 2);
    for (let i = 0; i < bulbs; i++) {
      const a = (i / bulbs) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (r - rim / 2), Math.sin(a) * (r - rim / 2), rim * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? '#ffd166' : '#fff6d5';
      ctx.fill();
    }

    // Tengah
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = R * 0.03;
    ctx.strokeStyle = '#1b1b2f';
    ctx.stroke();
  }

  // Putar sampai segmen `index` berada di bawah jarum (atas).
  // offset 0..1 = posisi di dalam segmen. Semua parameter datang dari server
  // sehingga HP dan TV berhenti di posisi yang sama persis.
  spin({ index, count, turns, offset, duration }, onDone) {
    if (this.anim) cancelAnimationFrame(this.anim);
    const segDeg = 360 / count;
    const landing = 360 - (index + offset) * segDeg; // sudut akhir (mod 360)
    const start = this.rotation % 360;
    const target = turns * 360 + landing;
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 4); // melambat di akhir
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      this.rotation = start + (target - start) * ease(t);
      this.draw();
      if (t < 1) this.anim = requestAnimationFrame(tick);
      else {
        this.anim = null;
        onDone && onDone();
      }
    };
    this.anim = requestAnimationFrame(tick);
  }
}

function textColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1b1b2f' : '#ffffff';
}

// Konfeti sederhana untuk hasil menang
function confetti(container, ms = 4000) {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
  container.appendChild(c);
  const ctx = c.getContext('2d');
  const W = (c.width = innerWidth), H = (c.height = innerHeight);
  const colors = ['#e63946', '#f1c40f', '#2a9d8f', '#457b9d', '#f4a261', '#8e44ad', '#ffffff'];
  const parts = Array.from({ length: 160 }, () => ({
    x: Math.random() * W, y: -20 - Math.random() * H * 0.5,
    vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4,
    s: 6 + Math.random() * 8, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  (function f(now) {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (now - t0 < ms) requestAnimationFrame(f); else c.remove();
  })(t0);
}
