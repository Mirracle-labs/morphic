# Morphic Gateway — VPS Deployment & Reverse Proxy Guide

Panduan konfigurasi VPS untuk produksi mandiri (self-hosted VPS) tanpa Cloudflare CDN,
termasuk deployment dua node (multi-server) dari Pooling Phase 2.

---

## 1. Topologi & Arsitektur Jaringan

### 1.1 Satu node (baseline)

- **API Process**: Mengikat (bind) hanya ke loopback lokal `127.0.0.1:3001` (atau port yang ditentukan). Jangan pernah membuka port Node.js langsung ke internet publik.
- **TLS Termination**: Nginx bertindak sebagai reverse proxy dan mengakhiri TLS pada port **443** (HTTPS).
  * *Catatan Penting PayPal*: Webhook PayPal **hanya** dikirimkan ke port 443 dengan sertifikat SSL/TLS valid (misalnya Let's Encrypt / Certbot).
- **Satu instance**: Jalankan **satu instance** API Node.js di VPS (via systemd atau PM2).
- **Redis wajib untuk multi-node**: `REDIS_URL` harus aktif. Tanpa Redis, rate limiter, concurrency slot, dan circuit breaker jatuh ke state per-proses yang tidak sinkron dan hilang saat restart.

### 1.2 Dua node (Pooling Phase 2)

```
                        ┌──────────────────────────────┐
Internet ── 443 ──────► │ Server 1                     │
                        │  Nginx (SPOF)                │
                        │  API node 1  ─────────────┐  │
                        │  Redis (SPOF) ◄───────────┼──┼── private link
                        └───────────────────────────┼──┘   (Tailscale/WireGuard)
                                                    │
                        ┌───────────────────────────▼──┐
                        │ Server 2                     │
                        │  API node 2                  │
                        └──────────────────────────────┘
                                     │
                                     ▼
                              Neon Postgres (external)
```

- Kedua node memakai **`DATABASE_URL` yang identik** (Neon butuh **tidak ada** tunnel) dan **`.env` yang identik** (secret, kunci provider, payment config).
- Redis dishare lewat **private link** (Tailscale lebih disarankan, atau WireGuard). Redis **tidak pernah** dibuka ke publik.
- Background job memakai tabel `job_leases` di Postgres, jadi tiap interval hanya satu node yang menjalankan job (`JOB_LEASE_ENABLED=true`, default).
- Server 2 mulai sebagai upstream `backup` di Nginx. Setelah observasi, baru dipromosikan menjadi active-active.

> **Penting — availability:** Nginx **dan** Redis di Server 1 tetap **single point of failure**.
> Dua server di ISP/daya yang sama menambah **kapasitas**, bukan **availability**.
> Upgrade path: managed Redis (replikasi) dan/atau Cloudflare Tunnel dengan satu connector
> per server. Detail audit: `docs/MULTI_NODE_AUDIT.md`.

---

## 2. Konfigurasi Nginx

### 2.1 Satu node

Tambahkan blok konfigurasi reverse proxy berikut pada server block Nginx Anda:

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;          # Arahkan ke port internal Morphic API
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # PENTING: Timpa (overwrite) X-Forwarded-For dengan IP koneksi nyata ($remote_addr).
    # Jangan gunakan $proxy_add_x_forwarded_for karena klien luar dapat menyuntikkan IP palsu
    # di awal header untuk mengelabui rate limiter atau bypass IP filter.
    proxy_set_header X-Forwarded-For $remote_addr;

    # Beri tahu API bahwa request asli masuk lewat HTTPS
    proxy_set_header X-Forwarded-Proto $scheme;

    # Kosongkan / hapus header CF-Connecting-IP dari klien luar.
    # Karena deployment ini tidak menggunakan Cloudflare, header ini bisa dipalsukan oleh penyerang
    # jika tidak dibersihkan di level reverse proxy Nginx.
    proxy_set_header CF-Connecting-IP "";

    # Konfigurasi buffer & timeout standar
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_connect_timeout 15s;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
}
```

### 2.2 Dua node (upstream)

Gunakan file contoh lengkap: **`deploy/nginx/morphic-multi-node.conf.example`**. Inti konfigurasinya:

```nginx
upstream morphic_api {
    least_conn;
    server 100.64.0.1:3001 max_fails=3 fail_timeout=10s;          # Server 1
    server 100.64.0.2:3001 backup max_fails=3 fail_timeout=10s;   # Server 2 (awal)
    keepalive 32;
}

