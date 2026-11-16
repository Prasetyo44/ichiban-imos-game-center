> **Catatan (versi gabungan IMOS):** panduan ini berasal dari aplikasi Ichiban Run versi terpisah. Di versi gabungan, semua alamat halaman diawali `/ichiban-run`, misalnya `/ichiban-run/tv`, `/ichiban-run/admin`, `/ichiban-run/play`. Cara menjalankan, password dan lokasi data mengikuti README utama (satu `npm start` untuk semua game, password di `config.json`, data di `data/ichiban-run/`).

# Ichiban Run — Game Lompat Kaleng

Game "challenge skor" untuk event/booth. Karakternya kaleng Ichiban (Aerosol All-in-One dan NC Series) yang berlari di jalan dan harus melompati rintangan.

- **Layar TV/laptop** menampilkan game, QR code, dan papan skor.
- **HP peserta** jadi stik kontrol yang hanya berisi dua tombol: **▲ UP** (lompat) dan **▼ DOWN** (merunduk).
- Peserta punya **nyawa (hati ❤️)**. Setiap tabrakan mengurangi 1 nyawa. Game selesai saat nyawa habis.
- **Skor dihitung dari jarak tempuh** (meter), ditambah bonus bintang ★.
- **Panel admin** mengatur semua hal: nyawa, kecepatan, frekuensi rintangan, karakter kaleng, poin, branding, reset, dan ekspor skor.

Semuanya berjalan di laptop lewat Wi-Fi lokal, tanpa internet dan tanpa install aplikasi di HP.

---

## 1. Cara menjalankan

1. Install **Node.js versi 18 atau lebih baru** dari https://nodejs.org (pilih versi LTS).
2. Ekstrak zip ini, lalu buka Terminal / Command Prompt di folder `ichiban-run`.
3. Jalankan sekali saja:
   ```
   npm install
   ```
4. Jalankan game:
   ```
   npm start
   ```
5. Terminal akan menampilkan alamat seperti ini:
   ```
   Layar TV/Laptop : http://192.168.1.10:3000/tv
   Papan Skor      : http://192.168.1.10:3000/leaderboard
   Panel Admin     : http://192.168.1.10:3000/admin   (password: admin123)
   ```
6. Buka alamat **/tv** di browser laptop yang tersambung ke TV (Chrome disarankan), lalu klik **⛶ Layar penuh** dan **🔊 Aktifkan suara**.
7. Pastikan **HP peserta tersambung ke Wi-Fi yang sama** dengan laptop.

### Mengganti password admin
```
# Windows (Command Prompt)
set ADMIN_PASSWORD=rahasiaku && npm start

# Mac / Linux
ADMIN_PASSWORD=rahasiaku npm start
```
Pilihan lain: `PORT=8080` untuk mengganti port, atau `PUBLIC_URL=http://alamat-anda` jika alamat yang terdeteksi otomatis salah (misalnya laptop punya beberapa jaringan).

---

## 2. Alur permainan

1. TV menampilkan **QR code** dan **Papan Skor**. Di belakangnya ada demo game yang berjalan sendiri.
2. Peserta men-scan QR, lalu mengisi **nama** dan **nomor HP**. Jika diatur, peserta juga mengisi kolom tambahan dan **memilih kaleng**.
3. TV menampilkan "Halo, [nama]!". Peserta menekan **MULAI** di HP.
4. Hitung mundur 3-2-1-GO, lalu HP berubah menjadi stik kontrol **UP / DOWN**.
5. Selama bermain:
   - **UP** untuk melompati kerucut, ember cat, tumpukan ban, dan pembatas jalan.
   - **DOWN** untuk merunduk di bawah drone dan gumpalan cat terbang. Jika ditekan saat di udara, kaleng turun lebih cepat.
   - Ambil **bintang ★** untuk bonus poin, dan **hati ❤️** untuk tambahan nyawa.
   - HP bergetar setiap kali tertabrak, dan nyawa serta skor ikut tampil di HP.
6. Saat nyawa habis, TV menampilkan **GAME OVER**, skor, peringkat, dan papan skor. Setelah beberapa detik, QR baru muncul untuk peserta berikutnya.

Setiap QR **hanya bisa dipakai satu HP**. Jika peserta tidak melanjutkan, TV kembali ke QR secara otomatis setelah 2–3 menit.

