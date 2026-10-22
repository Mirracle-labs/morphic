# Pooling Phase 1E — Manual Verification

| Field | Value |
|---|---|
| Scope | Route-plan failover loop, TTFB/total timeouts, Appendix B, partial billing, 1F observability |
| Code | `feature/api-implementation` (Phase 3 head `952a598`) |
| Part A — automated suite | **Complete** (2026-10-21): 300 API tests, 298 pass; only `P1-04` and Duitku `/create` fail |
| Part B — staging failover smoke test | **Complete** (All 8 checks PASS) |
| Part C — owner Claude Code E2E | **Complete** (PASS — Claude Code v2.1.224) |

> **Safety:** do all manual testing against a dev/staging database and dedicated test providers. Do not disable shared providers, edit production rows, or run the seed against production.

---

## Part A — Already completed

This document does not repeat Part A. The automated evidence is:

- `apps/api/src/routes/v1-failover.test.ts` — 14 × `1E:` tests + 3 × `1F:` tests
- Full API suite: 300 tests, 298 pass, 2 known environment failures
- `typecheck`: 4/4 packages
- `lint`: 0 errors, 68 warnings
- `@morphic/shared`: 9/9

The manual checks below are for staging confidence and for the real-Claude-Code acceptance run.

---

# Part B — Staging failover smoke test

## B0. What this proves

| Check | What it proves |
|---|---|
| B4 — healthy primary | Pool routing still serves the normal path |
| B5 — network failure | A dead primary fails over to the backup |
| B6 — 5xx | An upstream 5xx fails over and logs `http_500` |
| B7 — all candidates fail | The request returns a clean 5xx, not a hang or a double charge |
| B8 — TTFB | A provider that never sends headers is abandoned within the budget |
| B9 — all circuits open | The API returns `503 provider_unavailable` with `Retry-After` |
| B10 — client abort | The user is charged for delivered tokens, status is `partial` |
| B11 — observability | `request_logs` and metrics record attempts and reasons |

## B1. Prerequisites

- [x] A staging/dev `DATABASE_URL` (not production)
- [x] An `mp-...` API key for a test user
- [x] A dedicated public model with **two** pool candidates:
  - priority `1`: primary provider
  - priority `2`: backup provider
- [x] Both providers resolve a credential
- [x] Migrations `0014` and `0015` applied
- [x] `POOL_ENABLED=true` in the API process

### Find the model and its candidates

```sql
-- The model under test
SELECT id, public_model_id, status, context_length
FROM models
WHERE public_model_id = '<public-model-id>';

-- Its pool
SELECT
  mpp.priority,
  p.name AS provider,
  mpp.provider_model_id,
  mpp.weight,
  mpp.is_enabled,
  p.status AS provider_status,
  (p.encrypted_credentials IS NOT NULL OR p.credential_reference IS NOT NULL)
    AS has_credential
FROM model_provider_pool mpp
JOIN providers p ON p.id = mpp.provider_id
WHERE mpp.model_id = '<model-uuid>'
ORDER BY mpp.priority;
```

You need at least two rows with `is_enabled = true`, `provider_status = 'active'`, and `has_credential = true`.

## B2. Apply migrations and seed the pool

```bash
cd /home/rose/projects/morphic

# Point this at the STAGING database, not production.
export DATABASE_URL='<staging-database-url>'

pnpm --filter @morphic/db migrate

# Review the SELECT previews first, then run.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f packages/db/scripts/seed-model-provider-pool.sql
```

Optional helper for the test user, API key, and two ZenMux providers:

```bash
pnpm --filter @morphic/db setup:manual
```

It loads `.env.test` first (`.env` only fills missing secrets such as `ZENMUX_API_KEY`), and refuses production or unallowlisted databases.

The seed is idempotent and skips brand-only providers (`qwen`, `kimi`). It only creates priority `2` when `models.fallback_provider_id` is set and different.

If your test model has no fallback, add one manually:

```sql
INSERT INTO model_provider_pool
  (model_id, provider_id, provider_model_id, priority, weight, is_enabled)
VALUES
  ('<model-uuid>', '<backup-provider-uuid>', '<backup-model-string>', 2, 100, true)
ON CONFLICT (model_id, provider_id) DO NOTHING;
```

Do not mix pool rows and legacy fallback for the same model: when `POOL_ENABLED=true` and the model has at least one enabled pool row, the pool wins.

## B3. Configure and start the API

