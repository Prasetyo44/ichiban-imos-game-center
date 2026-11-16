module.exports = function mountApp(opts) {
// Spin Wheel QR - server
// Hasil putaran SELALU ditentukan di server, lalu dikirim ke HP dan TV
// sehingga animasi dan hasilnya sama persis.

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
fs.mkdirSync(opts.dataDir, { recursive: true });
const DATA_FILE = path.join(opts.dataDir, 'data.json');
const SPIN_DURATION_MS = 7000;   // lama animasi putaran
const RESULT_HOLD_MS = 10000;    // lama hasil tampil di TV sebelum QR baru muncul
const FORM_TIMEOUT_MS = 3 * 60 * 1000; // TV kembali ke QR kalau peserta tidak lanjut

// ---------- Penyimpanan data (file JSON sederhana) ----------
const DEFAULT_DATA = {
  settings: {
    title: 'Spin & Menang!',
    onePerPhone: true,
  },
  prizes: [
    { id: 'p1', name: 'Voucher 50rb', color: '#e63946', weight: 10, stock: null, isWin: true },
    { id: 'p2', name: 'Coba Lagi', color: '#457b9d', weight: 40, stock: null, isWin: false },
    { id: 'p3', name: 'Tumbler', color: '#f4a261', weight: 15, stock: 20, isWin: true },
    { id: 'p4', name: 'Zonk', color: '#2a9d8f', weight: 25, stock: null, isWin: false },
    { id: 'p5', name: 'Kaos', color: '#8e44ad', weight: 9, stock: 10, isWin: true },
    { id: 'p6', name: 'Grand Prize', color: '#f1c40f', weight: 1, stock: 1, isWin: true },
  ],
  // Hasil yang sudah diatur admin: { id, phone, prizeId, note, createdAt, usedAt }
  overrides: [],
  // Pengaturan "putaran berikutnya siapa pun pesertanya": prizeId atau null
  nextSpinPrizeId: null,
  participants: [],
};

function loadData() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { ...structuredClone(DEFAULT_DATA), ...raw, settings: { ...DEFAULT_DATA.settings, ...(raw.settings || {}) } };
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
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

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return 'localhost';
}
const BASE_URL = opts.baseUrl;

function publicPrizes() {
  return db.prizes.map(({ id, name, color }) => ({ id, name, color }));
}

function available(p) {
  return p.stock === null || p.stock === undefined || p.stock > 0;
}

// Menentukan hasil putaran di server.
function decidePrize(participant) {
  // 1) Hasil khusus untuk nomor HP ini
  const ov = db.overrides.find((o) => !o.usedAt && o.phone === participant.phone);
  if (ov) {
    const prize = db.prizes.find((p) => p.id === ov.prizeId);
    if (prize) {
      ov.usedAt = new Date().toISOString();
      return { prize, source: 'diatur-admin (nomor HP)' };
    }
  }
  // 2) Pengaturan "putaran berikutnya"
  if (db.nextSpinPrizeId) {
    const prize = db.prizes.find((p) => p.id === db.nextSpinPrizeId);
    db.nextSpinPrizeId = null;
    if (prize) return { prize, source: 'diatur-admin (putaran berikutnya)' };
  }
  // 3) Acak berdasarkan bobot peluang, hanya hadiah yang stoknya masih ada
  const pool = db.prizes.filter((p) => available(p) && Number(p.weight) > 0);
  const total = pool.reduce((s, p) => s + Number(p.weight), 0);
  if (!pool.length || total <= 0) {
    // fallback: hadiah non-menang pertama, atau segmen pertama
    return { prize: db.prizes.find((p) => !p.isWin) || db.prizes[0], source: 'fallback' };
  }
  let r = crypto.randomInt(0, 1_000_000) / 1_000_000 * total;
  for (const p of pool) {
    r -= Number(p.weight);
    if (r < 0) return { prize: p, source: 'acak' };
  }
  return { prize: pool[pool.length - 1], source: 'acak' };
}

// ---------- State layar TV ----------
// Setiap layar TV punya token QR sekali pakai.
// screens: socketId -> { token, state: 'qr'|'form'|'ready'|'spinning'|'result', participantId, timer }
const screens = new Map();
const tokens = new Map(); // token -> screenSocketId

