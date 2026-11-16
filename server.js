// IMOS · Ichiban Paint Motobuilt — satu server untuk semua game.
// Setiap game berjalan di jalurnya sendiri (mis. /drag-race/tv, /drag-race/admin)
// dengan data, pengaturan, password admin dan koneksi realtime masing-masing,
// sehingga keempatnya bisa dimainkan bersamaan di TV yang berbeda.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');

// ---------- Konfigurasi ----------
const CONFIG_FILE = path.join(__dirname, 'config.json');
let fileCfg = {};
try { fileCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {
  if (fs.existsSync(CONFIG_FILE)) console.warn('PERINGATAN: config.json tidak bisa dibaca (' + e.message + '), memakai pengaturan bawaan.');
}
const appCfg = fileCfg.apps || {};

const PORT = Number(process.env.PORT) || Number(fileCfg.port) || 3000;
const DEFAULT_PW = process.env.ADMIN_PASSWORD || fileCfg.adminPassword || 'admin123';
const SUPER_PW = process.env.SUPER_ADMIN_PASSWORD || fileCfg.superAdminPassword || DEFAULT_PW;
const DATA_ROOT = path.resolve(__dirname, process.env.DATA_DIR || fileCfg.dataDir || 'data');

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}
const PUBLIC_URL = (process.env.PUBLIC_URL || fileCfg.publicUrl || `http://${lanAddress()}:${PORT}`).replace(/\/$/, '');

// Daftar game. "slug" = alamat di website (mis. /drag-race).
const APPS = [
  { slug: 'spin-wheel', dir: 'spin-wheel', env: 'SPIN_WHEEL', name: 'Spin Wheel', tagline: 'Putar roda, menangkan hadiah', color: '#f1c40f',
    desc: 'Peserta scan QR, isi data, lalu memutar roda dari HP. TV ikut berputar dengan hasil yang sama.', leaderboard: false },
  { slug: 'ichiban-run', dir: 'ichiban-run', env: 'ICHIBAN_RUN', name: 'Ichiban Run', tagline: 'Lompat & lari sejauh-jauhnya', color: '#ff7a1a',
    desc: 'HP jadi stik UP/DOWN. Kaleng Ichiban melompati rintangan, skor dari jarak tempuh.', leaderboard: true },
  { slug: 'spray-paint', dir: 'spray-paint', env: 'SPRAY_PAINT', name: 'Spray Paint Challenge', tagline: 'Cat motor paling rata menang', color: '#22c3ff',
    desc: 'HP jadi kaleng semprot. Cat motor di layar TV serata mungkin tanpa meleber.', leaderboard: true },
  { slug: 'drag-race', dir: 'drag-race', env: 'DRAG_RACE', name: 'Drag Race Reaction', tagline: 'Tunggu hijau, GAS, oper gigi!', color: '#d71920',
    desc: 'Duel 1 lawan 1 atau solo. HP jadi gas dan tuas gigi, adu reaksi di lampu start.', leaderboard: true },
];

// ---------- Server ----------
const root = express();
const server = http.createServer(root);
root.disable('x-powered-by');

const mounted = [];
for (const a of APPS) {
  const c = appCfg[a.slug] || {};
  if (c.enabled === false) { console.log(`(${a.name} dimatikan di config.json)`); continue; }
  const base = '/' + a.slug;
  const mount = require(path.join(__dirname, 'apps', a.dir, 'server.js'));
  const inst = mount({
    server,
    base,
    port: PORT,
    baseUrl: PUBLIC_URL + base,
    dataDir: path.join(DATA_ROOT, a.slug),
    adminPassword: process.env[a.env + '_ADMIN_PASSWORD'] || c.adminPassword || DEFAULT_PW,
  });
  root.use(base, inst.app);
  mounted.push({ ...a, base, inst });
}

root.use(express.json());
root.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
root.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const appInfo = (a) => ({
  slug: a.slug, name: a.name, tagline: a.tagline, desc: a.desc, color: a.color, leaderboard: a.leaderboard,
  tv: a.base + '/tv', admin: a.base + '/admin', board: a.leaderboard ? a.base + '/leaderboard' : null,
  tvUrl: PUBLIC_URL + a.base + '/tv',
});

// Data untuk halaman depan (tanpa password)
root.get('/api/hub/apps', (_req, res) => res.json({ publicUrl: PUBLIC_URL, apps: mounted.map(appInfo) }));

// Super-admin: ringkasan semua game
root.get('/api/hub/status', async (req, res) => {
  if (req.get('x-admin-password') !== SUPER_PW) return res.status(401).json({ error: 'Password super-admin salah' });
  const apps = [];
  for (const a of mounted) {
    let s = {};
    try { s = a.inst.summary(); } catch (e) { s = { error: e.message }; }
    const qr = await QRCode.toDataURL(PUBLIC_URL + a.base + '/tv', { margin: 1, width: 220 });
    apps.push({ ...appInfo(a), ...s, qr, sockets: a.inst.io.engine.clientsCount });
  }
  res.json({ publicUrl: PUBLIC_URL, uptime: Math.round(process.uptime()), apps });
});

// Pengaman: kalau ada halaman yang masih meminta file dari akar website
// (mis. /uploads/logo.png), arahkan ke game yang membukanya berdasarkan Referer.
root.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const ref = req.get('referer') || '';
  const hit = mounted.find((a) => { try { return new URL(ref).pathname.startsWith(a.base + '/'); } catch { return false; } });
  if (hit && /^\/(uploads|img|tpl|sfx)\//.test(req.path)) return res.redirect(307, hit.base + req.url);
  next();
});

root.use((_req, res) => res.status(404).send('<meta name=viewport content="width=device-width"><body style="font-family:system-ui;background:#0b0d16;color:#fff;text-align:center;padding:15vh 20px"><h1>Halaman tidak ditemukan</h1><p><a style="color:#ffc400" href="/">Kembali ke menu game</a></p>'));

server.listen(PORT, '0.0.0.0', () => {
  const pwNote = (p) => (p === 'admin123' ? 'admin123 (bawaan, sebaiknya diganti)' : '(dari config.json / env)');
  console.log('\n=== IMOS · Ichiban Paint Motobuilt — Game Center ===');
  console.log(`Menu semua game : ${PUBLIC_URL}/`);
  console.log(`Super-admin     : ${PUBLIC_URL}/admin   password: ${pwNote(SUPER_PW)}`);
  for (const a of mounted) {
    console.log(`\n  ${a.name}`);
    console.log(`    Layar TV  : ${PUBLIC_URL}${a.base}/tv`);
    console.log(`    Admin     : ${PUBLIC_URL}${a.base}/admin`);
    if (a.leaderboard) console.log(`    Papan skor: ${PUBLIC_URL}${a.base}/leaderboard`);
  }
  console.log('\nPastikan HP peserta terhubung ke Wi-Fi yang sama dengan laptop ini.\n');
});