Use a dedicated process for this test:

```bash
export POOL_ENABLED=true
export MAX_POOL_ATTEMPTS=3
export ROUTER_CACHE_TTL_MS=30000
export UPSTREAM_TOTAL_TIMEOUT_MS=55000
export UPSTREAM_TTFB_TIMEOUT_MS=15000

pnpm --filter @morphic/api dev
```

The port is `API_PORT`, default `8787`.

> The router snapshot caches models, providers, and pool rows for `ROUTER_CACHE_TTL_MS`. After changing those rows, wait 30 s or restart the API.

## B4. Baseline — healthy primary

```bash
export MP_KEY='mp-...'
export BASE='http://localhost:8787'
export MODEL='<public-model-id>'

curl -sS "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $MP_KEY" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}]}"
```

Expected:

- HTTP `200`
- normal OpenAI-compatible body
- `request_logs` row has `attempts = 1`
- `failover_reasons = []`
- `served_provider_id` is the primary

```sql
SELECT
  request_id,
  served_provider_id,
  served_provider_model_id,
  attempts,
  failover_reasons,
  attempt_latencies_ms,
  status
FROM request_logs
ORDER BY created_at DESC
LIMIT 1;
```

## B5. Failover — primary network failure

On staging, point the **dedicated primary** at a closed port:

```sql
UPDATE providers
SET base_url = 'http://127.0.0.1:9'
WHERE id = '<primary-provider-uuid>';
```

Wait for the cache TTL or restart the API, then repeat the B4 request.

Expected:

- HTTP `200` from the backup
- `attempts = 2`
- `failover_reasons` contains `network`
- `served_provider_id` is the backup
- only one `usage_records` row
- one reservation, settled once

Restore the primary:

```sql
UPDATE providers SET base_url = '<original-base-url>' WHERE id = '<primary-provider-uuid>';
```

## B6. Failover — primary 5xx

Start a tiny local server that returns `500` for every request:

```bash
node -e "require('http').createServer((req,res)=>{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'boom'}}))}).listen(9998,()=>console.log('500 server on 9998'))"
```

Point the primary at it:

```sql
UPDATE providers SET base_url = 'http://127.0.0.1:9998' WHERE id = '<primary-provider-uuid>';
```

Wait for the cache TTL, request again.

Expected:

- HTTP `200` from the backup
- `attempts = 2`
- `failover_reasons = ['http_500']`
- `attempt_latencies_ms` has two entries

Restore the primary afterward.

## B7. All candidates fail

Point **both** dedicated providers at the `500` server, or stop it after pointing both at it.

Wait for the cache TTL, then request.

Expected:

- HTTP `5xx` (the last normalized failure; a `500` upstream normally maps to `502 provider_error`)
- no upstream body or upstream status leaked to the client
- `request_logs.status = 'error'`
- `attempts = 2` (or `MAX_POOL_ATTEMPTS`, whichever is lower)
- the reservation is refunded exactly once
- no duplicate usage row

Then restore both providers.

## B8. TTFB — provider accepts but never sends headers

Start a server that holds the connection:

```bash
python3 - <<'PY'
import socket, time
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', 9999))
s.listen(5)
print('holding connections on 9999')
while True:
    c, _ = s.accept()
    # Never write a response; hold the socket open.
    time.sleep(300)
PY
```

Point the primary at `http://127.0.0.1:9999`, keep the backup healthy, and set a short TTFB budget:

```bash
export UPSTREAM_TTFB_TIMEOUT_MS=2000
pnpm --filter @morphic/api dev
```

Use a **streaming** request (TTFB applies only to streams):

```bash
curl -N "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $MP_KEY" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Write a long answer\"}]}"
```

Expected:

- failover in roughly 2 seconds
- final HTTP `200` from the backup
- `failover_reasons` contains `ttfb_timeout`
- `attempts = 2`

A non-streaming request ignores TTFB and uses only `UPSTREAM_TOTAL_TIMEOUT_MS`.

## B9. All circuits open → 503 + Retry-After

Temporarily make the circuit trip on one failure:

```bash
export CB_FAILURE_THRESHOLD=1
export CB_FAILURE_WINDOW_MS=60000
export CB_OPEN_DURATION_MS=60000
export CB_LAST_RESORT=false
```

Restart the API so the new env values are loaded. Then point both candidates at the `500` server, wait for the cache TTL, and send the request once. That request records failures for both candidates and opens both circuits.

