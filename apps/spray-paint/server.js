module.exports = function mountApp(opts) {
// Ichiban Spray Paint Challenge - server
// Layar TV menampilkan motor yang harus dicat, HP peserta menjadi kaleng semprot.
// Server mengatur QR sekali pakai, pendaftaran peserta, meneruskan gerakan semprot
// dari HP ke TV, menghitung & mencatat skor, dan menyimpan semua pengaturan admin.

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
const RESULT_DIR = path.join(UPLOAD_DIR, 'hasil');
fs.mkdirSync(RESULT_DIR, { recursive: true });

const FORM_TIMEOUT_MS = 3 * 60 * 1000;  // TV kembali ke QR kalau peserta tidak lanjut mengisi
const READY_TIMEOUT_MS = 2 * 60 * 1000; // ...atau tidak menekan MULAI

// ---------- Pengaturan (semua bisa diubah di admin) ----------
// [tipe, default, min, max]  /  ['enum', default, [pilihan]]  /  ['str', default, maxLen]
const SCHEMA = {
  // Branding
  title: ['str', 'SPRAY PAINT CHALLENGE', 60],
  subtitle: ['str', 'Cat motornya serata mungkin sebelum waktu habis!', 120],
  footer: ['str', 'Ichiban Paint · Japan Technology', 120],
  primaryColor: ['color', '#d71920'],
  accentColor: ['color', '#ffc400'],
  theme: ['enum', 'bengkel', ['bengkel', 'showroom', 'malam']],
  showCans: ['bool', true],               // kaleng Ichiban di layar QR & dekorasi booth
  logo: ['str', '', 300],
  canImage: ['str', '', 300],             // gambar kaleng kursor semprot (kosong = Ichiban All-in-One)
  // Waktu
  durationSec: ['int', 45, 10, 300],
  countdownSec: ['int', 3, 0, 10],
  resultHoldSec: ['int', 15, 3, 120],
  // Semprotan
  sprayRadius: ['int', 70, 20, 200],      // jari-jari semprotan (piksel layar 1920x1080)
  sprayPower: ['int', 100, 20, 400],      // % kecepatan cat menempel
  drips: ['bool', true],                  // cat bisa meleleh kalau terlalu tebal
  dripLimit: ['num', 3, 1.5, 10],         // ketebalan (x lapisan cukup) sebelum meleleh
  controlMode: ['enum', 'pad', ['pad', 'tilt']],
  // Template & warna
  templateMode: ['enum', 'choose', ['choose', 'fixed', 'random']],
  templateId: ['str', 'sport', 40],
  // Skor
  pointsCoverage: ['int', 10000, 100, 1000000], // poin jika 100% rata
  oversprayPenalty: ['num', 40, 0, 10000],      // minus poin per 1% cat meleber
  dripPenalty: ['num', 60, 0, 10000],           // minus poin per 1% cat meleleh
  timeBonusPerSec: ['num', 50, 0, 10000],       // bonus per detik sisa waktu...
  bonusMinCoverage: ['int', 90, 0, 100],        // ...kalau tutupan minimal X%
  autoFinishPct: ['int', 0, 0, 100],            // 0 = tidak; contoh 99 = selesai otomatis saat 99% rata
  allowFinishEarly: ['bool', true],
  // Suara
  musicOn: ['bool', true],
  musicVolume: ['int', 55, 0, 100],
  sfxOn: ['bool', true],
  sfxVolume: ['int', 85, 0, 100],
  phoneSound: ['bool', true],
  music: ['str', '', 300],                // kosong = musik bawaan
  // Alur & peserta
  askPhone: ['bool', true],
  extraFieldLabel: ['str', '', 40],
  playsPerPhone: ['int', 0, 0, 100],
  leaderboardSize: ['int', 10, 3, 50],
  mouseOnTv: ['bool', true],
  saveSnapshots: ['bool', true],
};
const DEFAULT_SETTINGS = Object.fromEntries(Object.entries(SCHEMA).map(([k, v]) => [k, v[1]]));

const BUILTIN_TEMPLATES = [
  { id: 'sport', name: 'Motor Sport', src: 'tpl/sport.svg', kind: 'svg' },
  { id: 'matic', name: 'Skuter Matik', src: 'tpl/matic.svg', kind: 'svg' },
  { id: 'trail', name: 'Trail / Motocross', src: 'tpl/trail.svg', kind: 'svg' },
  { id: 'helm', name: 'Helm Full Face', src: 'tpl/helm.svg', kind: 'svg' },
].map((t) => ({ ...t, builtin: true, enabled: true }));

const DEFAULT_PALETTE = [
  ['Merah Ichiban', '#d71920'], ['Biru Candy', '#1f5fd6'], ['Hitam Doff', '#1d1e22'], ['Kuning Racing', '#ffc400'],
  ['Hijau Kawasaki', '#4cc417'], ['Putih Mutiara', '#f4f4f0'], ['Oranye KTM', '#ff6a00'], ['Ungu Galaxy', '#7a35d8'],
].map(([name, hex], i) => ({ id: 'c' + i, name, hex, enabled: i < 6 }));

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
  return out;
}

