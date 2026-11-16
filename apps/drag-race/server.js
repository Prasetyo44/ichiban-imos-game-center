module.exports = function mountApp(opts) {
// Ichiban Drag Race - server
// Layar TV menampilkan lintasan drag, HP peserta menjadi dasbor + tombol GAS / OPER GIGI.
// Server mengatur QR sekali pakai per lajur, pendaftaran, jadwal lampu start,
// menghitung hasil balapan (simulasi yang sama dengan TV & HP), dan menyimpan skor.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const Sim = require('./public/sim.js');

const PORT = opts.port;
const ADMIN_PASSWORD = opts.adminPassword;
const DATA_DIR = opts.dataDir;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const FORM_TIMEOUT_MS = 3 * 60 * 1000;   // lajur kembali ke QR kalau peserta tidak selesai mengisi
const JOINED_TIMEOUT_MS = 2 * 60 * 1000; // ...atau tidak menekan SIAP
const SERVER_LAG_MS = 300;               // server menghitung hasil sedikit di belakang waktu nyata (menunggu tap yang masih di jalan)

// ---------- Pengaturan (semua bisa diubah di admin) ----------
// [tipe, default, min/opsi, max]
const SCHEMA = {
  // Branding
  title: ['str', 'ICHIBAN DRAG RACE', 60],
  subtitle: ['str', 'Tunggu lampu hijau, GAS, lalu oper gigi tepat di garis merah!', 140],
  footer: ['str', 'Ichiban Paint · Japan Technology', 120],
  primaryColor: ['color', '#d71920'],
  accentColor: ['color', '#ffc400'],
  lane1Name: ['str', 'LAJUR KIRI', 20],
  lane2Name: ['str', 'LAJUR KANAN', 20],
  lane1Color: ['color', '#e3262d'],
  lane2Color: ['color', '#1f7bff'],
  theme: ['enum', 'malam', ['siang', 'senja', 'malam']],
  showBillboards: ['bool', true],
  logo: ['str', '', 300],
  // Mode
  mode: ['enum', 'duel', ['duel', 'solo']],
  challengerWaitSec: ['int', 30, 0, 600],  // duel: lama menunggu penantang setelah peserta pertama SIAP (0 = tunggu terus)
  allowSoloStart: ['bool', true],          // duel: peserta boleh tekan "Balap sendiri" tanpa menunggu
  // Lampu start
  stageSec: ['num', 2.5, 0.5, 10],
  treeType: ['enum', 'standar', ['standar', 'pro']],
  amberMs: ['int', 500, 200, 1500],
  randomMinMs: ['int', 200, 0, 5000],
  randomMaxMs: ['int', 1500, 0, 8000],
  treeOnPhone: ['bool', true],
  falseStartRule: ['enum', 'penalti', ['penalti', 'diskualifikasi']],
  falseStartPenaltySec: ['num', 1, 0, 10],
  autoLaunchSec: ['num', 3, 1, 15],
  // Motor & lintasan
  trackM: ['int', 201, 50, 1000],
  gears: ['int', 5, 2, 6],
  topKmh: ['int', 190, 60, 400],
  power: ['int', 100, 40, 300],
  redline: ['int', 12000, 4000, 20000],
  shiftMs: ['int', 90, 0, 600],
  perfectFromPct: ['num', 92, 50, 100],
  goodFromPct: ['num', 82, 30, 100],
  limiterGraceMs: ['int', 120, 0, 2000],
  maxRaceSec: ['int', 30, 10, 120],
  // Skor
  reactPtsMax: ['int', 1000, 0, 100000],
  reactZeroSec: ['num', 1, 0.2, 5],
  shiftPerfectPts: ['int', 300, 0, 100000],
  shiftGoodPts: ['int', 150, 0, 100000],
  timePtsMax: ['int', 5000, 0, 1000000],
  winBonus: ['int', 500, 0, 100000],
  // Alur
  resultHoldSec: ['int', 15, 3, 120],
  askPhone: ['bool', true],
  extraFieldLabel: ['str', '', 40],
  playsPerPhone: ['int', 0, 0, 100],
  leaderboardSize: ['int', 10, 3, 50],
  keyboardOnTv: ['bool', true],
  // Suara
  sound: ['bool', true],
  volMaster: ['int', 85, 0, 100],
  volMusic: ['int', 45, 0, 100],
  volEngine: ['int', 80, 0, 100],
  volSfx: ['int', 85, 0, 100],
  volCrowd: ['int', 60, 0, 100],
  musicOn: ['bool', true],
  musicFile: ['str', '', 300],          // kosong = musik bawaan
  phoneSound: ['bool', true],
  volPhone: ['int', 70, 0, 100],
};
const DEFAULT_SETTINGS = Object.fromEntries(Object.entries(SCHEMA).map(([k, v]) => [k, v[1]]));
const SIM_KEYS = ['trackM', 'gears', 'topKmh', 'power', 'redline', 'shiftMs', 'perfectFromPct', 'goodFromPct', 'limiterGraceMs',
  'falseStartRule', 'falseStartPenaltySec', 'autoLaunchSec', 'reactPtsMax', 'reactZeroSec', 'shiftPerfectPts', 'shiftGoodPts', 'timePtsMax'];

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
  if (out.randomMaxMs < out.randomMinMs) out.randomMaxMs = out.randomMinMs;
  if (out.goodFromPct > out.perfectFromPct) out.goodFromPct = out.perfectFromPct;
  return out;
}