Send a second request.

Expected:

- HTTP `503`
- body error code `provider_unavailable`
- `Retry-After` header present, between `1` and `120` seconds
- **no reservation** created for the second request
- no charge

Restore `CB_FAILURE_THRESHOLD` and both provider URLs afterward. If you set `CB_LAST_RESORT=true`, the API will probe the earliest-reopening circuit once instead of returning 503.

## B10. Client abort → partial billing

Use a streaming request and press `Ctrl-C` after the first content chunk:

```bash
curl -N "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $MP_KEY" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Write 500 words\"}]}"
```

Wait a second, then:

```sql
SELECT
  status,
  credits_consumed,
  completion_tokens,
  streamed,
  error
FROM usage_records
ORDER BY created_at DESC
LIMIT 1;
```

Expected:

- `status = 'partial'`
- `credits_consumed > 0`
- `streamed = true`
- the remainder is refunded (the reservation is not charged in full)
- `request_logs.status = 'partial'`

A client abort must **not** increment the provider circuit or `recordFailure`.

## B11. Observability checks

API logs should contain structured lines:

```text
[metrics] completion { ... }
[metrics] failover { ... }
[metrics] circuit_open { ... }
[metrics] client_disconnected_partial { ... }
```

Check:

- [x] `[metrics] completion` has one entry per completed request
- [x] `[metrics] failover` appears only after a failed attempt
- [x] `[metrics] circuit_open` appears when a circuit transitions
- [x] `[metrics] client_disconnected_partial` appears after B10
- [x] `request_logs.attempts` matches the number of dispatches
- [x] `request_logs.attempt_latencies_ms` length matches `attempts`
- [x] no prompt text, credential, or upstream authorization header appears in logs

## B12. Reset

- [x] Restore all provider `base_url` values
- [x] Restore `CB_FAILURE_THRESHOLD`, `CB_FAILURE_WINDOW_MS`, `CB_OPEN_DURATION_MS`
- [x] Set `POOL_ENABLED=false` (or your normal staging value)
- [x] Stop the local `500` and TTFB servers
- [x] Remove any dedicated test pool rows if they are no longer needed

### Part B result log

| Check | Result | Notes |
|---|---|---|
| B4 healthy primary | ✅ PASS | `req: 1f5b8521...`, attempts: 1, failover_reasons: [], primary served |
| B5 network failover | ✅ PASS | `req: 42f51d3d...`, attempts: 2, failover_reasons: ["network"], backup served |
| B6 5xx failover | ✅ PASS | `req: c66e7544...`, attempts: 2, failover_reasons: ["http_500"], backup served |
| B7 all candidates fail | ✅ PASS | `req: f496dd40...`, HTTP 502 provider_error, attempts: 2, reservation refunded |
| B8 TTFB failover | ✅ PASS | `req: 0d4bcae6...`, attempts: 2, failover_reasons: ["ttfb_timeout"] (2004ms), backup served |
| B9 all circuits open | ✅ PASS | `req: 46f8591e...`, HTTP 503 provider_unavailable, Retry-After: 53, 0 reservations created |
| B10 partial billing | ✅ PASS | `req: db37fdb5...`, status: partial, 1 credit billed, reservation refunded |
| B11 observability | ✅ PASS | Structured metrics (completion, failover, circuit_open, partial) all verified; no leaks |

---

# Part C — Owner Claude Code E2E

## C0. What “owner E2E” means

Run the **real Claude Code CLI** against the gateway, through the Anthropic edge (`/v1/messages`), with a real upstream provider (ZenMux). Complete a coding task that takes **20+ tool turns**.

This is not a code phase. It is the acceptance test that synthetic tests cannot fully replace.

### Why it matters

Automated tests use synthetic payloads. Claude Code sends real-world shapes:

- `?beta=true`, `anthropic-version`, `anthropic-beta`
- `x-api-key` auth
- `system` arrays with `cache_control`
- `tool_use` / `tool_result` blocks across many turns
- streaming event order and `count_tokens`
- `claude-*` aliases that must map to the configured public model

It establishes a baseline **before Phase 3**, which changes how Anthropic selects providers. If the translation layer is broken, Phase 3 debugging becomes much harder.

## C1. Create a dedicated provider and model

Use a dedicated public model so you do not disturb shared rows.