---

## 3. Panel Admin (`/admin`)

| Bagian | Yang bisa diatur |
|---|---|
| **Status Layar** | Melihat TV mana yang sedang dipakai dan siapa yang bermain. Ada tombol **Main uji coba** untuk mencoba game di TV memakai keyboard (▲/▼/Spasi), dan tombol **Hentikan game** yang sedang berjalan. |
| **Branding** | Judul, sub-judul, footer/tagline, warna utama dan aksen, tema latar (Siang / Senja / Malam), billboard brand di dalam game, dan upload logo. |
| **Nyawa** | Jumlah nyawa awal, nyawa maksimum, peluang munculnya hati tambahan, dan lama kebal setelah tertabrak. |
| **Kecepatan & Kesulitan** | Preset **Mudah / Normal / Sulit / Ekstrem**, kecepatan awal dan maksimum, percepatan, tinggi lompatan, gravitasi, lompat ganda, dan ukuran kaleng. |
| **Rintangan** | Jeda minimum dan maksimum antar rintangan, persentase rintangan terbang, jarak saat rintangan terbang mulai muncul, rintangan ganda, dan batas waktu main. |
| **Skor** | Poin per meter, peluang munculnya bintang, dan poin per bintang. Admin juga menampilkan contoh perhitungannya. |
| **Alur & Peserta** | Hitung mundur, lama hasil tampil, wajib/tidaknya nomor HP, kolom tambahan (mis. "Nama Bengkel"), batas main per nomor HP, jumlah baris papan skor, keyboard di TV, dan efek suara. |
| **Karakter Kaleng** | Cara memilih kaleng: peserta memilih sendiri, selalu satu kaleng, atau acak. Admin bisa mengaktifkan/menonaktifkan kaleng, mengganti nama, dan **upload kaleng baru** (PNG transparan paling bagus). |
| **Papan Skor & Data** | Tabel semua permainan, **Ekspor CSV** (bisa dibuka di Excel), hapus satu data, **Reset semua skor**, dan kembalikan pengaturan default. |

Klik **💾 Simpan pengaturan** (kanan bawah) setelah mengubah pengaturan. Branding langsung berubah di TV, sedangkan pengaturan game berlaku mulai permainan berikutnya.

**Catatan:**
- Papan skor memakai **skor terbaik tiap peserta** (berdasarkan nomor HP), jadi satu orang tidak memenuhi papan skor.
- Hasil permainan uji coba ditandai "uji coba" dan **tidak masuk papan skor**.
- Jeda rintangan dijaga minimal sepanjang waktu satu lompatan, jadi rintangan selalu bisa dilewati walaupun jeda diatur sangat kecil.

---

## 4. Halaman lain

- `/leaderboard`: papan skor layar penuh untuk TV kedua atau monitor di samping booth. Halaman ini diperbarui otomatis.
- Beberapa TV bisa membuka `/tv` sekaligus. Setiap TV punya QR sendiri sehingga beberapa peserta bisa bermain bersamaan.

---

## 5. Data & cadangan

- Semua data tersimpan di file `data.json`, dan gambar upload tersimpan di folder `uploads/`.
- Untuk mencadangkan data, salin kedua file/folder tersebut. Untuk mulai dari nol, hapus `data.json` (atau gunakan tombol Reset di admin).

## 6. Tips di lokasi acara

- Gunakan router/hotspot khusus untuk booth agar koneksi stabil. Jeda tombol HP ke TV biasanya di bawah 50 ms di Wi-Fi lokal.
- Matikan mode hemat daya/sleep di laptop.
- Jika HP tidak bisa membuka link, periksa apakah HP tersambung ke Wi-Fi yang sama, lalu izinkan Node.js di firewall Windows saat muncul pertanyaan.

## Struktur file
```
server.js              Server: QR, pendaftaran, kontrol HP → TV, skor, admin
public/tv.html         Layar TV (QR, papan skor, hasil)
public/game.js         Mesin game (grafik, fisika, rintangan, skor)
public/play.html       Halaman HP: daftar + stik kontrol UP/DOWN
public/admin.html      Panel admin
public/leaderboard.html Papan skor layar penuh
public/img/            Gambar kaleng bawaan
screenshots/           Contoh tampilan
```
