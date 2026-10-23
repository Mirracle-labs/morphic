# Multi-node audit — Pooling Phase 2B

Status: complete (2026-10-23). This is an **audit**, not a redesign. Items marked
"not fixed" are outside the Phase 2 allowlist and remain open decisions for the
owner.

Scope: running two API processes (two VPS hosts behind one Nginx) against the
same Neon database and one Redis. The companion infra/config changes live in
`DEPLOYMENT_VPS.md`, `deploy/nginx/morphic-multi-node.conf.example`, and
`docker-compose.yml`.

---

## 1. Boot guard added by this phase

`apps/api/src/lib/redis.ts` exports `redisRequirementError(env)`.

| `REQUIRE_REDIS` | `REDIS_URL` | Result |
|---|---|---|
| `true` | unset | `[redis] FATAL: …` + `process.exit(1)` at module load |
| `true` | set | boot normally |
| unset / `false` | unset | in-process fallbacks (single-node / local dev) |
| unset / `false` | set | shared Redis |

Only the literal `true` enables the guard. This prevents a multi-node deployment
from silently enforcing rate limits, concurrency, and circuit state per process.
It does **not** make Redis highly available: if Redis dies after boot, callers
still fail open (plan D12).

---

## 2. In-process state inventory

| State | Location | Shared backend? | Multi-node impact | Status |
|---|---|---|---|---|
| Rate-limit counters | `apps/api/src/ratelimit.ts` (`InMemoryRateLimitStore`) | Redis (`RedisRateLimitStore`) when `REDIS_URL` set; otherwise memory | Without Redis each node enforces its own RPM/limits ⇒ effective limit × node count. With Redis, shared. Fail-open during outage. | Guarded at boot by `REQUIRE_REDIS`; outage behavior unchanged (accepted, plan §11) |
| Concurrency slots | `apps/api/src/lib/redis-store.ts` Lua `ACQUIRE_SCRIPT` | Redis; memory fallback | Without Redis each node admits its own max. With Redis shared and atomic. Slot TTL derives from `UPSTREAM_TOTAL_TIMEOUT_MS`. | Shared when Redis is up; fail-open |
| Circuit breaker state | `apps/api/src/domain/circuit-breaker.ts` (`CircuitStore`) | Redis hash; `createMemoryStore()` when `redis` is null | Per-node circuits without Redis ⇒ a provider can be open on node A and closed on node B. | Shared when Redis is up; fail-open |
| Circuit open memo | `domain/circuit-breaker.ts` `openMemo` | **Process only**, max 2 s, open results only | A circuit opened on node A can keep serving on node B for ≤2 s. Stale-`false` is never cached. | Accepted (bounded, correctness-safe) |
| Provider aggregate dedupe | `domain/circuit-breaker.ts` `lastWrittenAggregate` | Process only | Both nodes may write the same deterministic aggregate to `providers.circuit_breaker_state`; last write wins with an identical value. Extra DB writes only. | Accepted |
| Router snapshot cache | `apps/api/src/domain/router.ts` | **Process only**, TTL `ROUTER_CACHE_TTL_MS` (30 s), single-flight, stale-if-error | A pool/profile edit propagates per node after ≤30 s. No cross-node correctness issue. Decrypted credentials are memoized per process (never logged/serialized). | Accepted |
| Reasoning echo cache | `apps/api/src/domain/anthropic/reasoning-cache.ts` | **Process only**, bounded 512 entries / 15 min | A tool follow-up that lands on the other node loses the cached reasoning. For entries with `reasoning_echo_required=true`, the upstream may reject the turn (`reasoning_content must be passed back`) unless the client echoes reasoning itself. This is the one in-process cache with a user-visible failure mode. | **Not fixed.** Mitigations: sticky routing by API key at Nginx, move the cache to Redis, or keep `ANTHROPIC_ENABLED`/reasoning-echo entries on one node until then. |
| Provider alert cooldown (`checkProviderHealth`) | `apps/api/src/lib/alert.ts` `lastAlertMap` | **Process only** | Both nodes can send the same "provider error rate" Telegram/webhook alert once per cooldown window ⇒ duplicate noise, no state damage. | Accepted for Phase 2; one job lease now means only one node runs the check per interval, so duplicates only occur on lease hiccups |
| Provider problem cooldown (`alertProviderProblem`) | `lib/alert.ts` `providerProblemCooldowns` | Redis `SET NX PX`, memory fallback | Shared when Redis is up. Fallback is per process. | Shared when Redis is up |
| Alert log throttle | `lib/redis-store.ts` `lastWarnAt` | Process only | Log noise only. | Accepted |
| Job-lease in-flight guard | `apps/api/src/lib/job-lease.ts` `inFlight` | **Process only by design** | Prevents one node overlapping itself. Cross-node exclusion is the `job_leases` table. | Intended |
| PayPal reconcile guard | `apps/api/src/index.ts` `reconcileRunning` | Process only | Redundant with `runLeased`'s in-flight guard; harmless. | Intended |
| Rate-limit/payment cooldown counters | `rateLimitStore` users (alerts, payment stuck alerts) | Redis / memory | Shared when Redis is up; otherwise duplicate per node. | Shared when Redis is up |

No other module-level mutable state was found that changes request correctness
(the SSE sanitizer, adapters, and translators are stateless per request).

---

## 3. pm2 / cluster usage

- No `ecosystem.config.js`, `pm2` dependency, `node:cluster`, or `cluster.fork`
  exists in the repository.
- `PRD-n-SPEC.md` §"Process model" and `DEPLOYMENT_VPS.md` mention PM2 only as a
  process manager for a **single** Node process. `docker-compose.yml` runs one
  `api` container.