```sql
-- 1. Provider
INSERT INTO providers (name, base_url, credential_reference, status)
VALUES (
  'zenmux-manual',
  'https://zenmux.ai/api/v1',
  'env:ZENMUX_API_KEY',
  'active'
)
ON CONFLICT (name) DO UPDATE SET
  base_url = EXCLUDED.base_url,
  credential_reference = EXCLUDED.credential_reference,
  status = 'active'
RETURNING id;

-- 2. Model
INSERT INTO models (
  provider_id,
  public_model_id,
  provider_model_id,
  display_name,
  context_length,
  capabilities,
  input_credits_per_1m,
  output_credits_per_1m,
  status
)
VALUES (
  '<provider-uuid>',
  'zenmux-deepseek',
  'deepseek/deepseek-v4.1-flash',
  'ZenMux DeepSeek V4.1 Flash',
  128000,
  '["coding","reasoning"]'::jsonb,
  100,
  300,
  'active'
)
ON CONFLICT (public_model_id) DO UPDATE SET
  provider_id = EXCLUDED.provider_id,
  provider_model_id = EXCLUDED.provider_model_id,
  status = 'active';
```

If you want to exercise the pooled path for Anthropic as well, add a pool row and enable `POOL_ENABLED=true`:

```sql
INSERT INTO model_provider_pool
  (model_id, provider_id, provider_model_id, priority, weight, is_enabled)
VALUES
  ('<model-uuid>', '<provider-uuid>', 'deepseek/deepseek-v4.1-flash', 1, 100, true)
ON CONFLICT (model_id, provider_id) DO NOTHING;
```

For the first baseline run, leave `POOL_ENABLED=false` so you are testing translation, not pooling.

## C2. Configure the API

```bash
export ANTHROPIC_ENABLED=true
export ANTHROPIC_DEFAULT_MODEL=zenmux-deepseek
export ANTHROPIC_TOTAL_TIMEOUT_MS=180000
export ANTHROPIC_TTFB_TIMEOUT_MS=30000
export ZENMUX_API_KEY='<your ZenMux key>'

pnpm --filter @morphic/api dev
```

`ANTHROPIC_DEFAULT_MODEL` must match a `models.public_model_id`.

Verify the API is reachable:

```bash
curl -sS http://localhost:8787/health
```

## C3. Start Claude Code

Use a scratch repository, not the Morphic repo:

```bash
export ANTHROPIC_BASE_URL='http://localhost:8787'
export ANTHROPIC_API_KEY='mp-...'
export ANTHROPIC_MODEL='claude-sonnet-4-5'

claude
```

Important:

- `ANTHROPIC_BASE_URL` must **not** include `/v1`.
- If your Claude Code build uses `ANTHROPIC_AUTH_TOKEN`, set that to the same `mp-...` key. The gateway accepts both `Authorization: Bearer` and `x-api-key`.
- `ANTHROPIC_MODEL` is sent verbatim as a `claude-*` alias; the gateway maps it to `ANTHROPIC_DEFAULT_MODEL`.

## C4. Run a 20+ step task

Use a task that forces multiple tool loops. Example prompt:

> Read `src/foo.ts`, add input validation, add a unit test, run the test suite, fix any failures, then update the README. Do not stop until the tests pass.

The exact task does not matter; the point is **20+ steps** with reads, edits, and command execution.

## C5. Observe

- [x] `/v1/messages` returns `200` and streams `message_start` → `message_stop`
- [x] `tool_use` / `tool_result` loops continue across many turns
- [x] `count_tokens` returns local estimates
- [x] no provider name or provider model string leaks in responses
- [x] `usage_records` and `request_logs` contain the Anthropic requests
- [x] `X-Morphic-Warning` appears only for deprecated models
- [x] no 400 from `cache_control`, `thinking`, or `tool_result` shape
- [x] the CLI completes the task without manual retries

Useful checks:

```sql
SELECT request_id, model_alias, status, attempts, error_type, created_at
FROM request_logs
ORDER BY created_at DESC
LIMIT 10;

SELECT request_id, status, credits_consumed, completion_tokens
FROM usage_records
ORDER BY created_at DESC
LIMIT 10;
```

## C6. Known Phase 4 quirks

These are expected on a reasoning model and are **not** Phase 2/3 failures:

- `tool_choice: required` may return `400` from the upstream because the reasoning model rejects it.
- Tool turn 2 may fail with `reasoning_content must be passed back`, because Phase 2 drops `thinking` and does not echo `reasoning_content`.

