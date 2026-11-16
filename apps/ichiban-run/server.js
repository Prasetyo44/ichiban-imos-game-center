module.exports = function mountApp(opts) {
// Ichiban Run - server
// Layar TV menjalankan game, HP peserta menjadi controller (UP / DOWN).
// Server mengatur QR sekali pakai, pendaftaran peserta, meneruskan tombol
// dari HP ke TV, mencatat skor, dan menyimpan semua pengaturan admin.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = opts.port;
const ADMIN_PASSWORD = opts.adminPassword;
const DATA_DIR = opts.dataDir;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const FORM_TIMEOUT_MS = 3 * 60 * 1000;  // TV kembali ke QR kalau peserta tidak lanjut mengisi
const READY_TIMEOUT_MS = 2 * 60 * 1000; // ...atau tidak menekan MULAI
const PX_PER_METER = 40;                 // 40 piksel layar = 1 meter perjalanan

// ---------- Pengaturan (semua bisa diubah di admin) ----------
// [tipe, default, min, max]
const SCHEMA = {
  // Branding
  title: ['str', 'ICHIBAN RUN', 60],
  subtitle: ['str', 'Lompati rintangan, lari sejauh-jauhnya!', 120],
  footer: ['str', 'Ichiban Paint · Japan Technology', 120],
  primaryColor: ['color', '#d71920'],
  accentColor: ['color', '#ffc400'],
  theme: ['enum', 'siang', ['siang', 'senja', 'malam']],
  showBillboards: ['bool', true],
  // Nyawa
  lives: ['int', 3, 1, 10],
  maxLives: ['int', 5, 1, 15],
  heartChance: ['num', 6, 0, 100],       // % peluang muncul hati tambahan di antara rintangan
  invincibleSec: ['num', 1.5, 0, 5],
  // Kecepatan & kesulitan
  startSpeed: ['int', 620, 200, 2000],   // piksel per detik
  maxSpeed: ['int', 1450, 200, 3000],
  accel: ['num', 12, 0, 200],            // tambahan kecepatan per detik
  jumpHeight: ['int', 300, 120, 600],
  gravity: ['int', 2800, 800, 6000],
  doubleJump: ['bool', false],
  playerSize: ['int', 170, 80, 300],     // tinggi karakter kaleng (piksel, layar 1920x1080)
  // Rintangan
  obsMinGap: ['num', 0.9, 0.3, 5],       // jeda antar rintangan (detik)
  obsMaxGap: ['num', 1.9, 0.3, 8],
  flyingChance: ['num', 30, 0, 100],     // % rintangan terbang (harus MERUNDUK)
  flyingStartM: ['int', 120, 0, 5000],   // rintangan terbang mulai muncul setelah X meter
  doubleObsChance: ['num', 15, 0, 100],  // % rintangan ganda (lebih lebar)
  maxDurationSec: ['int', 0, 0, 3600],   // 0 = tanpa batas waktu
  // Skor
  pointsPerMeter: ['num', 1, 0, 1000],
  coinChance: ['num', 45, 0, 100],
  coinPoints: ['int', 25, 0, 10000],
  // Karakter
  spriteMode: ['enum', 'choose', ['choose', 'fixed', 'random']],
  spriteId: ['str', 'aerosol', 40],
  // Alur permainan
  countdownSec: ['int', 3, 0, 10],
  resultHoldSec: ['int', 12, 3, 120],
  askPhone: ['bool', true],
  extraFieldLabel: ['str', '', 40],      // kosong = tidak ditampilkan (contoh: "Nama Bengkel")
  playsPerPhone: ['int', 0, 0, 100],     // 0 = boleh main berkali-kali
  leaderboardSize: ['int', 10, 3, 50],
  keyboardOnTv: ['bool', true],
  sound: ['bool', true],
  logo: ['str', '', 300],
};
const DEFAULT_SETTINGS = Object.fromEntries(Object.entries(SCHEMA).map(([k, v]) => [k, v[1]]));

const BUILTIN_SPRITES = [
  { id: 'aerosol', name: 'Ichiban All-in-One (Aerosol)', src: 'img/can-aerosol.png', builtin: true, enabled: true },
  { id: 'nc', name: 'Ichiban NC Series (Kaleng)', src: 'img/can-nc.png', builtin: true, enabled: true },
];

function cleanSettings(input, base) {
  const out = { ...base };
  for (const [k, def] of Object.entries(SCHEMA)) {
    if (!(k in input)) continue;
    const v = input[k];
    const [type] = def;
    if (type === 'str') out[k] = String(v ?? '').slice(0, def[2]);
    else if (type === 'bool') out[k] = !!v;
    else if (type === 'color') { if (/^#[0-9a-f]{6}$/i.test(v)) out[k] = v; }
    else if (type === 'enum') { if (def[2].includes(v)) out[k] = v; }
    else if (type === 'int' || type === 'num') {
      let n = Number(v);
      if (!Number.isFinite(n)) continue;
      if (type === 'int') n = Math.round(n);
      out[k] = Math.min(def[3], Math.max(def[2], n));
    }
  }
  if (out.maxSpeed < out.startSpeed) out.maxSpeed = out.startSpeed;
  if (out.obsMaxGap < out.obsMinGap) out.obsMaxGap = out.obsMinGap;
  if (out.maxLives < out.lives) out.maxLives = out.lives;
  return out;
}

// ---------- Penyimpanan data (file JSON sederhana) ----------
function loadData() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  const custom = (raw.sprites || []).filter((s) => !s.builtin);
  const builtinState = Object.fromEntries((raw.sprites || []).filter((s) => s.builtin).map((s) => [s.id, s.enabled !== false]));
  return {
    settings: cleanSettings(raw.settings || {}, DEFAULT_SETTINGS),
    sprites: [...BUILTIN_SPRITES.map((s) => ({ ...s, enabled: builtinState[s.id] ?? true })), ...custom],
    plays: Array.isArray(raw.plays) ? raw.plays : [],
  };
}
let db = loadData();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  }, 100);
}
save();

