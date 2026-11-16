> **Catatan (versi gabungan IMOS):** panduan ini berasal dari aplikasi Drag Race Reaction versi terpisah. Di versi gabungan, semua alamat halaman diawali `/drag-race`, misalnya `/drag-race/tv`, `/drag-race/admin`, `/drag-race/play`. Cara menjalankan, password dan lokasi data mengikuti README utama (satu `npm start` untuk semua game, password di `config.json`, data di `data/drag-race/`).

# Ichiban Drag Race — Game Reaksi Drag Bike

Game "challenge" untuk event/booth anak motor. Dua motor drag berjajar di garis start di layar TV.

- **Layar TV/laptop** menampilkan QR code tiap lajur, lampu start (christmas tree), balapan, dan papan skor.
- **HP peserta** jadi gas sekaligus tuas gigi: ada takometer, lampu shift, dan satu tombol besar.
  1. Lampu kuning menyala satu per satu, lalu **HIJAU** setelah jeda acak. Tap **GAS** secepatnya. Tap sebelum hijau = **FALSE START** (lampu merah).
  2. Tap **OPER GIGI** saat jarum RPM masuk **zona hijau**. Terlalu cepat = tenaga drop, telat = mentok limiter.
- **Mode duel 1 lawan 1** (dua HP, lajur kiri vs kanan) atau **solo** (melawan waktu).
- **Skor** = poin reaksi + poin oper gigi (PERFECT/BAGUS) + poin waktu tempuh (+ bonus menang duel).
- **Suara lengkap**: mesin motor yang mengikuti RPM (kiri/kanan stereo), bunyi lampu start, decit ban, letupan knalpot saat oper gigi, penonton bersorak, fanfare juara, dan musik latar. Semua tersimpan di dalam aplikasi, **tanpa internet**.
- **Panel admin** mengatur semua hal: mode, lampu start, aturan false start, tenaga motor, jumlah gigi, zona PERFECT, poin, branding, volume suara, upload musik sendiri, reset, dan ekspor CSV.

Semuanya berjalan di laptop lewat Wi-Fi lokal, tanpa install aplikasi di HP.

---

## 1. Cara menjalankan

1. Install **Node.js versi 18 atau lebih baru** dari https://nodejs.org (pilih versi LTS).
2. Ekstrak zip ini, lalu buka Terminal / Command Prompt di folder `ichiban-drag-race`.
3. Jalankan sekali saja:
   ```
   npm install
   ```
4. Jalankan game:
   ```
   npm start
   ```
5. Terminal menampilkan alamat seperti ini:
   ```
   Layar TV/Laptop : http://192.168.1.10:3000/tv
   Papan Skor      : http://192.168.1.10:3000/leaderboard
   Panel Admin     : http://192.168.1.10:3000/admin   (password: admin123)
   ```
6. Buka **/tv** di browser laptop yang tersambung ke TV (Chrome disarankan). Klik **⛶ Layar penuh** sekali, yang sekaligus **mengaktifkan suara** (browser mewajibkan satu klik sebelum suara boleh bunyi).
7. Pastikan **HP peserta tersambung ke Wi-Fi yang sama** dengan laptop, dan minta peserta menaikkan volume HP.

### Mengganti password admin
```
# Windows (Command Prompt)
set ADMIN_PASSWORD=rahasiaku && npm start

# Mac / Linux
ADMIN_PASSWORD=rahasiaku npm start
```
Variabel lain: `PORT` (default 3000), `PUBLIC_URL` (kalau dipasang di server online, mis. `https://drag.contoh.com`), `DATA_DIR` (folder penyimpanan data).

### Sound system
Sambungkan laptop ke speaker/sound system lewat HDMI atau kabel audio. Mesin lajur kiri terdengar di speaker kiri, lajur kanan di speaker kanan.

---

## 2. Alur bermain (mode duel)

1. TV menampilkan dua QR: **LAJUR KIRI** dan **LAJUR KANAN**.
2. Peserta 1 scan QR, isi nama + nomor HP, tekan **SIAP**. TV mulai hitung mundur menunggu penantang (default 30 detik).
3. Peserta 2 scan QR lajur sebelah dan tekan SIAP. Begitu keduanya siap, balapan langsung mulai.
   - Kalau tidak ada penantang, balapan tetap jalan sendiri setelah hitung mundur habis, atau peserta bisa tekan **Balap sendiri sekarang**.