- Phase 2's "two nodes" therefore means **two separate hosts/processes**, not
  PM2 cluster workers. If `pm2 start -i N` / cluster mode is ever used, each
  worker is a separate node: `job_leases` still serialises jobs, but every
  in-process cache above is duplicated `N` times and `REQUIRE_REDIS=true`
  becomes mandatory. `JOB_LEASE_ENABLED=false` must never be combined with
  cluster mode.

---

## 4. Graceful shutdown / SIGTERM / in-flight draining (P12)

**Current behavior:** `apps/api/src/index.ts` calls `serve(...)` and registers no
`SIGTERM`/`SIGINT` handler, no `server.close()`, and no drain window. On a
deploy, `systemctl restart`, PM2 reload, or container stop:

1. The process exits immediately; open SSE responses are cut.
2. An in-flight completion may not reach `settle()`; its reservation stays
   `reserved` until `sweepExpiredReservations` releases it (another node or the
   next tick). The user may receive content without being charged for it
   (same residual risk as a client abort before headers, plan §11).
3. A job interrupted after claiming its lease is abandoned; the next interval's
   winner re-runs it. This is safe **because** all five jobs are idempotent (see
   the P13 audit in `docs/COMPAT_NOTES.md` §7.5).
4. Redis/Neon sockets are closed by process exit; Neon transactions roll back.

**Not fixed (outside Phase 2 allowlist).** Recommended follow-up:

- Handle `SIGTERM`/`SIGINT`: stop the intervals, call `server.close()`, wait for
  in-flight requests (bounded, e.g. `min(UPSTREAM_TOTAL_TIMEOUT_MS, 60s)`), stop
  accepting new connections, then close the Redis client and exit.
- Make the systemd/compose stop timeout longer than `proxy_read_timeout` so
  Nginx does not cut streams before Node drains.
- Nginx must not retry POST completions (`proxy_next_upstream` without
  `non_idempotent`), otherwise a retried completion could double-bill.

---

## 5. Redis single point of failure and eviction

Deployment shape in Phase 2: Redis runs on **Server 1** and both API nodes use it
over the private link (Tailscale/WireGuard).

- **SPOF:** if Server 1 or Redis dies, both nodes lose shared circuit/rate-limit
  state. The API keeps serving because every Redis call fails open (plan D12),
  but limits and circuits are no longer enforced correctly until Redis returns.
  Alerts that use `alertProviderProblem` fall back to per-process cooldowns.
- **Eviction:** `--maxmemory 32mb --maxmemory-policy allkeys-lru` is enough for
  rate-limit counters, concurrency sorted sets, circuit hashes, trial keys, and
  alert cooldowns at the current scale. Any `evicted_keys` growth silently drops
  live state (circuits reset closed, limits reset, slots vanish), so
  `evicted_keys` **must stay 0**. Monitor `INFO stats` (`evicted_keys`),
  `INFO memory` (`used_memory`, `maxmemory`), and `INFO keyspace`.
- **No persistence:** `--save ""` disables RDB snapshots. A Redis restart loses
  all state. That is acceptable (counters are short-lived; circuits reset
  closed), but it must be a conscious choice: do not add persistence just to
  "keep" rate-limit counters, because stale counters across a restart are worse.
- **Never public:** bind to the private interface only and require a password.
  The compose file binds to `127.0.0.1` for local development and documents that
  production must use the private link address, not the public interface.
- **Tunnelled Redis:** set `REDIS_COMMAND_TIMEOUT_MS=250` (client default is
  100 ms) so a Tailscale/WireGuard round-trip does not make every command fail
  open. `REDIS_CONNECT_TIMEOUT_MS=1000` remains.

**Upgrade path:** managed Redis (e.g. Upstash/ElastiCache) with replication, or a
second Redis on Server 2 if the private link is reliable. Until then, Server 1
is a single point of failure for both Nginx and Redis.

---

## 6. Nginx / network single point of failure

- Nginx runs on **Server 1**. If Server 1 goes down, the site is down even if
  Server 2 is healthy. Server 2 as a `backup` upstream only helps when Server 1's
  **API process** fails, not when the host/Nginx fails.
- Two servers on the same ISP and power feed add **capacity**, not availability.
  A shared switch, ISP, or power failure takes both down.
- Upgrade path: a second Nginx/load balancer on Server 2 with DNS failover, or
  Cloudflare Tunnel with one `cloudflared` connector per server (Cloudflare then
  owns the LB/failover), plus managed Redis.

---

## 7. Action checklist before enabling Server 2

1. [ ] `REQUIRE_REDIS=true` and `REDIS_URL` set on **both** nodes; boot logs
       contain no `[ratelimit] REDIS_URL unset` warning.
2. [ ] Identical `DATABASE_URL` and identical `.env` secrets on both nodes.
3. [ ] Redis private-link address (Tailscale/WireGuard), `requirepass`, and the
       password present in both nodes' `REDIS_URL`.
4. [ ] `REDIS_COMMAND_TIMEOUT_MS=250` for tunnelled Redis.
5. [ ] `UPSTREAM_TOTAL_TIMEOUT_MS=300000` explicitly set (concurrency slot TTL
       derives from it); Nginx `proxy_read_timeout` ≥ 330 s.
6. [ ] `JOB_LEASE_ENABLED=true` (default). Verify each job logs once per interval
       across both nodes, not once per node.
7. [ ] `evicted_keys` is 0 after a load test.
8. [ ] Decide what to do about the reasoning echo cache before routing
       `reasoning_echo_required` traffic to both nodes (sticky sessions, Redis,
       or single-node pinning).
9. [ ] Server 2 starts as an Nginx `backup`; only promote to active-active after
       observing per-node request split and rate-limit consistency.
10. [ ] Accept the documented SPOFs (Nginx + Redis on Server 1) in writing.