function cleanPalette(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const c of list.slice(0, 16)) {
    if (!c || !/^#[0-9a-f]{6}$/i.test(c.hex)) continue;
    out.push({ id: /^[a-z0-9]{1,12}$/i.test(c.id) ? c.id : 'c' + uid(3), name: String(c.name || c.hex).slice(0, 30), hex: c.hex.toLowerCase(), enabled: c.enabled !== false });
  }
  if (!out.length) return null;
  if (!out.some((c) => c.enabled)) out[0].enabled = true;
  return out;
}

// ---------- Penyimpanan data (file JSON sederhana) ----------
const uid = (n = 8) => crypto.randomBytes(n).toString('hex');
function loadData() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  const custom = (raw.templates || []).filter((s) => !s.builtin);
  const builtinState = Object.fromEntries((raw.templates || []).filter((s) => s.builtin).map((s) => [s.id, s.enabled !== false]));
  return {
    settings: cleanSettings(raw.settings || {}, DEFAULT_SETTINGS),
    templates: [...BUILTIN_TEMPLATES.map((s) => ({ ...s, enabled: builtinState[s.id] ?? true })), ...custom],
    palette: cleanPalette(raw.palette) || DEFAULT_PALETTE.map((c) => ({ ...c })),
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

const enabledTemplates = () => {
  const list = db.templates.filter((s) => s.enabled);
  return list.length ? list : [db.templates[0]];
};
const pubTemplate = ({ id, name, src, maskSrc, kind }) => ({ id, name, src, maskSrc: maskSrc || '', kind });
const enabledColors = () => db.palette.filter((c) => c.enabled);

function pickTemplate(requested) {
  const list = enabledTemplates();
  const st = db.settings;
  if (st.templateMode === 'fixed') return list.find((s) => s.id === st.templateId) || list[0];
  if (st.templateMode === 'choose') return list.find((s) => s.id === requested) || list[0];
  return list[crypto.randomInt(0, list.length)];
}

function sound() {
  const s = db.settings;
  return { musicOn: s.musicOn, musicVolume: s.musicVolume, sfxOn: s.sfxOn, sfxVolume: s.sfxVolume, phoneSound: s.phoneSound, music: s.music };
}
function branding() {
  const s = db.settings;
  return {
    title: s.title, subtitle: s.subtitle, footer: s.footer, primaryColor: s.primaryColor, accentColor: s.accentColor,
    theme: s.theme, logo: s.logo, showCans: s.showCans, canImage: s.canImage || 'img/can-aerosol.png', mouseOnTv: s.mouseOnTv,
    templates: enabledTemplates().map(pubTemplate), colors: enabledColors(), sound: sound(),
  };
}

// Rumus skor (sama dengan yang ditampilkan langsung di TV)
function computeScore(m, st = db.settings) {
  const coverage = clamp(m.coverage, 0, 100);
  const drip = clamp(m.drip, 0, coverage);
  const overspray = clamp(m.overspray, 0, 100);
  const timeLeft = clamp(m.timeLeft, 0, st.durationSec);
  const rata = coverage - drip;
  const base = (rata / 100) * st.pointsCoverage;
  const penalty = overspray * st.oversprayPenalty + drip * st.dripPenalty;
  const bonus = coverage >= st.bonusMinCoverage ? Math.floor(timeLeft) * st.timeBonusPerSec : 0;
  const score = Math.max(0, Math.round(base - penalty + bonus));
  const q = score / st.pointsCoverage;
  const grade = q >= 0.9 ? 'S' : q >= 0.75 ? 'A' : q >= 0.55 ? 'B' : q >= 0.35 ? 'C' : 'D';
  return { score, rata: round1(rata), coverage: round1(coverage), drip: round1(drip), overspray: round1(overspray), bonus: Math.round(bonus), penalty: Math.round(penalty), grade };
}
function clamp(v, a, b) { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a; }
function round1(v) { return Math.round(v * 10) / 10; }

// Papan skor: skor terbaik per peserta (nomor HP, atau nama kalau HP tidak diminta)
function leaderboard(limit = db.settings.leaderboardSize) {
  const best = new Map();
  for (const p of db.plays) {
    if (p.score === null || p.score === undefined || p.test) continue;
    const key = p.phone || 'n:' + p.name.toLowerCase();
    const cur = best.get(key);
    if (!cur || p.score > cur.score) best.set(key, p);
  }
  const tName = Object.fromEntries(db.templates.map((t) => [t.id, t.name]));
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.playedAt.localeCompare(b.playedAt))
    .slice(0, limit)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, phone: maskPhone(p.phone), score: p.score, rata: p.rata, grade: p.grade, template: tName[p.templateId] || p.templateId, snapshot: p.snapshot || '' }));
}
function rankOf(play) {
  const i = leaderboard(100000).findIndex((r) => r.id === play.id);
  return i >= 0 ? i + 1 : null;
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
  s.token = uid(6);
  s.state = 'qr';
  s.playId = null;
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
const io = new Server(server, { path: opts.base + '/socket.io', destroyUpgrade: false, maxHttpBufferSize: 4e6 });

app.use(express.json({ limit: '25mb' }));
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
    settings: db.settings, defaults: DEFAULT_SETTINGS, templates: db.templates, palette: db.palette, plays: db.plays.slice(0, 1000),
    totalPlays: db.plays.length, leaderboard: leaderboard(), baseUrl: BASE_URL, screens: screensSummary(),
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  db.settings = cleanSettings(req.body || {}, db.settings);
  if (req.body && req.body.palette) {
    const p = cleanPalette(req.body.palette);
    if (p) db.palette = p;
  }
  save();
  pushSettings();
  res.json({ ok: true, settings: db.settings });
});

