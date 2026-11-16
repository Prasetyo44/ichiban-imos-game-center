> **Catatan (versi gabungan IMOS):** panduan ini berasal dari aplikasi Spray Paint Challenge versi terpisah. Di versi gabungan, semua alamat halaman diawali `/spray-paint`, misalnya `/spray-paint/tv`, `/spray-paint/admin`, `/spray-paint/play`. Cara menjalankan, password dan lokasi data mengikuti README utama (satu `npm start` untuk semua game, password di `config.json`, data di `data/spray-paint/`).

# Ichiban Spray Paint Challenge

Game booth untuk event otomotif: **layar TV/laptop menampilkan motor polos**, peserta scan QR, lalu **HP-nya jadi kaleng semprot** untuk mengecat motor di TV sebelum waktu habis. Skor dihitung dari seberapa **rata** catnya, dikurangi cat yang **meleber** keluar bodi dan cat yang **meleleh** karena terlalu tebal. Semuanya diatur dari panel admin, lengkap dengan musik dan efek suara.

Sistemnya sama dengan Ichiban Run (QR sekali pakai, pendaftaran nama + no HP, papan skor, admin berpassword, ekspor CSV).

## Cara menjalankan

1. Install **Node.js 18 atau lebih baru** di laptop (https://nodejs.org).
2. Ekstrak zip ini, buka terminal / Command Prompt di folder `spray-paint-challenge`, lalu jalankan:
   ```
   npm install
   npm start
   ```
   (`npm install` cukup sekali; butuh internet hanya saat itu. Setelahnya game jalan **offline**.)
3. Terminal akan menampilkan alamat, contoh:
   - Layar TV: `http://192.168.1.5:3000/tv`
   - Papan skor: `http://192.168.1.5:3000/leaderboard`
   - Admin: `http://192.168.1.5:3000/admin` (password default **admin123**)
4. Buka **/tv** di laptop yang tersambung ke TV, tekan **Layar penuh** dan **klik sekali tombol "Aktifkan suara"** (aturan browser: suara baru boleh bunyi setelah ada klik).
5. HP peserta harus tersambung ke **Wi-Fi yang sama** dengan laptop. Peserta tinggal scan QR di TV.

### Pengaturan lanjutan (opsional)
| Variabel | Fungsi |
|---|---|
| `ADMIN_PASSWORD=rahasia` | Ganti password admin (sangat disarankan saat event) |
| `PORT=8080` | Ganti port (default 3000) |
| `PUBLIC_URL=http://10.0.0.2:3000` | Paksa alamat yang dipakai QR (kalau laptop punya beberapa jaringan) |
| `DATA_DIR=D:\data-event` | Lokasi penyimpanan data, upload & foto hasil |

Contoh Windows: `set ADMIN_PASSWORD=rahasia && npm start` · Mac/Linux: `ADMIN_PASSWORD=rahasia npm start`

Tips suara otomatis (mode kios): jalankan Chrome dengan `--autoplay-policy=no-user-gesture-required --kiosk http://localhost:3000/tv` supaya tidak perlu klik "Aktifkan suara".

## Alur permainan

1. **TV** menampilkan QR, papan skor (dengan foto hasil cat pemenang) dan motor yang dicat otomatis sebagai tontonan.
2. **HP**: isi nama, nomor HP (dan kolom tambahan bila diaktifkan), pilih motor yang mau dicat.
3. Tekan **MULAI** → hitung mundur sambil "kocok kaleng" (suara kaleng dikocok + HP bergetar).
4. **Mengecat**: sentuh & geser jari di gambar motor pada HP = menyemprot di posisi yang sama di TV. Lepas jari = berhenti. Bulatan warna di bawah untuk ganti warna cat. HP bisa diputar ke samping supaya area semprot lebih besar.
5. Selesai saat waktu habis, atau tekan **SELESAI** di HP (dapat bonus sisa waktu kalau tutupan sudah cukup).
6. TV menampilkan **foto hasil cat**, nilai (S/A/B/C/D), rincian skor dengan animasi hitung + sorakan, dan peringkat. HP juga menampilkan hasilnya. Setelah beberapa detik QR baru muncul untuk peserta berikutnya (QR lama tidak bisa dipakai lagi).

## Cara skor dihitung

Bodi motor dibagi menjadi kotak-kotak kecil, dan ketebalan cat di tiap kotak dihitung:

- **Rata**: bagian bodi yang sudah tertutup cat dengan ketebalan pas.
- **Meleber**: cat yang jatuh di luar bodi (roda, jok, kaca, dinding), dalam % terhadap luas bodi.
- **Meleleh**: kalau kaleng diam terlalu lama di satu titik, cat jadi terlalu tebal dan meleleh turun (ada efek tetesan, suara "blop", HP bergetar).

`Skor = (% rata × poin penuh) − (% meleber × penalti) − (% meleleh × penalti) + (sisa detik × bonus, jika tutupan ≥ syarat)`

Nilai: **S** Pengecat Pro (≥90% poin penuh) · **A** Bengkel Juara (≥75%) · **B** Lumayan Rapi (≥55%) · **C** Perlu Latihan (≥35%) · **D** Masih Belepotan.

## Panel admin (/admin)

- **Status layar**: lihat TV yang terbuka, jalankan **uji coba tanpa HP** (mouse di laptop TV: gerak = bidik, tahan klik = semprot, angka 1-9 = ganti warna, Enter = selesai), hentikan game.
- **Waktu & semprotan**: preset Mudah/Normal/Sulit/Ekstrem, lama main, hitung mundur, lebar semprotan, kekuatan semprot, cat bisa meleleh atau tidak & batas tebalnya, mode kontrol (sentuh atau miringkan HP).
- **Skor**: poin penuh, penalti meleber & meleleh, bonus waktu dan syaratnya, tombol SELESAI, selesai otomatis di % tertentu. Ada contoh perhitungan langsung.
- **Warna cat**: tambah/ubah/hapus warna, nama warna, aktif/nonaktif (maks 16).
- **Suara & musik**: musik latar on/off + volume, efek suara on/off + volume, desis semprot di HP, upload musik sendiri (MP3/OGG/WAV), tombol coba dengar semua suara.
- **Template motor**: 4 bawaan (Motor Sport, Skuter Matik, Trail/Motocross, Helm Full Face), peserta memilih / satu template / acak, aktif-nonaktif, ganti nama, **upload template sendiri**.
- **Branding**: judul, sub-judul, footer, warna utama & aksen, latar booth (Bengkel / Showroom terang / Neon malam), tampilkan kaleng Ichiban, logo, gambar kaleng kursor semprot.
- **Alur & peserta**: minta no HP, kolom tambahan (mis. "Nama Bengkel"), batas main per nomor HP, jumlah baris papan skor, mouse di TV, simpan foto hasil.
- **Data peserta**: tabel dengan foto hasil cat, skor, nilai, % rata/meleber/meleleh, **ekspor CSV** (bisa dibuka di Excel), hapus satu data, reset semua skor.

### Membuat template motor sendiri
- **Gambar motor**: PNG dengan latar transparan, motor menghadap samping. Tanpa mask, seluruh bagian yang tidak transparan dianggap boleh dicat.
- **Mask (disarankan)**: gambar ukuran sama, area yang boleh dicat berwarna **hitam**, sisanya transparan atau putih. Dengan mask, roda/jok/kaca tidak ikut dihitung.

## Suara

Semua suara dibuat sendiri secara digital untuk game ini (bebas royalti) dan tersimpan offline di `public/sfx`:
musik menunggu, musik main (makin cepat di 10 detik terakhir), desis semprot, kocok kaleng, bip hitung mundur, start, detak 10 detik terakhir, cat meleleh, peringatan meleber, peserta bergabung, peluit selesai, hitung skor, fanfare + tepuk tangan (nilai S/A), jingle hasil (nilai B-D). Musik latar bisa diganti lewat admin.

## Struktur folder

```
server.js            server (Express + Socket.IO), skor, QR, data
public/tv.html       layar TV
public/game.js       mesin cat (kanvas 1920x1080)
public/audio.js      mesin suara
public/play.html     HP peserta (kaleng semprot)
public/admin.html    panel admin
public/leaderboard.html  papan skor layar kedua
public/tpl/          template motor bawaan (SVG)
public/sfx/          musik & efek suara
public/img/          kaleng Ichiban
screenshots/         contoh tampilan
data.json, uploads/  dibuat otomatis: data peserta, upload, foto hasil (uploads/hasil)
```

## Tips di lokasi event
- Pakai router/hotspot sendiri supaya HP peserta dan laptop pasti satu jaringan.
- Mode **miringkan HP (gyro)** hanya jalan lewat HTTPS. Di jaringan lokal biasa gunakan mode **Sentuh & geser** (default); game otomatis kembali ke mode sentuh kalau sensor tidak tersedia.
- Backup: salin `data.json` dan folder `uploads/` atau ekspor CSV di akhir hari.
- Kalau TV sempat tertutup/refresh, QR baru langsung muncul lagi; permainan yang terputus tidak dihitung.
