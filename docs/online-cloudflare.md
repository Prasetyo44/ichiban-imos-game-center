# Online di domain sendiri lewat Cloudflare Tunnel

Dengan cara ini, game tetap berjalan di **laptop event**, tetapi bisa dibuka dari mana saja lewat alamat domain Anda, misalnya `https://game.domainanda.com`.

- Gratis (fitur Cloudflare Tunnel / Zero Trust paket Free).
- Otomatis **HTTPS**, sehingga mode miring (tilt) di Spray Paint ikut bisa dipakai.
- Data peserta tetap tersimpan di laptop (folder `data/`).
- HP peserta tidak harus di Wi-Fi yang sama. Data seluler pun bisa.
- Syarat: laptop harus **menyala dan terhubung internet** selama game dipakai.

Yang dibutuhkan: domain yang sudah aktif di akun Cloudflare Anda (nameserver sudah mengarah ke Cloudflare).

---

## Langkah 1 — Atur alamat di `config.json`

Buka `config.json` dengan Notepad, isi `publicUrl` dengan alamat yang akan dipakai, lalu **ganti semua password** (website ini bisa dibuka siapa saja di internet):

```json
{
  "port": 3000,
  "publicUrl": "https://game.domainanda.com",
  "superAdminPassword": "ganti-password-kuat",
  "apps": {
    "spin-wheel":  { "enabled": true, "adminPassword": "ganti-1" },
    "ichiban-run": { "enabled": true, "adminPassword": "ganti-2" },
    "spray-paint": { "enabled": true, "adminPassword": "ganti-3" },
    "drag-race":   { "enabled": true, "adminPassword": "ganti-4" }
  }
}
```

`publicUrl` penting: alamat inilah yang dimasukkan ke QR di layar TV.

## Langkah 2 — Buat tunnel di Cloudflare (sekali saja)

1. Login ke https://dash.cloudflare.com, buka **Zero Trust** (menu kiri). Kalau baru pertama kali, pilih paket **Free**.
2. Buka **Networks → Tunnels → Create a tunnel**, pilih **Cloudflared**, beri nama misalnya `imos-game`.
3. Di halaman "Install and run connector", pilih **Windows**. Cloudflare menampilkan perintah berisi token panjang (diawali `eyJ...`).
   **Salin token itu saja** (teks setelah `--token`), lalu simpan di file baru bernama **`cloudflare-token.txt`** di folder game (sejajar dengan `MULAI-ONLINE.bat`). Token ini rahasia, jangan dibagikan dan jangan di-upload ke GitHub (file ini sudah otomatis diabaikan Git).
4. Lanjut ke tab **Public Hostname → Add a public hostname**:
   - Subdomain: `game` (bebas)
   - Domain: pilih domain Anda
   - Service: Type **HTTP**, URL **`localhost:3000`**
   - Simpan.

Cloudflare otomatis membuat DNS `game.domainanda.com` yang mengarah ke tunnel.

## Langkah 3 — Jalankan

- **Windows:** klik dua kali **`MULAI-ONLINE.bat`**. Pertama kali, skrip ini memasang `cloudflared` (lewat winget) dan komponen Node.js. Akan muncul dua jendela: server game dan koneksi Cloudflare. Biarkan keduanya terbuka.
- **Mac / Linux:** `brew install cloudflared` (sekali), lalu `./mulai-online.sh`.

Setelah status tunnel di dashboard Cloudflare menjadi **HEALTHY**, buka:

| Halaman | Alamat |
|---|---|
| Menu semua game | `https://game.domainanda.com/` |
| Super-admin | `https://game.domainanda.com/admin` |
| Layar TV Drag Race | `https://game.domainanda.com/drag-race/tv` |
| Admin Drag Race | `https://game.domainanda.com/drag-race/admin` |

(Begitu juga `/spin-wheel`, `/ichiban-run`, `/spray-paint`.)

Untuk berhenti, tutup kedua jendela.

---

## Tips

- **Tetap bisa offline:** kalau internet booth mati, jalankan `MULAI-GAME.bat` biasa dan kosongkan `publicUrl`. Game kembali memakai Wi-Fi lokal dengan data yang sama.
- **Drag Race** mengukur waktu reaksi. Lewat internet ada sedikit jeda tambahan, tetapi waktu tap dihitung dengan jam server yang disinkronkan, jadi tetap adil. Untuk hasil terbaik, gunakan internet booth yang stabil.
- **Menjalankan otomatis saat laptop menyala (opsional):** buka Command Prompt sebagai Administrator lalu jalankan `cloudflared service install TOKEN_ANDA`. Setelah itu cukup jalankan `MULAI-GAME.bat` (dengan `publicUrl` tetap terisi).
- Kalau muncul **Error 502/1033**, berarti server game di laptop belum jalan atau tunnel terputus. Cek jendela server dan status tunnel di dashboard.