If either happens, record it as Phase 4 input. Do not change the Phase 2 contract to “fix” it during the E2E.

## C7. Record the result

| Field | Value |
|---|---|
| Date | 2026-10-22 |
| Claude Code version | `v2.1.224` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` |
| `ANTHROPIC_DEFAULT_MODEL` | `zenmux-deepseek` |
| Upstream provider/model | ZenMux (`deepseek/deepseek-v4.1-flash`) |
| Pool enabled? | `true` |
| Steps completed | 20+ steps verified |
| Result | ✅ PASS |
| Quirks observed | None |
| Notes | Real-world CLI loops verified against `/v1/messages`. Successfully completed multi-step tool-use loops without errors or parameter rejects. |

---

# Appendix

## Environment reference

| Variable | Default | Purpose |
|---|---|---|
| `POOL_ENABLED` | `false` | Use `model_provider_pool`; off = legacy candidates |
| `MAX_POOL_ATTEMPTS` | `3` | Max sequential attempts |
| `ROUTER_CACHE_TTL_MS` | `30000` | Routing snapshot TTL |
| `UPSTREAM_TOTAL_TIMEOUT_MS` | `UPSTREAM_TIMEOUT_MS`, then `55000` | Whole-attempt timeout |
| `UPSTREAM_TTFB_TIMEOUT_MS` | `15000` | Streaming time to first byte |
| `CB_FAILURE_THRESHOLD` | `5` | Failures before a circuit opens |
| `CB_FAILURE_WINDOW_MS` | `60000` | Failure counter window |
| `CB_OPEN_DURATION_MS` | `120000` | How long a circuit stays open |
| `CB_TRIAL_TTL_MS` | total timeout + `5000` | Half-open trial claim TTL |
| `CB_LAST_RESORT` | `false` | Probe earliest-reopening circuit when all are open |
| `ALERT_PROVIDER_COOLDOWN_MS` | `600000` | Per `(provider,status)` alert cooldown |
| `ANTHROPIC_ENABLED` | `false` | Enable `/v1/messages` |
| `ANTHROPIC_DEFAULT_MODEL` | unset | Public model used for `claude-*` aliases |
| `ANTHROPIC_TOTAL_TIMEOUT_MS` | `180000` | Anthropic total timeout |
| `ANTHROPIC_TTFB_TIMEOUT_MS` | `30000` | Anthropic TTFB timeout |

## Handy SQL

```sql
-- Latest request log
SELECT request_id, model_alias, status, attempts,
       served_provider_id, served_provider_model_id,
       failover_reasons, attempt_latencies_ms, created_at
FROM request_logs
ORDER BY created_at DESC
LIMIT 5;

-- Latest usage
SELECT request_id, status, credits_consumed, prompt_tokens,
       completion_tokens, streamed, created_at
FROM usage_records
ORDER BY created_at DESC
LIMIT 5;

-- Provider circuit state
SELECT name, status, circuit_breaker_state
FROM providers
ORDER BY name;

-- Pool rows for one model
SELECT mpp.priority, p.name, mpp.provider_model_id,
       mpp.weight, mpp.is_enabled, mpp.ttfb_timeout_ms
FROM model_provider_pool mpp
JOIN providers p ON p.id = mpp.provider_id
WHERE mpp.model_id = '<model-uuid>'
ORDER BY mpp.priority;
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Request still uses the old provider | Wait `ROUTER_CACHE_TTL_MS` or restart the API |
| `provider_not_configured` | The model has zero usable candidates; check pool rows, provider status, and credentials |
| `provider_unavailable` + `Retry-After` | All circuits are open; wait or inspect `providers.circuit_breaker_state` |
| No failover | `POOL_ENABLED=false`, or only one candidate, or the error is non-failover (e.g. total timeout) |
| `routing_unavailable` | The snapshot never loaded; check DB connectivity and API logs |
| Anthropic 503 | `ANTHROPIC_ENABLED` or `ANTHROPIC_DEFAULT_MODEL` is unset |
| Claude Code hits `/v1/v1/messages` | Remove `/v1` from `ANTHROPIC_BASE_URL` |

## Rollback

- Set `POOL_ENABLED=false` for an immediate return to legacy candidates.
- Restore any provider rows changed during testing.
- Migrations `0014` and `0015` are additive and safe to leave in place.
- The seed script is idempotent; remove test rows by `(model_id, provider_id)` if needed.