// ---------- Penyimpanan data (file JSON sederhana) ----------
function loadData() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  return {
    settings: cleanSettings(raw.settings || {}, DEFAULT_SETTINGS),
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
function maskPhone(p) { return !p ? '' : p.length > 7 ? p.slice(0, 4) + '****' + p.slice(-3) : p; }
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return 'localhost';
}
const BASE_URL = opts.baseUrl;

function simConfig() {
  const s = db.settings;
  return Object.fromEntries(SIM_KEYS.map((k) => [k, s[k]]));
}
let bestCache = { key: '', best: 0 };
function bestTime() {
  const cfg = simConfig();
  const key = JSON.stringify(cfg);
  if (bestCache.key !== key) bestCache = { key, best: Sim.bestTime(cfg) };
  return bestCache.best;
}

function branding() {
  const s = db.settings;
  const keys = ['title', 'subtitle', 'footer', 'primaryColor', 'accentColor', 'lane1Name', 'lane2Name', 'lane1Color', 'lane2Color', 'theme',
    'showBillboards', 'logo', 'mode', 'keyboardOnTv', 'sound', 'volMaster', 'volMusic', 'volEngine', 'volSfx', 'volCrowd', 'musicOn',
    'phoneSound', 'volPhone', 'treeOnPhone', 'redline', 'gears', 'trackM', 'perfectFromPct', 'goodFromPct'];
  return { ...Object.fromEntries(keys.map((k) => [k, s[k]])), music: s.musicFile || 'sfx/music.mp3' };
}

const fmt = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);

// Papan skor: skor terbaik per peserta
function leaderboard(limit = db.settings.leaderboardSize) {
  const best = new Map();
  for (const p of db.plays) {
    if (p.score === null || p.score === undefined || p.test) continue;
    const key = p.phone || 'n:' + p.name.toLowerCase();
    const cur = best.get(key);
    if (!cur || p.score > cur.score || (p.score === cur.score && (p.total ?? 99) < (cur.total ?? 99))) best.set(key, p);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || (a.total ?? 99) - (b.total ?? 99) || a.playedAt.localeCompare(b.playedAt))
    .slice(0, limit)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, phone: maskPhone(p.phone), score: p.score, rt: p.rt, et: p.et, total: p.total, topKmh: p.topKmh, dq: p.dq }));
}
function rankOf(play) {
  const i = leaderboard(100000).findIndex((r) => r.id === play.id);
  return i >= 0 ? i + 1 : null;
}

// ---------- Layar TV ----------
// screen: { state: 'lobby'|'race'|'over', lanes: [lane, lane], timer, waitTimer, waitUntil, race }
// lane:   { token, stage: 'open'|'form'|'joined'|'ready'|'off', playId, timer, qr, url }
const screens = new Map();
const tokens = new Map(); // token -> { screenId, lane }

function newLane() { return { token: null, stage: 'open', playId: null, timer: null, qr: null, url: null }; }

async function openLane(screenId, i) {
  const s = screens.get(screenId);
  if (!s) return;
  const L = s.lanes[i];
  clearTimeout(L.timer);
  if (L.token) tokens.delete(L.token);
  if (db.settings.mode === 'solo' && i === 1) { Object.assign(L, newLane(), { stage: 'off' }); return; }
  L.token = uid(6);
  L.stage = 'open';
  L.playId = null;
  L.url = `${BASE_URL}/play?t=${L.token}`;
  L.qr = await QRCode.toDataURL(L.url, { margin: 1, width: 520 });
  tokens.set(L.token, { screenId, lane: i });
}