// ---------- Utilitas ----------
const uid = (n = 8) => crypto.randomBytes(n).toString('hex');

function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('62')) d = '0' + d.slice(2);
  else if (d.startsWith('8')) d = '0' + d;
  return d;
}
function maskPhone(p) {
  if (!p) return '';
  return p.length > 7 ? p.slice(0, 4) + '****' + p.slice(-3) : p;
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}
const BASE_URL = opts.baseUrl;

const enabledSprites = () => {
  const list = db.sprites.filter((s) => s.enabled);
  return list.length ? list : [db.sprites[0]];
};
const publicSprites = () => enabledSprites().map(({ id, name, src }) => ({ id, name, src }));

function pickSprite(requested) {
  const list = enabledSprites();
  const st = db.settings;
  if (st.spriteMode === 'fixed') return list.find((s) => s.id === st.spriteId) || list[0];
  if (st.spriteMode === 'choose') return list.find((s) => s.id === requested) || list[0];
  return list[crypto.randomInt(0, list.length)];
}

function branding() {
  const s = db.settings;
  return {
    title: s.title, subtitle: s.subtitle, footer: s.footer, primaryColor: s.primaryColor,
    accentColor: s.accentColor, theme: s.theme, logo: s.logo, showBillboards: s.showBillboards,
    keyboardOnTv: s.keyboardOnTv, sound: s.sound, sprites: publicSprites(),
  };
}

// Papan skor: skor terbaik per peserta (nomor HP, atau nama kalau HP tidak diminta)
function leaderboard(limit = db.settings.leaderboardSize) {
  const best = new Map();
  for (const p of db.plays) {
    if (p.score === null || p.score === undefined || p.test) continue;
    const key = p.phone || 'n:' + p.name.toLowerCase();
    const cur = best.get(key);
    if (!cur || p.score > cur.score) best.set(key, p);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.playedAt.localeCompare(b.playedAt))
    .slice(0, limit)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, phone: maskPhone(p.phone), score: p.score, distance: p.distance, sprite: p.spriteId }));
}
function rankOf(play) {
  const all = leaderboard(100000);
  const i = all.findIndex((r) => r.id === play.id);
  if (i >= 0) return i + 1;
  return null; // skor ini bukan skor terbaik peserta tersebut
}

// ---------- State layar TV ----------
// screens: socketId -> { token, state: 'qr'|'form'|'ready'|'countdown'|'playing'|'over', playId, timer }
const screens = new Map();
const tokens = new Map(); // token -> screenSocketId