4. Di TV: perkenalan "BUDI VS ANDI" → burnout → lampu stage → 3 lampu kuning → **HIJAU**.
5. Peserta tap GAS lalu oper gigi. TV menampilkan PERFECT / BAGUS / TERLALU CEPAT / TELAT di atas motor.
6. Yang pertama menyentuh garis finish menang. TV dan HP menampilkan skor, waktu reaksi, waktu tempuh (ET), top speed, nilai tiap oper gigi, dan peringkat.
7. Setelah beberapa detik QR baru muncul untuk peserta berikutnya.

Mode **solo** hanya menampilkan satu QR. Peserta balapan melawan waktu.

## 3. Cara skor dihitung

| Komponen | Default |
|---|---|
| Poin reaksi | 1.000 × (1 − reaksi/1 detik). Reaksi 0,200 s = 800 poin. False start = 0 |
| Oper gigi | PERFECT 300, BAGUS 150, terlalu cepat/telat 0 (tiap perpindahan gigi) |
| Poin waktu | Maks 5.000 kalau total waktu sama dengan waktu terbaik teoretis, turun sampai 0 di 1,5× waktu terbaik |
| Bonus menang duel | 500 |

**False start**: default *penalti* (motor jalan otomatis setelah hijau + 1 detik, poin reaksi 0). Bisa diubah ke *diskualifikasi* (skor 0).
Papan skor memakai skor terbaik tiap nomor HP. Jika seri, yang total waktunya lebih cepat menang.

## 4. Panel admin (`/admin`)

- **Status layar**: lihat siapa di lajur mana. Tombol **Uji coba 1 lawan 1 / solo** menjalankan balapan di TV dengan keyboard (lajur kiri **A / Spasi**, lajur kanan **L / Enter**), tidak masuk papan skor. **Mulai paksa** dan **Hentikan / batalkan**.
- **Branding**: judul, sub-judul, footer, warna, nama & warna tiap lajur, suasana sirkuit (siang/senja/malam), billboard Ichiban, logo.
- **Mode balapan**: duel/solo, lama menunggu penantang, boleh balap sendiri.
- **Lampu start**: lama burnout, jenis lampu (standar / pro), jeda tiap lampu kuning, jeda acak sebelum hijau, aturan & penalti false start, lampu juga tampil di HP atau tidak.
- **Motor, gigi & kesulitan**: preset Mudah / Normal / Sulit / Pro, panjang lintasan (201 m = 1/8 mil, 402 m = 1/4 mil), jumlah gigi, tenaga mesin, top speed, garis merah RPM, zona PERFECT & BAGUS, toleransi limiter. Admin menampilkan waktu terbaik teoretis supaya mudah mengatur lama balapan (default ±7,8 detik).
- **Skor**: semua poin di tabel di atas.
- **Alur & peserta**: lama hasil tampil, minta nomor HP, kolom tambahan (mis. "Nama Bengkel"), batas main per nomor HP, jumlah baris papan skor.
- **Suara**: on/off, volume utama, musik, mesin, efek, penonton, suara di HP peserta, upload musik sendiri (MP3/OGG/WAV/M4A).
- **Data peserta**: tabel semua balapan, hapus per baris, **Ekspor CSV** (bisa dibuka di Excel), reset skor, kembalikan pengaturan default.

Pengaturan yang disimpan berlaku untuk balapan berikutnya.

## 5. Halaman lain

- `/leaderboard`: papan skor layar penuh untuk TV kedua, update otomatis.

## 6. Tips event

- Pakai router Wi-Fi sendiri supaya koneksi HP stabil. Waktu reaksi dihitung dengan jam yang disinkronkan antara HP dan server, jadi adil walaupun sinyal sedikit lambat.
- Lampu start juga tampil di HP (bisa dimatikan di admin kalau ingin peserta wajib melihat TV).
- Data tersimpan di file `data.json`. Backup file ini atau ekspor CSV setelah acara.

## 7. Struktur file

```
server.js            server (QR, pendaftaran, jadwal lampu, hasil balapan, admin)
public/sim.js        simulasi motor (dipakai sama persis oleh server, TV, dan HP)
public/race.js       tampilan balapan di TV
public/shared.js     sinkronisasi jam + mesin suara
public/tv.html       layar TV
public/play.html     HP peserta (gas & tuas gigi)
public/admin.html    panel admin
public/sfx/          musik & suara bawaan (dibuat khusus, bebas dipakai)
public/img/          gambar kaleng Ichiban untuk billboard
screenshots/         contoh tampilan
```