function playOf(id) { return id ? db.plays.find((x) => x.id === id) : null; }

function lobbyPayload(s) {
  return {
    branding: branding(),
    leaderboard: leaderboard(),
    waitUntil: s.waitUntil || null,
    lanes: s.lanes.map((L) => {
      const p = playOf(L.playId);
      return { stage: L.stage, qr: L.stage === 'open' ? L.qr : null, url: L.stage === 'open' ? L.url : null, name: p ? p.name : null };
    }),
  };
}
function pushLobby(screenId) {
  const s = screens.get(screenId);
  if (!s || s.state !== 'lobby') return;
  io.to(screenId).emit('screen:lobby', lobbyPayload(s));
  // HP yang sudah SIAP mendapat info penantang
  s.lanes.forEach((L, i) => {
    if (L.playId) {
      const other = s.lanes[1 - i];
      const op = playOf(other.playId);
      io.to('p:' + L.playId).emit('lobby', { stage: L.stage, waitUntil: s.waitUntil || null, opponent: op ? op.name : null, opponentStage: other.stage, serverNow: Date.now() });
    }
  });
  broadcastAdmin();
}

async function resetScreen(screenId) {
  const s = screens.get(screenId);
  if (!s) return;
  clearTimeout(s.timer); clearTimeout(s.waitTimer);
  s.state = 'lobby'; s.race = null; s.waitUntil = null; s.graceUsed = false;
  await Promise.all([openLane(screenId, 0), openLane(screenId, 1)]);
  pushLobby(screenId);
}

function screenOfPlay(playId) {
  for (const [id, s] of screens) if (s.lanes.some((L) => L.playId === playId)) return id;
  return null;
}
function laneOfPlay(s, playId) { return s.lanes.findIndex((L) => L.playId === playId); }

function screensSummary() {
  return [...screens.values()].map((s) => ({
    state: s.state,
    lanes: s.lanes.map((L) => ({ stage: L.stage, name: playOf(L.playId)?.name || null })),
  }));
}
let adminTimer = null;
function broadcastAdmin() {
  clearTimeout(adminTimer);
  adminTimer = setTimeout(() => io.to('admin').emit('admin:refresh'), 200);
}

// Lajur yang tidak jadi ikut balapan: hapus data yang belum selesai dan kabari HP-nya
function dropLane(screenId, i, msg) {
  const s = screens.get(screenId);
  const L = s.lanes[i];
  if (L.playId) {
    const p = playOf(L.playId);
    if (p && p.score === null) db.plays = db.plays.filter((x) => x !== p);
    io.to('p:' + L.playId).emit('lane:dropped', { message: msg });
    save();
  }
  if (L.token) tokens.delete(L.token);
  clearTimeout(L.timer);
  Object.assign(L, newLane(), { stage: 'off' });
}

// Cek apakah balapan bisa dimulai
function evaluateStart(screenId, forceNow = false) {
  const s = screens.get(screenId);
  if (!s || s.state !== 'lobby') return;
  const ready = s.lanes.filter((L) => L.stage === 'ready');
  if (!ready.length) { clearTimeout(s.waitTimer); s.waitUntil = null; return; }
  const st = db.settings;
  const others = s.lanes.filter((L) => L.stage !== 'ready' && L.stage !== 'off');
  const busyOthers = others.filter((L) => L.stage === 'form' || L.stage === 'joined');
  if (st.mode === 'solo' || !others.length || forceNow) return startRace(screenId);
  if (st.challengerWaitSec > 0 && !s.waitUntil) {
    s.waitUntil = Date.now() + st.challengerWaitSec * 1000;
    clearTimeout(s.waitTimer);
    s.waitTimer = setTimeout(() => onWaitExpired(screenId), st.challengerWaitSec * 1000);
  }
  if (busyOthers.length && s.waitUntil && s.waitUntil - Date.now() < 15000) {
    // penantang sedang mengisi data: beri tambahan waktu sekali
    if (!s.graceUsed) {
      s.graceUsed = true; s.waitUntil = Date.now() + 25000;
      clearTimeout(s.waitTimer); s.waitTimer = setTimeout(() => onWaitExpired(screenId), 25000);
    }
  }
}
function onWaitExpired(screenId) {
  const s = screens.get(screenId);
  if (!s || s.state !== 'lobby') return;
  const busy = s.lanes.some((L) => L.stage === 'form' || L.stage === 'joined');
  if (busy && !s.graceUsed) {
    s.graceUsed = true; s.waitUntil = Date.now() + 20000;
    s.waitTimer = setTimeout(() => onWaitExpired(screenId), 20000);
    return pushLobby(screenId);
  }
  startRace(screenId);
}