async function showNewQr(screenId) {
  const s = screens.get(screenId);
  if (!s) return;
  clearTimeout(s.timer);
  if (s.token) tokens.delete(s.token);
  const roundEnded = !!s.participantId; // ada peserta sebelumnya = satu putaran selesai / batal
  s.token = uid(6);
  s.state = 'qr';
  s.participantId = null;
  if (roundEnded && opts.onRoundEnd) opts.onRoundEnd(screenId);
  tokens.set(s.token, screenId);
  const url = `${BASE_URL}/play?t=${s.token}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 600 });
  io.to(screenId).emit('screen:qr', { qr, url, title: db.settings.title, prizes: publicPrizes() });
}

function screenOfParticipant(pid) {
  for (const [id, s] of screens) if (s.participantId === pid) return id;
  return null;
}

// ---------- HTTP ----------
const app = express();
const server = opts.server;
const io = new Server(server, { path: opts.base + '/socket.io', destroyUpgrade: false });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.redirect(opts.base + '/tv'));
app.get('/tv', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

function requireAdmin(req, res, next) {
  if (req.get('x-admin-password') === ADMIN_PASSWORD || req.query.pw === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Password admin salah' });
}

app.get('/api/admin/state', requireAdmin, (_req, res) => {
  res.json({ ...db, baseUrl: BASE_URL, screens: screens.size });
});

app.put('/api/admin/prizes', requireAdmin, (req, res) => {
  const list = Array.isArray(req.body.prizes) ? req.body.prizes : null;
  if (!list || list.length < 2) return res.status(400).json({ error: 'Minimal 2 hadiah/segmen' });
  db.prizes = list.map((p) => ({
    id: p.id || 'p' + uid(3),
    name: String(p.name || '').trim().slice(0, 40) || 'Hadiah',
    color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#888888',
    weight: Math.max(0, Number(p.weight) || 0),
    stock: p.stock === '' || p.stock === null || p.stock === undefined ? null : Math.max(0, parseInt(p.stock, 10) || 0),
    isWin: !!p.isWin,
  }));
  save();
  io.emit('prizes', publicPrizes());
  res.json({ ok: true, prizes: db.prizes });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { title, onePerPhone } = req.body || {};
  if (typeof title === 'string') db.settings.title = title.slice(0, 60);
  if (typeof onePerPhone === 'boolean') db.settings.onePerPhone = onePerPhone;
  save();
  for (const [id, s] of screens) if (s.state === 'qr') showNewQr(id);
  res.json({ ok: true, settings: db.settings });
});

app.post('/api/admin/overrides', requireAdmin, (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const prizeId = req.body.prizeId;
  if (phone.length < 8) return res.status(400).json({ error: 'Nomor HP tidak valid' });
  if (!db.prizes.some((p) => p.id === prizeId)) return res.status(400).json({ error: 'Hadiah tidak ditemukan' });
  // hapus pengaturan lama yang belum terpakai untuk nomor ini
  db.overrides = db.overrides.filter((o) => !(o.phone === phone && !o.usedAt));
  db.overrides.push({ id: uid(4), phone, prizeId, note: String(req.body.note || '').slice(0, 80), createdAt: new Date().toISOString(), usedAt: null });
  save();
  res.json({ ok: true });
});

app.delete('/api/admin/overrides/:id', requireAdmin, (req, res) => {
  db.overrides = db.overrides.filter((o) => o.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.put('/api/admin/next-spin', requireAdmin, (req, res) => {
  const id = req.body.prizeId || null;
  if (id && !db.prizes.some((p) => p.id === id)) return res.status(400).json({ error: 'Hadiah tidak ditemukan' });
  db.nextSpinPrizeId = id;
  save();
  res.json({ ok: true });
});

app.delete('/api/admin/participants/:id', requireAdmin, (req, res) => {
  db.participants = db.participants.filter((p) => p.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  db.participants = [];
  if (req.body && req.body.overrides) db.overrides = [];
  save();
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', requireAdmin, (_req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Waktu Daftar', 'Nama', 'No HP', 'Alamat', 'Hadiah', 'Menang', 'Sumber Hasil', 'Waktu Putar']];
  for (const p of db.participants) {
    rows.push([p.createdAt, p.name, "'" + p.phone, p.address, p.prizeName || '', p.prizeName ? (p.isWin ? 'Ya' : 'Tidak') : '', p.source || '', p.spunAt || '']);
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="peserta-spin-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  // Layar TV / laptop
  socket.on('screen:hello', () => {
    screens.set(socket.id, { token: null, state: 'qr', participantId: null, timer: null });
    showNewQr(socket.id);
  });

  // HP peserta membuka link dari QR
  socket.on('play:check', ({ token, pid }, cb) => {
    // Peserta yang me-refresh halaman setelah daftar
    if (pid) {
      const p = db.participants.find((x) => x.id === pid);
      const screenId = p && screenOfParticipant(p.id);
      if (p && !p.spunAt && screenId) {
        socket.join('p:' + p.id);
        return cb({ ok: true, stage: 'wheel', participant: { name: p.name }, prizes: publicPrizes(), title: db.settings.title });
      }
      if (p && p.spunAt) {
        return cb({ ok: true, stage: 'done', participant: { name: p.name }, result: { name: p.prizeName, isWin: p.isWin }, title: db.settings.title });
      }
    }
    const screenId = tokens.get(token);
    if (!screenId) return cb({ ok: false, error: 'QR sudah kedaluwarsa atau sedang dipakai peserta lain. Silakan scan QR terbaru di layar.' });
    const s = screens.get(screenId);
    if (s.state === 'qr') {
      s.state = 'form';
      io.to(screenId).emit('screen:form');
      clearTimeout(s.timer);
      s.timer = setTimeout(() => s.state === 'form' && showNewQr(screenId), FORM_TIMEOUT_MS);
    }
    cb({ ok: true, stage: 'form', title: db.settings.title });
  });

  socket.on('play:register', ({ token, name, phone, address }, cb) => {
    const screenId = tokens.get(token);
    const s = screenId && screens.get(screenId);
    if (!s || !['qr', 'form'].includes(s.state)) return cb({ ok: false, error: 'Sesi sudah berakhir. Silakan scan ulang QR di layar.' });
    name = String(name || '').trim().slice(0, 60);
    address = String(address || '').trim().slice(0, 200);
    const nphone = normalizePhone(phone);
    if (name.length < 2) return cb({ ok: false, error: 'Nama wajib diisi' });
    if (nphone.length < 9 || nphone.length > 14) return cb({ ok: false, error: 'Nomor HP tidak valid' });
    if (address.length < 3) return cb({ ok: false, error: 'Alamat wajib diisi' });
    if (db.settings.onePerPhone && db.participants.some((p) => p.phone === nphone && p.spunAt)) {
      return cb({ ok: false, error: 'Nomor HP ini sudah pernah ikut spin. Terima kasih!' });
    }
    const p = { id: uid(8), name, phone: nphone, address, createdAt: new Date().toISOString(), prizeId: null, prizeName: null, isWin: null, source: null, spunAt: null };
    db.participants.unshift(p);
    save();
    // token terpakai: tidak bisa dipakai HP lain
    tokens.delete(token);
    s.token = null;
    s.state = 'ready';
    s.participantId = p.id;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => s.state === 'ready' && showNewQr(screenId), FORM_TIMEOUT_MS);
    socket.join('p:' + p.id);
    io.to(screenId).emit('screen:ready', { name: p.name, prizes: publicPrizes(), title: db.settings.title });
    io.to('admin').emit('admin:refresh');
    cb({ ok: true, pid: p.id, participant: { name: p.name }, prizes: publicPrizes() });
  });

  socket.on('play:spin', ({ pid }, cb) => {
    const p = db.participants.find((x) => x.id === pid);
    const screenId = p && screenOfParticipant(p.id);
    const s = screenId && screens.get(screenId);
    if (!p || p.spunAt) return cb && cb({ ok: false, error: 'Kesempatan spin sudah dipakai.' });
    if (!s || s.state !== 'ready') return cb && cb({ ok: false, error: 'Layar tidak siap. Silakan scan ulang QR.' });

    const { prize, source } = decidePrize(p);
    if (prize.stock !== null && prize.stock !== undefined && prize.stock > 0) prize.stock -= 1;
    Object.assign(p, { prizeId: prize.id, prizeName: prize.name, isWin: !!prize.isWin, source, spunAt: new Date().toISOString() });
    save();

    const index = db.prizes.findIndex((x) => x.id === prize.id);
    const payload = {
      index,
      count: db.prizes.length,
      turns: 6 + crypto.randomInt(0, 3),       // jumlah putaran penuh
      offset: crypto.randomInt(15, 86) / 100,  // posisi jarum di dalam segmen (0..1), sama di HP & TV
      duration: SPIN_DURATION_MS,
      prizes: publicPrizes(),
      result: { name: prize.name, isWin: !!prize.isWin, color: prize.color },
      name: p.name,
    };
    s.state = 'spinning';
    clearTimeout(s.timer);
    io.to(screenId).emit('spin', payload);
    io.to('p:' + p.id).emit('spin', payload);
    io.to('admin').emit('admin:refresh');
    cb && cb({ ok: true });

    s.timer = setTimeout(() => {
      s.state = 'result';
      s.timer = setTimeout(() => showNewQr(screenId), RESULT_HOLD_MS);
    }, SPIN_DURATION_MS);
  });

  socket.on('admin:join', (pw, cb) => {
    if (pw === ADMIN_PASSWORD) { socket.join('admin'); cb && cb(true); } else cb && cb(false);
  });

  socket.on('disconnect', () => {
    const s = screens.get(socket.id);
    if (s) {
      clearTimeout(s.timer);
      if (s.token) tokens.delete(s.token);
      screens.delete(socket.id);
    }
  });
});


// ---------- Ringkasan untuk halaman super-admin ----------
function __summary() {
  return { screens: screens.size, players: db.participants.length, played: db.participants.filter((p) => p.spunAt).length, title: db.settings.title };
}
return { app, io, summary: __summary };
};