function pushSettings() {
  io.emit('branding', branding());
  for (const [id, s] of screens) if (s.state === 'qr') showNewQr(id);
  broadcastAdmin();
}

const MEDIA = {
  image: { re: /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,(.+)$/, ext: { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', 'svg+xml': 'svg' }, max: 6 },
  audio: { re: /^data:audio\/(mpeg|mp3|ogg|wav|x-wav|wave|mp4|x-m4a|aac|webm);base64,(.+)$/, ext: { mpeg: 'mp3', mp3: 'mp3', ogg: 'ogg', wav: 'wav', 'x-wav': 'wav', wave: 'wav', mp4: 'm4a', 'x-m4a': 'm4a', aac: 'aac', webm: 'webm' }, max: 18 },
};
function saveDataUrl(dataUrl, prefix, kind = 'image') {
  const M = MEDIA[kind];
  const m = M.re.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > M.max * 1024 * 1024) return null;
  const file = `${prefix}-${uid(4)}.${M.ext[m[1]]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  return 'uploads/' + file;
}
function removeUpload(src) {
  if (src && src.replace(/^\//, '').startsWith('uploads/')) try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(src))); } catch {}
}

// Template motor custom: gambar motor (PNG transparan) + opsional gambar area cat (mask)
app.post('/api/admin/templates', requireAdmin, (req, res) => {
  const src = saveDataUrl(req.body.dataUrl, 'tpl');
  if (!src) return res.status(400).json({ error: 'File gambar tidak valid (PNG/JPG/WEBP/SVG, maks 6 MB)' });
  let maskSrc = '';
  if (req.body.maskDataUrl) {
    maskSrc = saveDataUrl(req.body.maskDataUrl, 'mask');
    if (!maskSrc) { removeUpload(src); return res.status(400).json({ error: 'File mask tidak valid' }); }
  }
  const t = { id: 't' + uid(3), name: String(req.body.name || 'Motor baru').slice(0, 40), src, maskSrc, kind: 'img', builtin: false, enabled: true };
  db.templates.push(t);
  save();
  pushSettings();
  res.json({ ok: true, template: t });
});
app.put('/api/admin/templates/:id', requireAdmin, (req, res) => {
  const t = db.templates.find((s) => s.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Template tidak ditemukan' });
  if (typeof req.body.enabled === 'boolean') t.enabled = req.body.enabled;
  if (typeof req.body.name === 'string' && req.body.name.trim()) t.name = req.body.name.trim().slice(0, 40);
  if (!db.templates.some((s) => s.enabled)) t.enabled = true;
  save();
  pushSettings();
  res.json({ ok: true });
});
app.delete('/api/admin/templates/:id', requireAdmin, (req, res) => {
  const t = db.templates.find((s) => s.id === req.params.id);
  if (!t || t.builtin) return res.status(400).json({ error: 'Template bawaan tidak bisa dihapus (bisa dinonaktifkan)' });
  db.templates = db.templates.filter((s) => s !== t);
  removeUpload(t.src); removeUpload(t.maskSrc);
  save();
  pushSettings();
  res.json({ ok: true });
});

// Upload logo / gambar kaleng kursor / musik latar. Body kosong = hapus (kembali ke bawaan).
for (const [route, key, kind] of [['logo', 'logo', 'image'], ['canimage', 'canImage', 'image'], ['music', 'music', 'audio']]) {
  app.post('/api/admin/' + route, requireAdmin, (req, res) => {
    if (!req.body.dataUrl) { removeUpload(db.settings[key]); db.settings[key] = ''; save(); pushSettings(); return res.json({ ok: true }); }
    const src = saveDataUrl(req.body.dataUrl, route, kind);
    if (!src) return res.status(400).json({ error: kind === 'audio' ? 'File audio tidak valid (MP3/OGG/WAV/M4A, maks 18 MB)' : 'File gambar tidak valid (maks 6 MB)' });
    removeUpload(db.settings[key]);
    db.settings[key] = src;
    save();
    pushSettings();
    res.json({ ok: true, src });
  });
}

app.delete('/api/admin/plays/:id', requireAdmin, (req, res) => {
  const p = db.plays.find((x) => x.id === req.params.id);
  if (p) removeUpload(p.snapshot);
  db.plays = db.plays.filter((x) => x.id !== req.params.id);
  save();
  pushSettings();
  res.json({ ok: true });
});

app.post('/api/admin/reset', requireAdmin, (_req, res) => {
  const keep = [];
  for (const p of db.plays) {
    if (screenOfPlay(p.id)) keep.push(p); // permainan yang sedang berjalan tetap disimpan
    else removeUpload(p.snapshot);
  }
  db.plays = keep;
  save();
  pushSettings();
  res.json({ ok: true });
});

app.post('/api/admin/settings/reset', requireAdmin, (_req, res) => {
  const keep = { logo: db.settings.logo, canImage: db.settings.canImage, music: db.settings.music };
  db.settings = { ...DEFAULT_SETTINGS, ...keep };
  db.palette = DEFAULT_PALETTE.map((c) => ({ ...c }));
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

// Uji coba: jalankan game di layar TV yang sedang menampilkan QR, dikontrol mouse di TV
app.post('/api/admin/test-game', requireAdmin, (req, res) => {
  const entry = [...screens.entries()].find(([, s]) => s.state === 'qr');
  if (!entry) return res.status(400).json({ error: 'Tidak ada layar TV yang sedang menampilkan QR' });
  const [screenId, s] = entry;
  const t = enabledTemplates().find((x) => x.id === (req.body && req.body.templateId)) || pickTemplate(db.settings.templateId);
  const p = newPlay({ name: 'Uji Coba', phone: '', extra: '', templateId: t.id, test: true });
  db.plays.unshift(p);
  save();
  if (s.token) tokens.delete(s.token);
  s.token = null;
  s.state = 'countdown';
  s.playId = p.id;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => showNewQr(screenId), (db.settings.durationSec + 120) * 1000);
  io.to(screenId).emit('game:start', { ...gameConfig(p), mouseOnTv: true });
  broadcastAdmin();
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', requireAdmin, (_req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const extra = db.settings.extraFieldLabel || 'Data Tambahan';
  const lb = new Map(leaderboard(100000).map((r) => [r.id, r.rank]));
  const tName = Object.fromEntries(db.templates.map((t) => [t.id, t.name]));
  const rows = [['Waktu Daftar', 'Uji Coba', 'Nama', 'No HP', extra, 'Template', 'Warna Dipakai', 'Skor', 'Nilai', 'Rata (%)', 'Tertutup (%)', 'Meleber (%)', 'Meleleh (%)', 'Bonus Waktu', 'Durasi (detik)', 'Peringkat', 'Waktu Main', 'Foto Hasil']];
  for (const p of db.plays) {
    rows.push([p.createdAt, p.test ? 'Ya' : '', p.name, p.phone ? "'" + p.phone : '', p.extra, tName[p.templateId] || p.templateId, (p.colors || []).join(' + '),
      p.score ?? '', p.grade || '', p.rata ?? '', p.coverage ?? '', p.overspray ?? '', p.drip ?? '', p.bonus ?? '',
      p.durationMs ? (p.durationMs / 1000).toFixed(1) : '', lb.get(p.id) || '', p.playedAt || '', p.snapshot ? BASE_URL + p.snapshot : '']);
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="skor-spray-paint-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// ---------- Socket.IO ----------
function newPlay(o) {
  return { id: uid(8), createdAt: new Date().toISOString(), score: null, rata: null, coverage: null, overspray: null, drip: null, bonus: null, grade: null, colors: [], durationMs: null, playedAt: null, snapshot: '', ...o };
}
function gameConfig(play) {
  const s = db.settings;
  const t = db.templates.find((x) => x.id === play.templateId) || db.templates[0];
  return { playId: play.id, name: play.name, template: pubTemplate(t), colors: enabledColors(), sound: sound(), ...Object.fromEntries(Object.keys(SCHEMA).map((k) => [k, s[k]])) };
}

function finishPlay(screenId, data) {
  const s = screens.get(screenId);
  if (!s || !s.playId) return;
  const p = db.plays.find((x) => x.id === s.playId);
  if (!p || p.score !== null) return;
  const st = db.settings;
  const durationMs = Math.max(0, Number(data.durationMs) || 0);
  const r = computeScore({ ...data, timeLeft: Math.min(Number(data.timeLeft) || 0, st.durationSec - durationMs / 1000 + 1) });
  const pal = Object.fromEntries(db.palette.map((c) => [c.id, c.name]));
  const colors = Array.isArray(data.colors) ? data.colors.slice(0, 16).map((id) => pal[id]).filter(Boolean) : [];
  let snapshot = '';
  if (st.saveSnapshots && typeof data.snapshot === 'string') {
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(data.snapshot);
    if (m) {
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length < 1.5 * 1024 * 1024) { fs.writeFileSync(path.join(RESULT_DIR, p.id + '.jpg'), buf); snapshot = 'uploads/hasil/' + p.id + '.jpg'; }
    }
  }
  Object.assign(p, r, { colors, durationMs, snapshot, playedAt: new Date().toISOString(), endReason: String(data.reason || '').slice(0, 20) });
  save();
  const rank = p.test ? null : rankOf(p);
  const lb = leaderboard();
  const payload = { name: p.name, ...r, rank, leaderboard: lb, reason: p.endReason, holdSec: st.resultHoldSec, test: !!p.test, snapshot };
  s.state = 'over';
  clearTimeout(s.timer);
  io.to(screenId).emit('game:result', payload);
  io.to('p:' + p.id).emit('game:over', payload);
  s.timer = setTimeout(() => showNewQr(screenId), st.resultHoldSec * 1000);
  for (const [id, sc] of screens) if (id !== screenId && sc.state === 'qr') io.to(id).emit('leaderboard', lb);
  io.to('lb').emit('leaderboard:update', lb);
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
      io.to('p:' + s.playId).emit('game:running', { durationSec: db.settings.durationSec });
      broadcastAdmin();
    }
  });

  socket.on('game:tick', (d) => {
    const s = screens.get(socket.id);
    if (s && s.playId && s.state === 'playing' && d) {
      io.to('p:' + s.playId).volatile.emit('game:tick', { t: d.t, coverage: d.coverage, rata: d.rata, overspray: d.overspray, drip: d.drip, score: d.score });
    }
  });

  socket.on('game:event', (d) => {
    const s = screens.get(socket.id);
    if (s && s.playId && d) io.to('p:' + s.playId).emit('game:event', { type: String(d.type || '').slice(0, 20) });
  });

  socket.on('game:over', (d) => finishPlay(socket.id, d || {}));

  // ----- HP peserta -----
  socket.on('play:check', ({ token, pid } = {}, cb = () => {}) => {
    const st = db.settings;
    const base = { branding: branding(), askPhone: st.askPhone, extraFieldLabel: st.extraFieldLabel, templateMode: st.templateMode, controlMode: st.controlMode, allowFinishEarly: st.allowFinishEarly };
    if (pid) {
      const p = db.plays.find((x) => x.id === pid);
      const screenId = p && screenOfPlay(p.id);
      const s = screenId && screens.get(screenId);
      if (p && p.score !== null) {
        return cb({ ok: true, ...base, stage: 'done', name: p.name, result: { score: p.score, rata: p.rata, overspray: p.overspray, drip: p.drip, grade: p.grade, rank: rankOf(p), snapshot: p.snapshot } });
      }
      if (p && s) {
        socket.join('p:' + p.id);
        const t = db.templates.find((x) => x.id === p.templateId) || db.templates[0];
        const stage = s.state === 'ready' ? 'ready' : 'controller';
        return cb({ ok: true, ...base, stage, name: p.name, template: pubTemplate(t), durationSec: st.durationSec });
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

  socket.on('play:register', ({ token, name, phone, extra, templateId } = {}, cb = () => {}) => {
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
    const t = pickTemplate(templateId);
    const p = newPlay({ name, phone: nphone, extra, templateId: t.id });
    db.plays.unshift(p);
    save();
    tokens.delete(token); // QR terpakai: tidak bisa dipakai HP lain
    s.token = null;
    s.state = 'ready';
    s.playId = p.id;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => s.state === 'ready' && showNewQr(screenId), READY_TIMEOUT_MS);
    socket.join('p:' + p.id);
    io.to(screenId).emit('screen:ready', { name: p.name, template: pubTemplate(t) });
    broadcastAdmin();
    cb({ ok: true, pid: p.id, name: p.name, template: pubTemplate(t), durationSec: st.durationSec });
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
    s.timer = setTimeout(() => showNewQr(screenId), (db.settings.durationSec + db.settings.countdownSec + 90) * 1000);
    io.to(screenId).emit('game:start', gameConfig(p));
    cb({ ok: true, countdown: db.settings.countdownSec, durationSec: db.settings.durationSec });
    broadcastAdmin();
  });

  // Posisi & tombol semprot dari HP diteruskan langsung ke layar TV
  socket.on('aim', (m) => {
    if (!m || !m.pid) return;
    const screenId = screenOfPlay(m.pid);
    const s = screenId && screens.get(screenId);
    if (!s || (s.state !== 'playing' && s.state !== 'countdown')) return;
    io.to(screenId).volatile.emit('aim', { x: clamp(m.x, 0, 1), y: clamp(m.y, 0, 1), s: !!m.s });
  });
  // perubahan warna & selesai dikirim tidak-volatile supaya tidak hilang
  socket.on('color', (m) => {
    if (!m || !m.pid) return;
    const screenId = screenOfPlay(m.pid);
    if (screenId) io.to(screenId).emit('color', { c: String(m.c || '').slice(0, 12) });
  });
  socket.on('finish', (m) => {
    if (!m || !m.pid || !db.settings.allowFinishEarly) return;
    const screenId = screenOfPlay(m.pid);
    const s = screenId && screens.get(screenId);
    if (s && s.state === 'playing') io.to(screenId).emit('game:finishReq');
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