// ---------- Balapan ----------
function startRace(screenId, opts = {}) {
  const s = screens.get(screenId);
  const st = db.settings;
  clearTimeout(s.waitTimer); s.waitUntil = null;
  // lajur yang belum SIAP tidak ikut
  s.lanes.forEach((L, i) => { if (L.stage !== 'ready' && L.stage !== 'off') dropLane(screenId, i, 'Balapan sudah dimulai tanpa kamu. Scan QR berikutnya untuk menantang!'); });
  for (const L of s.lanes) { if (L.token) tokens.delete(L.token); L.token = null; clearTimeout(L.timer); }
  const cfg = simConfig();
  const best = bestTime();
  const now = Date.now();
  const t0 = now + 1800;
  const stageAt = t0 + (st.stageSec * 1000) / 2;
  const amberStart = t0 + st.stageSec * 1000;
  const ambers = st.treeType === 'pro' ? [amberStart, amberStart, amberStart] : [amberStart, amberStart + st.amberMs, amberStart + 2 * st.amberMs];
  const rand = st.randomMinMs + crypto.randomInt(0, Math.max(1, st.randomMaxMs - st.randomMinMs + 1));
  const greenAt = (st.treeType === 'pro' ? amberStart + 400 : ambers[2] + st.amberMs) + rand;
  const lanes = s.lanes.map((L, i) => {
    if (L.stage !== 'ready') return null;
    const p = playOf(L.playId);
    return { lane: i, playId: p.id, name: p.name, test: !!p.test, racer: new Sim.Racer(cfg), taps: [], done: false };
  });
  s.state = 'race';
  s.race = { id: uid(4), cfg, best, t0, stageAt, ambers, greenAt, lanes, test: !!opts.test, endAt: greenAt + st.maxRaceSec * 1000 };
  const payload = raceInfo(s.race);
  io.to(screenId).emit('race:start', payload);
  for (const ln of lanes) if (ln) io.to('p:' + ln.playId).emit('race:start', { ...payload, myLane: ln.lane });
  clearTimeout(s.timer);
  s.timer = setInterval(() => raceTick(screenId), 100);
  broadcastAdmin();
}
function raceInfo(r) {
  return {
    raceId: r.id, cfg: r.cfg, best: r.best, t0: r.t0, stageAt: r.stageAt, ambers: r.ambers, greenAt: r.greenAt, endAt: r.endAt, test: r.test,
    serverNow: Date.now(),
    lanes: r.lanes.map((l) => (l ? { lane: l.lane, name: l.name, taps: l.taps } : null)),
  };
}

function raceTick(screenId) {
  const s = screens.get(screenId);
  if (!s || s.state !== 'race') return;
  const r = s.race;
  const now = Date.now();
  const tSim = (now - SERVER_LAG_MS - r.greenAt) / 1000;
  let allDone = true;
  for (const ln of r.lanes) {
    if (!ln) continue;
    if (tSim > 0) ln.racer.advance(tSim);
    const st = ln.racer.s;
    ln.done = st.dq || st.finishT !== null;
    if (!ln.done) allDone = false;
  }
  if (allDone || now > r.endAt + SERVER_LAG_MS) finishRace(screenId);
}