async function showNewQr(screenId) {
  const s = screens.get(screenId);
  if (!s) return;
  clearTimeout(s.timer);
  if (s.token) tokens.delete(s.token);
  const roundEnded = !!s.playId; // ada pemain sebelumnya = satu permainan selesai / batal
  s.token = uid(6);
  s.state = 'qr';
  s.playId = null;
  if (roundEnded && opts.onRoundEnd) opts.onRoundEnd(screenId);
  tokens.set(s.token, screenId);
  const url = `${BASE_URL}/play?t=${s.token}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 600 });
  io.to(screenId).emit('screen:qr', { qr, url, branding: branding(), leaderboard: leaderboard() });
  broadcastAdmin();
}
function screenOfPlay(playId) {
  for (const [id, s] of screens) if (s.playId === playId) return id;
  return null;
}
function screensSummary() {
  return [...screens.values()].map((s) => {
    const p = s.playId && db.plays.find((x) => x.id === s.playId);
    return { state: s.state, player: p ? p.name : null };
  });
}
let adminTimer = null;
function broadcastAdmin() {
  clearTimeout(adminTimer);
  adminTimer = setTimeout(() => io.to('admin').emit('admin:refresh'), 150);
}

// ---------- HTTP ----------
const app = express();
const server = opts.server;
const io = new Server(server, { path: opts.base + '/socket.io', destroyUpgrade: false });

app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
const page = (f) => (_req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get('/', (_req, res) => res.redirect(opts.base + '/tv'));
app.get('/tv', page('tv.html'));
app.get('/play', page('play.html'));
app.get('/admin', page('admin.html'));
app.get('/leaderboard', page('leaderboard.html'));
app.get('/api/leaderboard', (_req, res) => res.json({ branding: branding(), leaderboard: leaderboard() }));

function requireAdmin(req, res, next) {
  if (req.get('x-admin-password') === ADMIN_PASSWORD || req.query.pw === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Password admin salah' });
}

app.get('/api/admin/state', requireAdmin, (_req, res) => {
  res.json({
    settings: db.settings, defaults: DEFAULT_SETTINGS, sprites: db.sprites, plays: db.plays.slice(0, 1000),
    totalPlays: db.plays.length, leaderboard: leaderboard(), baseUrl: BASE_URL, screens: screensSummary(),
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  db.settings = cleanSettings(req.body || {}, db.settings);
  save();
  pushSettings();
  res.json({ ok: true, settings: db.settings });
});

function pushSettings() {
  io.emit('branding', branding());
  for (const [id, s] of screens) if (s.state === 'qr') showNewQr(id);
  broadcastAdmin();
}

function saveDataUrl(dataUrl, prefix) {
  const m = /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', 'svg+xml': 'svg' }[m[1]];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) return null;
  const file = `${prefix}-${uid(4)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  return 'uploads/' + file;
}

app.post('/api/admin/sprites', requireAdmin, (req, res) => {
  const src = saveDataUrl(req.body.dataUrl, 'sprite');
  if (!src) return res.status(400).json({ error: 'File gambar tidak valid (PNG/JPG/WEBP, maks 4 MB)' });
  const sp = { id: 's' + uid(3), name: String(req.body.name || 'Kaleng baru').slice(0, 40), src, builtin: false, enabled: true };
  db.sprites.push(sp);
  save();
  pushSettings();
  res.json({ ok: true, sprite: sp });
});

app.put('/api/admin/sprites/:id', requireAdmin, (req, res) => {
  const sp = db.sprites.find((s) => s.id === req.params.id);
  if (!sp) return res.status(404).json({ error: 'Karakter tidak ditemukan' });
  if (typeof req.body.enabled === 'boolean') sp.enabled = req.body.enabled;
  if (typeof req.body.name === 'string' && req.body.name.trim()) sp.name = req.body.name.trim().slice(0, 40);
  if (!db.sprites.some((s) => s.enabled)) sp.enabled = true;
  save();
  pushSettings();
  res.json({ ok: true });
});

app.delete('/api/admin/sprites/:id', requireAdmin, (req, res) => {
  const sp = db.sprites.find((s) => s.id === req.params.id);
  if (!sp || sp.builtin) return res.status(400).json({ error: 'Karakter bawaan tidak bisa dihapus (bisa dinonaktifkan)' });
  db.sprites = db.sprites.filter((s) => s !== sp);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(sp.src))); } catch {}
  save();
  pushSettings();
  res.json({ ok: true });
});

