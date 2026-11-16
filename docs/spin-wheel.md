> **Catatan (versi gabungan IMOS):** panduan ini berasal dari aplikasi Spin Wheel versi terpisah. Di versi gabungan, semua alamat halaman diawali `/spin-wheel`, misalnya `/spin-wheel/tv`, `/spin-wheel/admin`, `/spin-wheel/play`. Cara menjalankan, password dan lokasi data mengikuti README utama (satu `npm start` untuk semua game, password di `config.json`, data di `data/spin-wheel/`).

# Spin Wheel QR

Aplikasi spin wheel untuk acara/booth:

- **Layar TV/Laptop** (`/tv`) menampilkan roda + QR code.
- Peserta **scan QR** → isi **nama, nomor HP, alamat** → HP berubah menjadi spin wheel.
- Saat peserta menekan **PUTAR** di HP, roda di TV ikut berputar **bersamaan dengan hasil yang sama persis** (hasil ditentukan di server).
- **Panel admin** (`/admin`): atur hadiah, bobot peluang, stok, atur hasil peserta tertentu (berdasarkan nomor HP atau "putaran berikutnya"), lihat data peserta, ekspor CSV (bisa dibuka di Excel).

## Cara menjalankan (di laptop)

1. Install **Node.js 18+** dari https://nodejs.org (pilih versi LTS).
2. Ekstrak folder ini, buka Terminal / Command Prompt di dalam folder, lalu jalankan:
   ```
   npm install
   npm start
   ```
3. Terminal akan menampilkan alamat, misalnya:
   ```
   Layar TV/Laptop : http://192.168.1.10:3000/tv
   Panel Admin     : http://192.168.1.10:3000/admin
   ```
4. Buka alamat **/tv** di browser laptop yang tersambung ke TV, tekan tombol **Layar penuh**.
5. Buka **/admin** (bisa dari laptop yang sama atau HP petugas). Password bawaan: `admin123`.

**Penting:** HP peserta harus tersambung ke **Wi-Fi yang sama** dengan laptop. Jika HP tidak bisa membuka halaman, izinkan Node.js di Firewall Windows (pilih "Private network") saat muncul pertanyaan.

### Mengganti password admin / port

Windows (Command Prompt):
```
set ADMIN_PASSWORD=rahasiaku && npm start
```
Mac/Linux:
```
ADMIN_PASSWORD=rahasiaku npm start
```
Variabel lain: `PORT` (bawaan 3000), `PUBLIC_URL` (alamat yang dimasukkan ke QR, misalnya jika memakai domain sendiri).

## Cara kerja peluang

- Setiap segmen punya **bobot**. Peluang = bobot ÷ total bobot segmen yang stoknya masih ada. Panel admin menampilkan persentasenya.
- **Stok** kosong = tidak terbatas. Saat stok habis (0), segmen tetap tampil di roda tapi tidak akan keluar dari putaran acak.
- Centang **Hadiah?** untuk segmen yang berupa hadiah (agar muncul ucapan "Selamat" + konfeti, dan tercatat sebagai pemenang).

## Mengatur hasil peserta tertentu

Urutan prioritas saat peserta memutar:
1. **Nomor HP yang sudah diatur** di panel admin → hasilnya pasti hadiah yang dipilih (sekali pakai).
2. **Putaran berikutnya** → peserta mana pun yang memutar berikutnya mendapat hasil itu (sekali pakai).
3. Jika tidak ada pengaturan → acak sesuai bobot.

Di data peserta, hasil yang diatur admin diberi label **"diatur"**, dan kolom "Sumber Hasil" di CSV mencatatnya.

## Aturan lain

- QR **sekali pakai**: setelah satu peserta mendaftar, QR lama tidak berlaku. QR baru muncul otomatis ±10 detik setelah hasil tampil.
- Jika peserta berhenti di tengah jalan, layar kembali ke QR setelah 3 menit.
- Opsi "1 nomor HP hanya boleh spin 1 kali" bisa dimatikan di Pengaturan.
- Bisa dibuka di beberapa layar TV sekaligus; tiap layar punya QR sendiri.

## Data

Semua data tersimpan di file `data.json` di folder aplikasi. Untuk backup, salin file ini. Hapus file ini untuk mulai dari awal (hadiah kembali ke contoh bawaan).