function finishRace(screenId, reason) {
  const s = screens.get(screenId);
  if (!s || s.state !== 'race') return;
  clearInterval(s.timer);
  const r = s.race;
  const st = db.settings;
  const results = r.lanes.map((ln) => {
    if (!ln) return null;
    const res = ln.racer.result();
    const sc = Sim.score(r.cfg, res, r.best);
    return { lane: ln.lane, playId: ln.playId, name: ln.name, ...res, points: sc };
  });
  const active = results.filter(Boolean);
  // pemenang: yang sampai finish lebih dulu (waktu total sejak lampu hijau)
  let winner = null;
  if (active.length === 2) {
    const fin = active.filter((x) => x.finished && !x.dq).sort((a, b) => a.total - b.total);
    if (fin.length) winner = fin[0].lane;
  }
  for (const x of active) {
    const p = playOf(x.playId);
    x.win = winner === x.lane;
    x.score = x.points.total + (x.win && !x.dq ? st.winBonus : 0);
    if (!p) continue;
    const opp = active.find((o) => o !== x);
    Object.assign(p, {
      score: x.score, rt: fmt(x.rt), et: fmt(x.et), total: fmt(x.total), topKmh: x.topKmh, falseStart: x.falseStart, dq: x.dq,
      finished: x.finished, shifts: x.shifts.map((h) => h.grade), points: x.points, lane: x.lane,
      outcome: active.length === 1 ? 'solo' : x.win ? 'menang' : 'kalah', opponent: opp ? opp.name : '',
      playedAt: new Date().toISOString(), endReason: reason || '',
    });
  }
  save();
  for (const x of active) {
    const p = playOf(x.playId);
    x.rank = p && !p.test ? rankOf(p) : null;
    x.test = !!(p && p.test);
  }
  const lb = leaderboard();
  const payload = { results, winner, leaderboard: lb, holdSec: st.resultHoldSec, best: r.best, reason: reason || '' };
  s.state = 'over';
  io.to(screenId).emit('race:result', payload);
  for (const x of active) io.to('p:' + x.playId).emit('race:result', { ...payload, myLane: x.lane });
  s.timer = setTimeout(() => resetScreen(screenId), st.resultHoldSec * 1000 + 1500);
  for (const [id, sc] of screens) if (id !== screenId && sc.state === 'lobby') io.to(id).emit('leaderboard', lb);
  io.emit('leaderboard:update', lb);
  broadcastAdmin();
}

function acceptTap(screenId, laneIdx, t) {
  const s = screens.get(screenId);
  if (!s || s.state !== 'race') return;
  const r = s.race;
  const ln = r.lanes[laneIdx];
  if (!ln || ln.done) return;
  const now = Date.now();
  t = Number(t);
  if (!Number.isFinite(t)) t = now;
  t = Math.min(now, Math.max(now - 800, t));       // tap tidak boleh dari masa depan / terlalu lama
  if (t < r.stageAt) return;                        // sebelum lampu stage: diabaikan
  const tt = Math.round(((t - r.greenAt) / 1000) * 10000) / 10000;
  if (ln.taps.length >= 40) return;
  ln.taps.push(tt);
  ln.taps.sort((a, b) => a - b);
  ln.racer.setTaps(ln.taps);
  const msg = { lane: laneIdx, taps: ln.taps };
  io.to(screenId).emit('race:taps', msg);
  io.to('p:' + ln.playId).emit('race:taps', msg);
}

// ---------- HTTP ----------
const app = express();
const server = opts.server;
const io = new Server(server, { path: opts.base + '/socket.io', destroyUpgrade: false });

app.use(express.json({ limit: '20mb' }));
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
    settings: db.settings, defaults: DEFAULT_SETTINGS, plays: db.plays.slice(0, 1000), totalPlays: db.plays.length,
    leaderboard: leaderboard(), baseUrl: BASE_URL, screens: screensSummary(), bestTime: bestTime(),
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const prevMode = db.settings.mode;
  db.settings = cleanSettings(req.body || {}, db.settings);
  save();
  pushSettings(prevMode !== db.settings.mode);
  res.json({ ok: true, settings: db.settings, bestTime: bestTime() });
});

function pushSettings(reopen) {
  io.emit('branding', branding());
  for (const [id, s] of screens) {
    if (s.state !== 'lobby') continue;
    const idle = s.lanes.every((L) => L.stage === 'open' || L.stage === 'off');
    if (reopen && idle) resetScreen(id); else pushLobby(id);
  }
  broadcastAdmin();
}