app.post('/api/admin/logo', requireAdmin, (req, res) => {
  if (!req.body.dataUrl) { db.settings.logo = ''; save(); pushSettings(); return res.json({ ok: true }); }
  const src = saveDataUrl(req.body.dataUrl, 'logo');
  if (!src) return res.status(400).json({ error: 'File gambar tidak valid' });
  db.settings.logo = src;
  save();
  pushSettings();
  res.json({ ok: true, logo: src });
});

app.delete('/api/admin/plays/:id', requireAdmin, (req, res) => {
  db.plays = db.plays.filter((p) => p.id !== req.params.id);
  save();
  pushSettings();
  res.json({ ok: true });
});

app.post('/api/admin/reset', requireAdmin, (_req, res) => {
  db.plays = db.plays.filter((p) => screenOfPlay(p.id)); // permainan yang sedang berjalan tetap disimpan
  save();
  pushSettings();
  res.json({ ok: true });
});

app.post('/api/admin/settings/reset', requireAdmin, (_req, res) => {
  const keep = { logo: db.settings.logo };
  db.settings = { ...DEFAULT_SETTINGS, ...keep };
  save();
  pushSettings();
  res.json({ ok: true });
});

app.post('/api/admin/stop', requireAdmin, (_req, res) => {
  for (const [id, s] of screens) {
    if (s.state === 'countdown' || s.state === 'playing') io.to(id).emit('game:forceEnd');
    else if (s.state !== 'over') showNewQr(id);
  }
  res.json({ ok: true });
});

