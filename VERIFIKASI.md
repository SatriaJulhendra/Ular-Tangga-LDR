# Catatan verifikasi — 22 Oktober 2026

- `npm test`: **14 tes lulus**, 0 gagal.
- `node tests/http-smoke.mjs` terhadap Next.js lokal pada port 3001: **lulus**. Memakai dua cookie identitas berbeda dan menguji create/join/ready/start/roll/replay, penyelesaian kartu jika muncul, penolakan akses tanpa token, penolakan origin lain, dan keluar.
- `npm run build`: **berhasil** pada Next.js 16.4.2, termasuk kompilasi TypeScript dan pembuatan halaman produksi. Dijalankan kembali setelah perbaikan origin dan aksesibilitas dialog.
- Uji browser: halaman beranda dan pembuatan room hingga lobby berhasil. Papan terlihat pada layout desktop dan panel sempit sekitar 426 px. Papan tidak terpotong secara horizontal pada ukuran yang diamati.
- Lebar tepat 360 px, uji banyak perangkat fisik, audit kontras/fokus lengkap, load test, dan playtest belum dilakukan. Tidak ada klaim siap rilis produksi.

Tes aturan meliputi distribusi dan zig-zag, ular/tangga tanpa efek berantai, tepat 100 dan overshoot, tanpa bonus angka 6, otorisasi pemain/host, penalti minimum 0, idempotensi, aksi stale, persaingan timeout dengan aksi manual, reconnect dan kerahasiaan token, kick, perpindahan host, rematch, reset siap, variasi deck, serta validasi lobby.

Build produksi disediakan sebagai source yang dapat dibangun ulang dengan lockfile. ZIP tidak menyertakan `node_modules`, `.next`, data room, cookie, atau sesi pengujian.