location / {
    proxy_pass http://morphic_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header CF-Connecting-IP "";

    # SSE: jangan buffer response.
    proxy_buffering off;
    proxy_cache off;

    proxy_connect_timeout 15s;
    # Harus >= UPSTREAM_TOTAL_TIMEOUT_MS + 30 detik.
    proxy_send_timeout 330s;
    proxy_read_timeout 330s;

    # HANYA error/timeout. JANGAN tambahkan `non_idempotent`: retry POST
    # /v1/chat/completions bisa mengirim completion dua kali (double cost +
    # risiko double-billing).
    proxy_next_upstream error timeout;
}
```

### 2.3 Penjelasan header

1. `proxy_pass http://…`: Meneruskan traffic ke API internal (loopback atau private link).
2. `proxy_set_header Host $host`: Menyampaikan nama domain yang diminta klien.
3. `proxy_set_header X-Real-IP $remote_addr`: Alamat IP klien terluar yang terhubung ke Nginx.
4. `proxy_set_header X-Forwarded-For $remote_addr`: Menimpa header hop dengan IP remote asli Nginx. Ini mencegah penyerang mengirim `X-Forwarded-For: 1.1.1.1` buatan sendiri.
5. `proxy_set_header X-Forwarded-Proto $scheme`: Menyampaikan protokol (`https`) ke API Hono.
6. `proxy_set_header CF-Connecting-IP ""`: Menghapus header Cloudflare palsu.
7. `proxy_buffering off`: Wajib untuk SSE/streaming (`/v1/chat/completions`, `/v1/messages`).
8. `proxy_next_upstream error timeout`: Retry hanya jika koneksi gagal/timeout. Nginx tidak me-retry method non-idempotent (POST/PATCH) secara default; menambahkan `non_idempotent` akan mengaktifkannya dan berbahaya untuk billing.

---

## 3. Private link antar node

- **Tailscale (disarankan)**: instal di kedua server, gunakan IP `100.x` untuk upstream Nginx dan `REDIS_URL`/bind address Redis. Traffic terenkripsi dan tidak perlu membuka port ke publik.
- **WireGuard**: alternatif setara; pastikan hanya subnet privat yang di-route.
- Neon **tidak butuh tunnel**: koneksi keluar HTTPS/WebSocket ke Neon. `DATABASE_URL` identik di kedua node.
- `.env` kedua node harus identik untuk semua secret (provider encryption key, payment credentials, alert tokens). Jangan menyalin `.env` lewat channel tidak aman.
- Redis **hanya** listen di interface private link, bukan `0.0.0.0` publik.

---

## 4. Redis untuk produksi / multi-node

Konfigurasi minimum:

```conf
bind 100.64.0.1 127.0.0.1
protected-mode yes
requirepass <strong-random-password>
maxmemory 32mb
maxmemory-policy allkeys-lru
save ""
appendonly no
```

- `requirepass`: wajib. Jangan pernah menjalankan Redis tanpa password di VPS.
- `maxmemory 32mb --maxmemory-policy allkeys-lru`: cukup untuk rate-limit counter, concurrency sorted set, circuit hash, trial key, dan alert cooldown pada skala saat ini.
- `--save ""`: tanpa snapshot. Restart Redis menghapus state (counter/circuit reset) — ini disengaja. Jangan menambah persistence hanya untuk "mempertahankan" counter rate limit.
- **Monitor `evicted_keys` dan pastikan tetap 0.** Eviction diam-diam menghapus counter/state:
  ```bash
  redis-cli -a "$REDIS_PASSWORD" INFO stats | grep evicted_keys
  redis-cli -a "$REDIS_PASSWORD" INFO memory | grep -E 'used_memory|maxmemory'
  redis-cli -a "$REDIS_PASSWORD" INFO keyspace
  ```
  Jika `evicted_keys` naik, naikkan `maxmemory` atau kurangi key TTL — jangan biarkan eviction berjalan.
- Redis adalah **SPOF** selama berada di Server 1. Jika Redis mati, API tetap melayani (fail-open: limit/circuit tidak ditegakkan), tetapi state bersama hilang sampai Redis kembali.
- **Redis lewat tunnel** (Tailscale/WireGuard): set `REDIS_COMMAND_TIMEOUT_MS=250` (default klien 100 ms terlalu agresif untuk round-trip tunnel). `REDIS_CONNECT_TIMEOUT_MS=1000` tetap.

### 4.1 docker-compose (local dev)

`docker-compose.yml` menjalankan Redis dengan:

- `--maxmemory 32mb --maxmemory-policy allkeys-lru --save ""`
- `requirepass` dari `REDIS_PASSWORD` (default lokal: `morphic`)
- port dipublikasikan **hanya ke `127.0.0.1`**
- healthcheck terautentikasi

`REDIS_URL` untuk service `api` otomatis memakai password yang sama. Jika `REDIS_PASSWORD` mengandung karakter khusus, URL-encode di `REDIS_URL` (contoh `p@ss` → `p%40ss`). Konfigurasi ini untuk lokal; produksi memakai private link dan secret yang kuat.

---

## 5. Environment wajib untuk deployment rumah / multi-node