// Uji coba: jalankan game di layar TV yang sedang menampilkan QR, dikontrol keyboard TV
app.post('/api/admin/test-game', requireAdmin, (_req, res) => {
  const entry = [...screens.entries()].find(([, s]) => s.state === 'qr');
  if (!entry) return res.status(400).json({ error: 'Tidak ada layar TV yang sedang menampilkan QR' });
  const [screenId, s] = entry;
  const sp = pickSprite(db.settings.spriteId);
  const p = { id: uid(8), name: 'Uji Coba', phone: '', extra: '', spriteId: sp.id, test: true, createdAt: new Date().toISOString(), score: null, distance: null, coins: null, durationMs: null, playedAt: null };
  db.plays.unshift(p);
  save();
  if (s.token) tokens.delete(s.token);
  s.token = null;
  s.state = 'countdown';
  s.playId = p.id;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => showNewQr(screenId), 60 * 60 * 1000);
  io.to(screenId).emit('game:start', { ...gameConfig(p), keyboardOnTv: true });
  broadcastAdmin();
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', requireAdmin, (_req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const extra = db.settings.extraFieldLabel || 'Data Tambahan';
  const lb = new Map(leaderboard(100000).map((r) => [r.id, r.rank]));
  const rows = [['Waktu Daftar', 'Uji Coba', 'Nama', 'No HP', extra, 'Karakter', 'Skor', 'Jarak (m)', 'Bintang', 'Durasi (detik)', 'Peringkat', 'Waktu Main']];
  for (const p of db.plays) {
    const sp = db.sprites.find((s) => s.id === p.spriteId);
    rows.push([p.createdAt, p.test ? 'Ya' : '', p.name, p.phone ? "'" + p.phone : '', p.extra, sp ? sp.name : p.spriteId, p.score ?? '', p.distance ?? '', p.coins ?? '',
      p.durationMs ? (p.durationMs / 1000).toFixed(1) : '', lb.get(p.id) || '', p.playedAt || '']);
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="skor-ichiban-run-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// ---------- Socket.IO ----------
function gameConfig(play) {
  const s = db.settings;
  const sp = db.sprites.find((x) => x.id === play.spriteId) || db.sprites[0];
  return {
    playId: play.id, name: play.name, sprite: { id: sp.id, src: sp.src, name: sp.name },
    pxPerMeter: PX_PER_METER,
    ...Object.fromEntries(Object.keys(SCHEMA).map((k) => [k, s[k]])),
  };
}

function finishPlay(screenId, data) {
  const s = screens.get(screenId);
  if (!s || !s.playId) return;
  const p = db.plays.find((x) => x.id === s.playId);
  if (!p || p.score !== null) return;
  const st = db.settings;
  const durationMs = Math.max(0, Number(data.durationMs) || 0);
  // Pemeriksaan wajar: jarak tidak boleh melebihi kecepatan maksimum x waktu
  const maxDist = (st.maxSpeed * durationMs) / 1000 / PX_PER_METER + 5;
  const distance = Math.min(maxDist, Math.max(0, Math.floor(Number(data.distance) || 0)));
  const coins = Math.max(0, Math.floor(Number(data.coins) || 0));
  const score = Math.max(0, Math.floor(Number(data.score) || 0));
  const maxScore = Math.ceil(distance * st.pointsPerMeter + coins * st.coinPoints) + 1;
  Object.assign(p, { score: Math.min(score, maxScore), distance, coins, durationMs, playedAt: new Date().toISOString(), endReason: String(data.reason || '').slice(0, 20) });
  save();
  const rank = rankOf(p);
  const lb = leaderboard();
  const payload = { name: p.name, score: p.score, distance, coins, rank, leaderboard: lb, reason: p.endReason, holdSec: st.resultHoldSec, test: !!p.test };
  s.state = 'over';
  clearTimeout(s.timer);
  io.to(screenId).emit('game:result', payload);
  io.to('p:' + p.id).emit('game:over', payload);
  s.timer = setTimeout(() => showNewQr(screenId), st.resultHoldSec * 1000);
  for (const [id, sc] of screens) if (id !== screenId && sc.state === 'qr') io.to(id).emit('leaderboard', lb);
  io.emit('leaderboard:update', lb);
  broadcastAdmin();
}

io.on('connection', (socket) => {
  // ----- Layar TV / laptop -----
  socket.on('screen:hello', () => {
    screens.set(socket.id, { token: null, state: 'qr', playId: null, timer: null });
    showNewQr(socket.id);
  });

  socket.on('game:running', () => {
    const s = screens.get(socket.id);
    if (s && s.state === 'countdown') {
      s.state = 'playing';
      io.to('p:' + s.playId).emit('game:running');
      broadcastAdmin();
    }
  });

  socket.on('game:tick', (d) => {
    const s = screens.get(socket.id);
    if (s && s.playId && s.state === 'playing') {
      io.to('p:' + s.playId).volatile.emit('game:tick', { lives: d.lives, score: d.score, distance: d.distance });
    }
  });

  socket.on('game:hit', (d) => {
    const s = screens.get(socket.id);
    if (s && s.playId) io.to('p:' + s.playId).emit('game:hit', d);
  });

  socket.on('game:over', (d) => finishPlay(socket.id, d || {}));

  // ----- HP peserta -----
  socket.on('play:check', ({ token, pid } = {}, cb = () => {}) => {
    const base = { branding: branding(), askPhone: db.settings.askPhone, extraFieldLabel: db.settings.extraFieldLabel, spriteMode: db.settings.spriteMode };
    if (pid) {
      const p = db.plays.find((x) => x.id === pid);
      const screenId = p && screenOfPlay(p.id);
      const s = screenId && screens.get(screenId);
      if (p && p.score !== null) {
        return cb({ ok: true, ...base, stage: 'done', name: p.name, result: { score: p.score, distance: p.distance, coins: p.coins, rank: rankOf(p) } });
      }
      if (p && s) {
        socket.join('p:' + p.id);
        const stage = s.state === 'ready' ? 'ready' : 'controller';
        return cb({ ok: true, ...base, stage, name: p.name, lives: db.settings.lives });
      }
    }
    const screenId = tokens.get(token);
    if (!screenId) return cb({ ok: false, ...base, error: 'QR sudah kedaluwarsa atau sedang dipakai peserta lain. Silakan scan QR terbaru di layar.' });
    const s = screens.get(screenId);
    if (s.state === 'qr') {
      s.state = 'form';
      io.to(screenId).emit('screen:form');
      clearTimeout(s.timer);
      s.timer = setTimeout(() => s.state === 'form' && showNewQr(screenId), FORM_TIMEOUT_MS);
      broadcastAdmin();
    }
    cb({ ok: true, ...base, stage: 'form' });
  });

  socket.on('play:register', ({ token, name, phone, extra, spriteId } = {}, cb = () => {}) => {
    const screenId = tokens.get(token);
    const s = screenId && screens.get(screenId);
    if (!s || !['qr', 'form'].includes(s.state)) return cb({ ok: false, error: 'Sesi sudah berakhir. Silakan scan ulang QR di layar.' });
    const st = db.settings;
    name = String(name || '').trim().slice(0, 40);
    extra = String(extra || '').trim().slice(0, 80);
    const nphone = st.askPhone ? normalizePhone(phone) : '';
    if (name.length < 2) return cb({ ok: false, error: 'Nama wajib diisi' });
    if (st.askPhone && (nphone.length < 9 || nphone.length > 14)) return cb({ ok: false, error: 'Nomor HP tidak valid' });
    if (st.extraFieldLabel && extra.length < 1) return cb({ ok: false, error: `${st.extraFieldLabel} wajib diisi` });
    if (st.askPhone && st.playsPerPhone > 0) {
      const used = db.plays.filter((p) => p.phone === nphone && p.score !== null).length;
      if (used >= st.playsPerPhone) return cb({ ok: false, error: `Nomor HP ini sudah main ${used}x (batas ${st.playsPerPhone}x). Terima kasih sudah ikut!` });
    }
    const sp = pickSprite(spriteId);
    const p = { id: uid(8), name, phone: nphone, extra, spriteId: sp.id, createdAt: new Date().toISOString(), score: null, distance: null, coins: null, durationMs: null, playedAt: null };
    db.plays.unshift(p);
    save();
    tokens.delete(token); // QR terpakai: tidak bisa dipakai HP lain
    s.token = null;
    s.state = 'ready';
    s.playId = p.id;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => s.state === 'ready' && showNewQr(screenId), READY_TIMEOUT_MS);
    socket.join('p:' + p.id);
    io.to(screenId).emit('screen:ready', { name: p.name, sprite: { id: sp.id, src: sp.src, name: sp.name } });
    broadcastAdmin();
    cb({ ok: true, pid: p.id, name: p.name, sprite: sp.name, lives: st.lives });
  });

  socket.on('play:start', ({ pid } = {}, cb = () => {}) => {
    const p = db.plays.find((x) => x.id === pid);
    const screenId = p && screenOfPlay(p.id);
    const s = screenId && screens.get(screenId);
    if (!p || p.score !== null) return cb({ ok: false, error: 'Kesempatan main sudah dipakai.' });
    if (!s || s.state !== 'ready') return cb({ ok: false, error: 'Layar tidak siap. Silakan scan ulang QR.' });
    s.state = 'countdown';
    clearTimeout(s.timer);
    // pengaman: kalau TV tidak mengirim hasil dalam waktu wajar, kembali ke QR
    const limit = db.settings.maxDurationSec > 0 ? db.settings.maxDurationSec + 60 : 60 * 60;
    s.timer = setTimeout(() => showNewQr(screenId), limit * 1000);
    io.to(screenId).emit('game:start', gameConfig(p));
    cb({ ok: true, countdown: db.settings.countdownSec, lives: db.settings.lives });
    broadcastAdmin();
  });

  // Tombol UP / DOWN dari HP diteruskan langsung ke layar TV
  socket.on('ctl', (m) => {
    if (!m || !m.pid) return;
    const screenId = screenOfPlay(m.pid);
    const s = screenId && screens.get(screenId);
    if (!s || (s.state !== 'playing' && s.state !== 'countdown')) return;
    const k = m.k === 'up' ? 'up' : 'down';
    io.to(screenId).emit('ctl', { k, d: !!m.d });
  });

  socket.on('leaderboard:join', () => socket.join('lb'));

  socket.on('admin:join', (pw, cb) => {
    if (pw === ADMIN_PASSWORD) { socket.join('admin'); cb && cb(true); } else cb && cb(false);
  });

  socket.on('disconnect', () => {
    const s = screens.get(socket.id);
    if (s) {
      clearTimeout(s.timer);
      if (s.token) tokens.delete(s.token);
      if (s.playId) io.to('p:' + s.playId).emit('screen:lost');
      screens.delete(socket.id);
      broadcastAdmin();
    }
  });
});


// ---------- Ringkasan untuk halaman super-admin ----------
function __summary() {
  return { screens: screensSummary().length, players: db.plays.length, played: db.plays.filter((p) => p.score !== null && p.score !== undefined).length, title: (db.settings && (db.settings.title || db.settings.gameTitle)) || '' };
}
return { app, io, summary: __summary };
};