function saveDataUrl(dataUrl, prefix, kind = 'image') {
  const re = kind === 'audio'
    ? /^data:audio\/(mpeg|mp3|ogg|wav|x-wav|wave|mp4|x-m4a|aac|webm);base64,(.+)$/
    : /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,(.+)$/;
  const m = re.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', 'svg+xml': 'svg', mpeg: 'mp3', mp3: 'mp3', ogg: 'ogg', wav: 'wav', 'x-wav': 'wav', wave: 'wav', mp4: 'm4a', 'x-m4a': 'm4a', aac: 'aac', webm: 'webm' }[m[1]];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > (kind === 'audio' ? 14 : 4) * 1024 * 1024) return null;
  const file = `${prefix}-${uid(4)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  return 'uploads/' + file;
}
function removeUpload(src) { if (src && src.replace(/^\//, '').startsWith('uploads/')) try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(src))); } catch {} }

app.post('/api/admin/logo', requireAdmin, (req, res) => {
  removeUpload(db.settings.logo);
  if (!req.body.dataUrl) { db.settings.logo = ''; save(); pushSettings(); return res.json({ ok: true }); }
  const src = saveDataUrl(req.body.dataUrl, 'logo');
  if (!src) return res.status(400).json({ error: 'File gambar tidak valid (PNG/JPG/WEBP, maks 4 MB)' });
  db.settings.logo = src; save(); pushSettings();
  res.json({ ok: true, logo: src });
});

app.post('/api/admin/music', requireAdmin, (req, res) => {
  removeUpload(db.settings.musicFile);
  if (!req.body.dataUrl) { db.settings.musicFile = ''; save(); pushSettings(); return res.json({ ok: true }); }
  const src = saveDataUrl(req.body.dataUrl, 'music', 'audio');
  if (!src) return res.status(400).json({ error: 'File musik tidak valid (MP3/OGG/WAV/M4A, maks 14 MB)' });
  db.settings.musicFile = src; save(); pushSettings();
  res.json({ ok: true, music: src });
});

app.delete('/api/admin/plays/:id', requireAdmin, (req, res) => {
  db.plays = db.plays.filter((p) => p.id !== req.params.id);
  save(); pushSettings();
  res.json({ ok: true });
});

app.post('/api/admin/reset', requireAdmin, (_req, res) => {
  db.plays = db.plays.filter((p) => screenOfPlay(p.id));
  save(); pushSettings();
  res.json({ ok: true });
});

app.post('/api/admin/settings/reset', requireAdmin, (_req, res) => {
  const keep = { logo: db.settings.logo, musicFile: db.settings.musicFile };
  const prevMode = db.settings.mode;
  db.settings = { ...DEFAULT_SETTINGS, ...keep };
  save(); pushSettings(prevMode !== db.settings.mode);
  res.json({ ok: true });
});

app.post('/api/admin/stop', requireAdmin, (_req, res) => {
  for (const [id, s] of screens) {
    if (s.state === 'race') finishRace(id, 'admin');
    else if (s.state === 'lobby') { s.lanes.forEach((L, i) => L.playId && dropLane(id, i, 'Sesi dibatalkan oleh panitia. Silakan scan ulang QR.')); resetScreen(id); }
  }
  res.json({ ok: true });
});

// Mulai paksa: balapan langsung dimulai dengan peserta yang sudah SIAP
app.post('/api/admin/force-start', requireAdmin, (_req, res) => {
  let n = 0;
  for (const [id, s] of screens) if (s.state === 'lobby' && s.lanes.some((L) => L.stage === 'ready')) { startRace(id); n++; }
  if (!n) return res.status(400).json({ error: 'Belum ada peserta yang menekan SIAP' });
  res.json({ ok: true });
});

// Uji coba di TV dengan keyboard (lajur kiri: tombol A / Spasi, lajur kanan: tombol L / Enter)
app.post('/api/admin/test-race', requireAdmin, (req, res) => {
  const entry = [...screens.entries()].find(([, s]) => s.state === 'lobby' && s.lanes.every((L) => L.stage === 'open' || L.stage === 'off'));
  if (!entry) return res.status(400).json({ error: 'Tidak ada layar TV yang sedang kosong (menampilkan QR)' });
  const [screenId, s] = entry;
  const lanes = db.settings.mode === 'solo' || req.body.solo ? [0] : [0, 1];
  s.lanes.forEach((L, i) => {
    if (L.token) tokens.delete(L.token);
    if (!lanes.includes(i)) { Object.assign(L, newLane(), { stage: 'off' }); return; }
    const p = { id: uid(8), name: 'Uji Coba ' + (i + 1), phone: '', extra: '', test: true, createdAt: new Date().toISOString(), score: null, playedAt: null };
    db.plays.unshift(p);
    Object.assign(L, { token: null, stage: 'ready', playId: p.id });
  });
  save();
  startRace(screenId, { test: true });
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', requireAdmin, (_req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const extra = db.settings.extraFieldLabel || 'Data Tambahan';
  const lb = new Map(leaderboard(100000).map((r) => [r.id, r.rank]));
  const n3 = (x) => (x === null || x === undefined ? '' : Number(x).toFixed(3));
  const rows = [['Waktu Daftar', 'Uji Coba', 'Nama', 'No HP', extra, 'Skor', 'Reaksi (detik)', 'Waktu Tempuh/ET (detik)', 'Total (detik)', 'Top Speed (km/j)',
    'False Start', 'Diskualifikasi', 'Oper Gigi', 'Hasil', 'Lawan', 'Peringkat', 'Waktu Main']];
  for (const p of db.plays) {
    rows.push([p.createdAt, p.test ? 'Ya' : '', p.name, p.phone ? "'" + p.phone : '', p.extra, p.score ?? '', n3(p.rt), n3(p.et), n3(p.total), p.topKmh ?? '',
      p.falseStart ? 'Ya' : '', p.dq ? 'Ya' : '', (p.shifts || []).join(' '), p.outcome || '', p.opponent || '', lb.get(p.id) || '', p.playedAt || '']);
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="skor-drag-race-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  // sinkronisasi jam (HP & TV menghitung waktu server)
  socket.on('sync', (_c, cb) => typeof cb === 'function' && cb(Date.now()));

  // ----- Layar TV -----
  socket.on('screen:hello', () => {
    screens.set(socket.id, { state: 'lobby', lanes: [newLane(), newLane()], timer: null, waitTimer: null, waitUntil: null, race: null });
    socket.join(socket.id);
    resetScreen(socket.id);
  });

  socket.on('kb:tap', ({ lane, t } = {}) => {
    const s = screens.get(socket.id);
    if (!s || s.state !== 'race') return;
    if (!s.race.test && !db.settings.keyboardOnTv) return;
    if (!s.race.test) return; // keyboard hanya untuk balapan uji coba
    acceptTap(socket.id, lane === 1 ? 1 : 0, t);
  });

  // ----- HP peserta -----
  socket.on('play:check', ({ token, pid } = {}, cb = () => {}) => {
    const st = db.settings;
    const base = { branding: branding(), askPhone: st.askPhone, extraFieldLabel: st.extraFieldLabel };
    if (pid) {
      const p = playOf(pid);
      const screenId = p && screenOfPlay(p.id);
      const s = screenId && screens.get(screenId);
      if (p && p.score !== null && p.score !== undefined) {
        return cb({ ok: true, ...base, stage: 'done', name: p.name, result: { score: p.score, rt: p.rt, et: p.et, total: p.total, topKmh: p.topKmh, outcome: p.outcome, dq: p.dq, rank: rankOf(p) } });
      }
      if (p && s) {
        socket.join('p:' + p.id);
        const lane = laneOfPlay(s, p.id);
        const extra = { name: p.name, lane, serverNow: Date.now() };
        if (s.state === 'race' && s.race.lanes[lane]) return cb({ ok: true, ...base, ...extra, stage: 'race', race: { ...raceInfo(s.race), myLane: lane } });
        setTimeout(() => pushLobby(screenId), 50);
        return cb({ ok: true, ...base, ...extra, stage: s.lanes[lane].stage === 'ready' ? 'waiting' : 'ready' });
      }
    }
    const tk = tokens.get(token);
    if (!tk) return cb({ ok: false, ...base, error: 'QR sudah kedaluwarsa atau sedang dipakai peserta lain. Silakan scan QR terbaru di layar.' });
    const s = screens.get(tk.screenId);
    const L = s.lanes[tk.lane];
    if (L.stage === 'open') {
      L.stage = 'form';
      clearTimeout(L.timer);
      L.timer = setTimeout(() => { if (L.stage === 'form') openLane(tk.screenId, tk.lane).then(() => pushLobby(tk.screenId)); }, FORM_TIMEOUT_MS);
      pushLobby(tk.screenId);
      evaluateStart(tk.screenId);
    }
    cb({ ok: true, ...base, stage: 'form', lane: tk.lane });
  });

  socket.on('play:register', ({ token, name, phone, extra } = {}, cb = () => {}) => {
    const tk = tokens.get(token);
    const s = tk && screens.get(tk.screenId);
    const L = s && s.lanes[tk.lane];
    if (!s || s.state !== 'lobby' || !['open', 'form'].includes(L.stage)) return cb({ ok: false, error: 'Sesi sudah berakhir. Silakan scan ulang QR di layar.' });
    const st = db.settings;
    name = String(name || '').trim().slice(0, 40);
    extra = String(extra || '').trim().slice(0, 80);
    const nphone = st.askPhone ? normalizePhone(phone) : '';
    if (name.length < 2) return cb({ ok: false, error: 'Nama wajib diisi' });
    if (st.askPhone && (nphone.length < 9 || nphone.length > 14)) return cb({ ok: false, error: 'Nomor HP tidak valid' });
    if (st.extraFieldLabel && extra.length < 1) return cb({ ok: false, error: `${st.extraFieldLabel} wajib diisi` });
    if (st.askPhone && st.playsPerPhone > 0) {
      const used = db.plays.filter((p) => p.phone === nphone && p.score !== null && p.score !== undefined).length;
      if (used >= st.playsPerPhone) return cb({ ok: false, error: `Nomor HP ini sudah main ${used}x (batas ${st.playsPerPhone}x). Terima kasih sudah ikut!` });
    }
    if (st.askPhone) {
      const other = s.lanes[1 - tk.lane];
      const op = playOf(other.playId);
      if (op && op.phone === nphone) return cb({ ok: false, error: 'Nomor HP ini sudah dipakai di lajur sebelah.' });
    }
    const p = { id: uid(8), name, phone: nphone, extra, createdAt: new Date().toISOString(), score: null, playedAt: null };
    db.plays.unshift(p);
    save();
    tokens.delete(token);
    L.token = null; L.stage = 'joined'; L.playId = p.id;
    clearTimeout(L.timer);
    L.timer = setTimeout(() => {
      if (L.stage === 'joined' && s.state === 'lobby') { dropLane(tk.screenId, tk.lane, 'Waktu habis. Silakan scan ulang QR.'); openLane(tk.screenId, tk.lane).then(() => pushLobby(tk.screenId)); }
    }, JOINED_TIMEOUT_MS);
    socket.join('p:' + p.id);
    pushLobby(tk.screenId);
    evaluateStart(tk.screenId);
    cb({ ok: true, pid: p.id, name: p.name, lane: tk.lane, mode: st.mode });
  });

  socket.on('play:ready', ({ pid } = {}, cb = () => {}) => {
    const p = playOf(pid);
    const screenId = p && screenOfPlay(p.id);
    const s = screenId && screens.get(screenId);
    if (!p || (p.score !== null && p.score !== undefined)) return cb({ ok: false, error: 'Kesempatan main sudah dipakai.' });
    if (!s || s.state !== 'lobby') return cb({ ok: false, error: 'Layar tidak siap. Silakan scan ulang QR.' });
    const L = s.lanes[laneOfPlay(s, p.id)];
    L.stage = 'ready';
    clearTimeout(L.timer);
    cb({ ok: true, mode: db.settings.mode, allowSolo: db.settings.allowSoloStart });
    evaluateStart(screenId);
    pushLobby(screenId);
  });

  socket.on('play:solo', ({ pid } = {}, cb = () => {}) => {
    const p = playOf(pid);
    const screenId = p && screenOfPlay(p.id);
    const s = screenId && screens.get(screenId);
    if (!s || s.state !== 'lobby' || !db.settings.allowSoloStart) return cb({ ok: false });
    if (s.lanes[laneOfPlay(s, p.id)].stage !== 'ready') return cb({ ok: false });
    cb({ ok: true });
    evaluateStart(screenId, true);
  });

  socket.on('race:tap', ({ pid, t } = {}) => {
    const screenId = pid && screenOfPlay(pid);
    const s = screenId && screens.get(screenId);
    if (!s || s.state !== 'race') return;
    const lane = laneOfPlay(s, pid);
    if (lane >= 0) acceptTap(screenId, lane, t);
  });

  socket.on('leaderboard:join', () => socket.join('lb'));
  socket.on('admin:join', (pw, cb) => {
    if (pw === ADMIN_PASSWORD) { socket.join('admin'); cb && cb(true); } else cb && cb(false);
  });

  socket.on('disconnect', () => {
    const s = screens.get(socket.id);
    if (!s) return;
    clearTimeout(s.timer); clearInterval(s.timer); clearTimeout(s.waitTimer);
    s.lanes.forEach((L) => {
      clearTimeout(L.timer);
      if (L.token) tokens.delete(L.token);
      if (L.playId) {
        const p = playOf(L.playId);
        if (p && (p.score === null || p.score === undefined)) db.plays = db.plays.filter((x) => x !== p);
        io.to('p:' + L.playId).emit('screen:lost');
      }
    });
    save();
    screens.delete(socket.id);
    broadcastAdmin();
  });
});


// ---------- Ringkasan untuk halaman super-admin ----------
function __summary() {
  return { screens: screensSummary().length, players: db.plays.length, played: db.plays.filter((p) => p.score !== null && p.score !== undefined).length, title: (db.settings && (db.settings.title || db.settings.gameTitle)) || '' };
}
return { app, io, summary: __summary };
};