| Variable | Nilai | Kenapa |
|---|---|---|
| `NODE_ENV` | `production` | Validasi config payment, perilaku produksi |
| `DATABASE_URL` | sama di kedua node | Neon, tanpa tunnel |
| `REDIS_URL` | `redis://:<password>@<private-ip>:6379` | State bersama |
| `REDIS_PASSWORD` | strong secret | `requirepass` (compose/produksi) |
| `REDIS_COMMAND_TIMEOUT_MS` | `250` | Redis lewat tunnel |
| `REQUIRE_REDIS` | `true` (multi-node) | Gagal boot jika `REDIS_URL` kosong, bukan diam-diam per-proses |
| `JOB_LEASE_ENABLED` | `true` (default) | Satu node per interval untuk 5 background job |
| `UPSTREAM_TOTAL_TIMEOUT_MS` | `300000` | Timeout total per attempt; TTL concurrency slot diturunkan dari nilai ini |
| `UPSTREAM_TTFB_TIMEOUT_MS` | `15000` (default) | Streaming TTFB |
| `ANTHROPIC_TOTAL_TIMEOUT_MS` | `180000` (default) | `/v1/messages` |

Catatan:

- `UPSTREAM_TOTAL_TIMEOUT_MS` **harus diset eksplisit** di env home-server (mis. `300000`). Nilai ini menentukan TTL slot concurrency (`ceil(total/1000) + 61` detik); jika terlalu kecil, slot bisa kedaluwarsa saat request masih berjalan.
- `proxy_read_timeout` Nginx harus **≥ `UPSTREAM_TOTAL_TIMEOUT_MS` + 30 s** (300000 ms → 330 s).
- `JOB_LEASE_ENABLED=false` hanya untuk single-node escape hatch. Jangan dipakai bersama multi-node atau PM2 cluster mode.
- `REQUIRE_REDIS=true` wajib untuk dua node: tanpa itu, salah konfigurasi akan diam-diam menjalankan limit/circuit per node.

---

## 6. Graceful shutdown (status saat ini)

`apps/api/src/index.ts` **belum** menangani `SIGTERM`/`SIGINT`, belum memanggil `server.close()`, dan belum melakukan drain request in-flight. Saat restart/deploy:

- Stream SSE yang sedang berjalan terputus.
- Reservation yang belum di-settle akan dirilis oleh sweep berikutnya (bisa di node lain).
- Job yang terhenti setelah mengambil lease akan dijalankan ulang pada interval berikutnya (semua job idempotent).

Rekomendasi (belum diimplementasikan, di luar scope Phase 2): handler `SIGTERM` yang menghentikan interval, `server.close()`, menunggu request in-flight (maksimal ~60 detik atau `UPSTREAM_TOTAL_TIMEOUT_MS`), lalu menutup koneksi Redis dan keluar. Atur timeout stop systemd/PM2/compose lebih besar dari `proxy_read_timeout` Nginx. Detail: `docs/MULTI_NODE_AUDIT.md` §4.

---

## 7. Checklist Sebelum Go-Live di VPS

1. [ ] Sertifikat SSL/TLS aktif pada domain dan listen di port 443.
2. [ ] API terikat ke `127.0.0.1`, firewall VPS (UFW) menutup port internal (3001).
3. [ ] `REDIS_URL` terhubung ke Redis dengan password; Redis hanya di private link.
4. [ ] `REQUIRE_REDIS=true` untuk multi-node; log boot tidak berisi `[ratelimit] REDIS_URL unset`.
5. [ ] `JOB_LEASE_ENABLED=true`; verifikasi tiap job berjalan sekali per interval di kedua node.
6. [ ] `evicted_keys` tetap `0` setelah load test.
7. [ ] `UPSTREAM_TOTAL_TIMEOUT_MS` diset eksplisit dan `proxy_read_timeout` ≥ nilai itu + 30 s.
8. [ ] Nginx: `proxy_buffering off`, `proxy_next_upstream error timeout` (tanpa `non_idempotent`).
9. [ ] `NODE_ENV=production` dan `PAYPAL_ENVIRONMENT=live` terpasang.
10. [ ] Webhook URL terdaftar di PayPal Live REST App: `https://<api-domain>/webhooks/paypal`.
11. [ ] Periksa log boot API: pastikan tidak ada peringatan loopback IP `[ip] client IP resolved to loopback...`.
12. [ ] Server 2 dimulai sebagai `backup`; promosi active-active setelah observasi.
13. [ ] SPOF Nginx + Redis di Server 1 diterima secara tertulis (atau upgrade ke managed Redis/Cloudflare Tunnel).
14. [ ] Keputusan untuk reasoning echo cache (sticky session / Redis / pin ke satu node) sebelum traffic `reasoning_echo_required` diarahkan ke dua node.
