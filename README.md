# Naik Jujur, Turun Berani

Game ular tangga multiplayer menggunakan **Next.js App Router, React, dan TypeScript**, berdasarkan PRD Ular Tangga — Truth or Dare. Antarmuka berbahasa Indonesia, papan pastel dengan ilustrasi SVG, dan tata letak responsif.

## Menjalankan

Butuh Node.js 22 LTS dan npm. Buka terminal pada folder proyek ini:

```powershell
npm ci
npm run dev
```

Buka **http://localhost:3000**. Buat room, bagikan tautan, lalu tunggu minimal dua pemain. Semua pemain termasuk host menekan **Aku siap bermain** sebelum host memulai.

Untuk mencoba dua identitas di satu komputer, gunakan browser berbeda atau jendela incognito. Tab dalam profil browser yang sama berbagi identitas cookie.

Untuk bermain melalui Wi-Fi yang sama, gunakan `http://IP-KOMPUTER:3000` pada semua perangkat. Salin undangan dari alamat IP tersebut, bukan localhost. Perangkat harus bisa mengakses port server. Bermain melalui internet memerlukan hosting Node.js dan HTTPS.

```powershell
npm test
npm run build
npm start
```

Uji API terhadap server yang sudah berjalan:

```powershell
$env:TEST_URL = 'http://localhost:3000'
node tests/http-smoke.mjs
```

## Fitur yang tersedia

- Room privat dengan kode acak dan tautan, nama tamu, enam pilihan avatar, 2–6 pemain.
- Lobby, status siap, paket Keluarga/Teman/Pasangan, pilihan waktu kartu, salin undangan, dan kick oleh host.
- Blueprint papan PRD: 15 netral, 10 tangga, 10 ular, 33 Truth, 32 Dare. Nomor zig-zag, kotak 100 netral, dan detail kotak saat diklik.
- Dadu `crypto.randomInt(1, 7)` di server. Browser hanya mengirim intent; hasil, kartu, posisi, dan deadline berasal dari server.
- Tepat mencapai 100, tanpa bonus angka 6, tanpa efek berantai, penalti lewati −3 dengan minimum 0.
- Timer 30 detik untuk lempar; default kartu Truth 60 / Dare 90 detik. Host bisa memilih durasi kartu 60/90/120 detik.
- Kartu aktif terlihat sama di semua perangkat. Selesai atau lewati hanya oleh pemain aktif. Minimisasi kartu tidak mengakhiri kartu.
- Version check, turn ID, receipt action ID untuk mencegah aksi ganda. Timeout ditetapkan server dan direkonsiliasi sebelum aksi.
- Sinkronisasi melalui polling 1 detik. Cookie HttpOnly menyimpan token pemain; token tidak dimasukkan ke undangan atau snapshot publik.
- Reload/reconnect mempertahankan identitas, posisi, kartu, dan waktu. Data room disimpan sebagai JSON melalui penulisan sementara dan rename.
- Deteksi offline setelah 15 detik tanpa heartbeat; tenggang berikutnya 60 detik sebelum dikeluarkan. Host berpindah ke pemain tersisa yang bergabung paling awal.
- Pemenang, ringkasan jumlah kartu, riwayat permainan, keluar, dan rematch yang memerlukan siap ulang.
- Label aksesibilitas, fokus keyboard terlihat, ikon selain warna, dan reduced motion.

## Struktur kode

```text
app/page.tsx                 Antarmuka beranda, lobby, permainan, hasil
app/globals.css              Desain responsif dan animasi
app/api/rooms/route.ts       Membuat room dan cookie identitas
app/api/rooms/[code]/route.ts Join, snapshot, dan aksi permainan
lib/board.ts                Blueprint, validator, dan fungsi perpindahan
lib/game.ts                 State machine, validasi aksi, timer, persistensi
lib/content.ts              300 kartu awal (50 per jenis per paket)
lib/http.ts                 Pembatasan permintaan dan validasi origin
tests/game.test.ts          Tes aturan dan state machine
tests/http-smoke.mjs        Uji integrasi HTTP dengan dua identitas
data/rooms/                 Data runtime privat, otomatis dibuat
```

## Batas versi ini dibanding target rilis PRD

Ini adalah implementasi awal yang dapat dimainkan, **belum memenuhi seluruh Definition of Done rilis publik**.

| Area          | Implementasi dan pekerjaan lanjutan                                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastruktur | Satu proses Node.js, filesystem persisten. Belum Redis/PostgreSQL atau transaksi lintas proses. Jangan jalankan beberapa worker/replica pada direktori data yang sama.                                                                                                                                  |
| Realtime      | Polling 1 detik menggantikan WebSocket. Timer direkonsiliasi saat request; belum scheduler terpisah. Target p95 ≤500 ms PRD belum terpenuhi atau diukur.                                                                                                                                                |
| Hosting       | Jalankan pada VPS/container dengan volume persisten. Penyimpanan filesystem tidak cocok untuk Vercel/serverless sementara. Belum dipublikasikan ke internet.                                                                                                                                            |
| Konten        | 300 kartu **draf** untuk mencoba game, menggunakan 50 topik Truth dan 50 aktivitas Dare dengan adaptasi konteks per paket. Belum 300 konten unik hasil review editorial. Mode awal ini memainkan draf; sebelum rilis, implementasikan gate `published`, tanggal review, dan freeze versi deck per sesi. |
| Reconnect     | Cookie identitas dan snapshot tersedia. Belum mekanisme tab terbaru mengambil alih tab lama. Refresh dari profil browser yang sama memakai pemain yang sama.                                                                                                                                            |
| Operasional   | Belum dashboard analitik, monitoring/error tracking eksternal, pembersihan data otomatis, retensi 24 jam terjadwal, backup, dan uji pemulihan bencana. Room lobby kedaluwarsa secara logis setelah 30 menit.                                                                                            |
| Validasi      | Tes aturan dan smoke HTTP tersedia. Belum load test 600 koneksi, simulasi 10.000 sesi, audit aksesibilitas formal, dan playtest 5 kelompok.                                                                                                                                                             |
| Animasi       | Animasi dadu tersedia; perpindahan pion diperbarui ke hasil server, belum animasi langkah per kotak.                                                                                                                                                                                                    |

## Konfigurasi dan penyimpanan

- `NJ_DATA_DIR`: lokasi absolut direktori room JSON. Default `data/rooms`.
- `COOKIE_SECURE=true`: aktifkan untuk deployment HTTPS pada mode production. Localhost HTTP memakai default `false` agar bisa diuji.
- `TEST_URL`: URL server untuk smoke HTTP.

Jangan taruh folder data pada direktori publik. File data mengandung token autentikasi; batasi akses filesystem dan backup secara privat. Jangan commit data runtime. Untuk reset room lokal, hentikan server terlebih dahulu dan hapus file room yang memang ingin direset.

Saat siap meningkatkan ke produksi, ganti adapter filesystem dengan Redis/transaksi atomik, tambahkan WebSocket dan scheduler, gate editorial kartu published, cookie Secure wajib pada HTTPS, pembatasan join terdistribusi, monitoring, serta checklist QA PRD.

Font Google Fonts bersifat opsional; jika jaringan font tidak tersedia, sistem memakai font sans-serif lokal. Seluruh elemen permainan dan SVG tetap bekerja.
