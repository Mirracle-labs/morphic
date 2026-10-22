# Compatibility Notes — Protocol Track

Implementation record for Protocol Phases 0–3 and Pooling Phases 0/0.5/1A–1F. Owner-run where noted.
Last updated: 2026-10-22.

Scope: inbound OpenAI/Anthropic compatibility for the Hono gateway (`apps/api`).
Authoritative plans: `apps/api/plan-pooling-providers.md` (pooling), `apps/api/AGENTS.md` (protocol).

---

## 1. Environment

| Item | Value |
|---|---|
| Node | 24.10.0 |
| pnpm | 10.33.0 |
| Hono | **4.13.7** (range `^4.9.0`) |
| `@hono/node-server` | **1.19.17** (range `^1.15.0`) |
| Test runner | `node --test` via `tsx`, glob `src/**/*.test.ts` |
| Claude Code CLI | 2.1.224 |
| Test DB | Neon branch `ep-cold-voice-b4t6yp5x-pooler...`, database `neondb` |
| Redis (tests) | unset → in-memory stores |

### `.env.test`

- `ALLOW_TEST_DB_WRITE=1`, `NODE_ENV=test` ✅
- `DATABASE_URL` → Neon test database (same branch as dev; contains no production data)
- `TEST_DB_HOST_ALLOWLIST=ep-cold-voice-b4t6yp5x-pooler.c-6.us-east-2.aws.neon.tech` (required by `lib/test-guard.ts`; default allowlist is loopback only)
- `TRUST_CF_CONNECTING_IP=1` — required by `gateway.test.ts` ("CF-Connecting-IP wins") and `paypal-reconcile.test.ts` ("webhook surface rate-limits a single IP"). Without it both fail; they are test-env expectations, not code bugs.

`test-guard` still refuses `NODE_ENV=production` and any host not in the allowlist.

## 2. Baseline (2026-10-20)

| Command | Result |
|---|---|
| `pnpm --filter @morphic/api typecheck` | ✅ exit 0 |
| `pnpm --filter @morphic/api lint` | ✅ exit 0 (0 errors, 67 pre-existing `no-explicit-any` warnings) |
| `pnpm --filter @morphic/shared test` | ✅ 9/9 |
| `pnpm -w typecheck` | ✅ 4/4 packages |
| `pnpm --filter @morphic/api test` | ⚠️ **105/107 pass, 2 fail** (197 s) |

The two failures are environmental, not code regressions:

1. **`P1-04: per-key 429 carries Retry-After and zero remaining`**
   The test fires 121 sequential requests and expects the 121st to be throttled. `checkRateLimit` uses an **epoch-aligned fixed 60 s window** (`ratelimit.ts`: `bucket = floor(now/60_000)`). Against Neon each request takes ~1 s, so the 121 requests span >60 s, cross a window boundary, and the counter resets. Passes when the suite is fast (local Postgres); fails on a high-latency DB.
2. **`Security Test 1: Duitku /create bills a USD package in IDR`**
   Calls the real Duitku sandbox through `createTransaction` with placeholder credentials from `.env.test` → `502`. Needs sandbox credentials or fetch mocking; out of protocol scope.

Observed, not fixed: the 121-request test is also boundary-flaky on fast DBs when it starts within ~2 s of a minute boundary.

## 3. Claude Code behavior (verified, 2.1.224)

Probed with a local mock server; no real upstream involved.

| Behavior | Result |
|---|---|
| `ANTHROPIC_BASE_URL=http://host` | `POST /v1/messages?beta=true` |
| `ANTHROPIC_BASE_URL=http://host/v1` | `POST /v1/v1/messages?beta=true` → **base URL must not include `/v1`** |
| `?beta=true` | always sent; route must tolerate it |
| `ANTHROPIC_MODEL` | sent verbatim as `model`; CLI does not normalize aliases |
| Extra traffic | `HEAD /api/hello` (connectivity probe), plus a second non-stream POST |
| Auth header | `x-api-key` (Anthropic style) |

Implication: mount `/v1/messages`, accept `?beta=true`, ignore unknown fields, and map every `claude-*` model to `ANTHROPIC_DEFAULT_MODEL`.

## 4. Provider capabilities

Verified through **ZenMux** (`https://zenmux.ai/api/v1`, OpenAI-compatible) with the available key, model `deepseek/deepseek-v4.1-flash`.
The seeded official providers (DeepSeek, Qwen, Kimi) have **no API keys** in `.env`, so their matrix rows remain **PENDING**.

| Capability | ZenMux / deepseek-v4.1-flash | DeepSeek | Qwen | Kimi |
|---|---|---|---|---|
| Tools (single call) | ✅ `finish_reason=tool_calls` | PENDING | PENDING | PENDING |
| Parallel tool calls | ✅ 2 calls, no `parallel_tool_calls` flag needed | PENDING | PENDING | PENDING |
| Streaming usage chunk | ✅ with `stream_options.include_usage` | PENDING | PENDING | PENDING |
| `[DONE]` terminator | ✅ | PENDING | PENDING | PENDING |
| Reasoning surface | ✅ `message.reasoning` + `usage.completion_tokens_details.reasoning_tokens` | PENDING | PENDING | PENDING |
| Reasoning echo required | ⚠️ conditional — real tool history: 200 without echo; synthetic tool history: 400 `reasoning_content must be passed back` | PENDING | PENDING | PENDING |
| Vision (`image_url` data URI) | ✅ 200 | PENDING | PENDING | PENDING |
| `tool_choice: "required"` | ❌ **400** `Thinking mode does not support this tool_choice` | PENDING | PENDING | PENDING |
| `count_tokens` upstream | ❌ 404 (endpoint absent) | PENDING | PENDING | PENDING |

Upstream error shapes observed (ZenMux):

| Case | Status | Type |
|---|---|---|
| Unknown model | 404 | `invalid_model` |
| Bad key | **403** (not 401) | `access_denied` |
| Empty `messages` | 400 | `invalid_params` |
| Claude model with 0 balance | 402 | `reject_no_credit` |
| Missing `tool_call_id` on a `tool` message | 422 | `provider_unprocessable_entity_error` |

Implications for translation:

- `tool_choice: any → required` will break on this reasoning model. Phase 4 capability matrix needs a per-provider downgrade (e.g. `required → auto`), or the translator must fall back to `auto`.
- Reasoning echo is **conditional**. Echoing a real tool-loop history (assistant message produced by the model) works with or without `reasoning`. A synthetic/fabricated tool-call message without reasoning is rejected with `reasoning_content must be passed back`. Clients that drop reasoning fields may hit this on the second tool turn; Phase 4 owns re-injection (`reasoning_echo_required`).
- `count_tokens` must stay local (`ceil(chars/4)`); never proxy it.
- 422 is not in Appendix B explicitly; map like 400/422 → `provider_error`, no failover (matches plan).
- 402 already maps to `provider_auth_failed` (failover + alert) in Appendix B.
- Reasoning models bill reasoning tokens; `deltaText` must include `reasoning_content`/`reasoning` (already required by pooling Phase 0.5).

## 5. Decisions recorded

1. **`ANTHROPIC_DEFAULT_MODEL=deepseek-v4`** (owner decision). Every `claude-*` / `sonnet` request resolves to this public model; `/v1/models` still exposes one synthetic `claude-sonnet-4-5` alias.
2. Single Claude default; no opus/sonnet/haiku split.
3. Translation-first; no native Anthropic path in Phases 1–3.
4. Anthropic upstream endpoint exists (`https://zenmux.ai/api/anthropic/v1/messages`) but is **not** needed until optional Phase 5.

### Mapping needed for end-to-end Phase 2 testing

The seeded `deepseek-v4` row points at `https://api.deepseek.com/v1` with model `deepseek-chat` (no key). For local E2E, point the public model at a gateway provider:

- provider base URL: `https://zenmux.ai/api/v1` (adapter appends `/chat/completions`)
- credential: `env:ZENMUX_API_KEY`
- `provider_model_id`: `deepseek/deepseek-v4.1-flash`

This is DB data for the dev branch only; no schema/seed change.

## 6. Open `[VERIFY]` items

| Item | Status |
|---|---|
| Official DeepSeek/Qwen/Kimi tool/parallel/usage/reasoning/vision behavior | PENDING — no `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY` / `MOONSHOT_API_KEY` |
| Reasoning echo requirement per official provider | PENDING (ZenMux is conditional — see §4) |
| `tool_choice: required` support per official provider | PENDING |
| p95 turn duration to tune `ANTHROPIC_TOTAL_TIMEOUT_MS` | PENDING (needs real Claude Code run) |
| Memory impact of 32 MB body × concurrency | PENDING |
| DeepSeek `/anthropic` field compatibility | NOT NEEDED until Phase 5 |
| Claude Code `ANTHROPIC_BASE_URL` join / `ANTHROPIC_MODEL` | ✅ DONE (§3) |

## 7. Phase 1 implementation notes

Shipped modules:

- `apps/api/src/domain/normalize.ts` — `normalizeMessages`, `repairToolPairs`, `normalizeRequest`.
- `apps/api/src/domain/stream-finalize.ts` — `createOpenAiStreamFinalizer`, `startHeartbeat` (idle-only, line-boundary safe), `heartbeatMs`.
- `middleware/auth.ts` — `apiKeyAuth({ allowXApiKey })`; `x-api-key` only on inference routes.
- `routes/v1.ts` — normalization before reserve, `MAX_MESSAGES=2000`, guaranteed `[DONE]`, idle 15 s heartbeat, sanitized mid-stream error, internal upstream logging, no `status` in error envelopes.

Heartbeat semantics: `startHeartbeat` is armed at stream start and `touch()`ed on every upstream byte, so it only fires after `SSE_HEARTBEAT_MS` of real idleness. It is also suppressed while the last forwarded chunk ended mid-line (`atLineBoundary === false`) and after `[DONE]`, so a comment can never corrupt a partially written `data:` line.

Merge-order note (owner-directed): the `v1.ts` wiring landed **before** Pooling Phase 0/0.5.
All overlap points below have since been resolved by Pooling Phase 0/0.5; see §7.2.

- Phase 0d (drop `status: upstream.status`) is already applied here; pooling should drop that hunk.
- Phase 0.5 will split the same streaming `try/catch` into `clientGone` / `upstreamBroke`. Keep the finalizer and heartbeat; only the failure classification changes.
- Phase 1.4's "preserve pooling Phase 0 partial billing" is deferred by track separation: `billing.ts` is unchanged, so a client abort still settles `error` (full refund). The abort test only asserts that settle runs exactly once; it deliberately does not freeze the status, so Phase 0.5 can flip it to `partial`.
- `connection: close` in `router.ts` is untouched (Pooling 0f).
- The Phase 1 test `a 200 non-JSON upstream body is passed through` freezes today's behavior on purpose; Pooling 0b replaces it with a 502 and must update that test.

Rollback: `NORMALIZE_OPENAI=false` disables normalization only; the stream finalizer stays active.

Verification (2026-10-21):

- `typecheck` ✅, `lint` ✅ (0 errors, 68 warnings; none in Phase 1 files), `shared test` 9/9, `-w typecheck` 4/4.
- API suite: **153 tests, 151 pass, 2 fail**; both failures are the known environment cases from §2 (`P1-04` Neon latency vs the 60 s window and `Duitku /create` real-sandbox credentials).
- Phase 1 tests added: x-api-key success/rejection, CORS preflight, 2000-message cap, orphan/missing tool results, missing `[DONE]`, mid-stream error, upstream 400/401/429/500 mapping + no leakage, 200 non-JSON pass-through, idle heartbeat, client abort settles once, and a 2001-message rejection without an upstream call.

Live E2E through the local gateway + ZenMux (temporary DB rows, removed after; owner-run):

- single tool call via `x-api-key` → `tool_calls=1` (calc) ✅
- orphan tool message dropped → 200 ✅
- full tool loop (call → result) → 200 ✅
- stream → ends with `data: [DONE]` ✅

### Phase 1 exit checklist

- [x] `content:null`, `developer`, orphan/duplicate/missing tool results repaired.
- [x] OpenAI stream always ends with `[DONE]`.
- [x] Idle heartbeat works and cannot inject mid-line.
- [x] `x-api-key` and Bearer both work; `x-api-key` is rejected outside inference.
- [x] 10 MB cap and `MAX_MESSAGES=2000` enforced.
- [x] No upstream status/text/provider leakage in OpenAI error envelopes.
- [x] Typecheck and lint green; all Phase 1 tests green.
- [x] Partial billing on abort — delivered by Pooling Phase 0.5 (see §7.2).


## 7.1 Phase 2 implementation notes

**State:** complete (2026-10-21) and consolidated on `feature/api-implementation` (2026-10-22). The original merge-order deviation from AGENTS.md §5 (Phase 1/2 before Pooling 0/0.5) is resolved; the pooled route plan and shared failover loop are now on the feature branch.

Shipped files:

- `packages/shared/src/anthropic.ts` (new) — lenient zod schemas + wire types + `anthropicError`.
- `apps/api/src/domain/completion.ts` (new) — shared resolve → reserve → dispatch/failover → settle/log orchestration. `v1.ts` now uses it, so OpenAI and Anthropic share one billing implementation.
- `apps/api/src/domain/anthropic/request.ts` — Anthropic → OpenAI translation.
- `apps/api/src/domain/anthropic/response.ts` — OpenAI completion → Anthropic message.
- `apps/api/src/domain/anthropic/stream.ts` — OpenAI SSE → Anthropic SSE.
- `apps/api/src/routes/anthropic.ts` — `/v1/messages`, `/v1/messages/count_tokens`.
- `apps/api/src/app.ts` — mounts the route only when `ANTHROPIC_ENABLED=true`.
- `apps/api/src/routes/v1.ts` — synthetic `claude-sonnet-4-5` alias in `/v1/models` and `/v1/models/:id`.
- `apps/api/src/domain/router.ts` — additive `totalTimeoutMs` on `UpstreamRequest` only.
- Tests: `domain/anthropic/{request,response,stream}.test.ts`, `routes/anthropic.test.ts`.

Behavior:

- Auth: Bearer and `x-api-key`; `anthropic-version`, `anthropic-beta`, `?beta=true`, and unknown fields are tolerated.
- Model: every `claude-*` / `sonnet` request (including unknown ids) resolves to `ANTHROPIC_DEFAULT_MODEL`. Non-Claude ids pass through. Unset default ⇒ startup warning + 503 `api_error`.
- Limits: `ANTHROPIC_MAX_BODY_BYTES` (32 MiB), `MAX_MESSAGES` (2000), `ANTHROPIC_TOTAL_TIMEOUT_MS` (180 s per attempt). 32 MB cap runs before auth.
- Request translation: system string/array → one system message; text/image blocks; `tool_use`/`tool_result`; tool ids sanitized to `^[a-zA-Z0-9_-]+$`; `is_error` prefixed; tools/tool_choice/stop/metadata mapped; `cache_control`, `top_k`, `thinking` dropped; empty text blocks dropped; consecutive same-role turns merged; `normalizeMessages` + `repairToolPairs` applied; `max_tokens` clamped to the model context.
- Response translation: `msg_…` id, text and `tool_use` blocks, stop-reason mapping, usage from upstream (fallback estimate when missing), invalid tool JSON repaired to `{}`.
- Streaming: `message_start` → content blocks → `message_delta` → `message_stop`; `text_delta` streamed live; tool calls buffered and emitted as complete `tool_use` blocks with one `input_json_delta`; no `[DONE]`; `: ping` on the shared idle heartbeat; mid-stream failures emit `event: error` with a sanitized Anthropic envelope.
- Errors: 400/422 → 400 `invalid_request_error`; 401 → 401 `authentication_error`; 429 → 429 `rate_limit_error`; 503/529 → 529 `overloaded_error`; other 5xx/network/timeout → 500 `api_error`. No upstream text/status/provider.
- Billing/failover: shared `startCompletion`; the pooled route plan (Pooling 1E) now drives candidates and failover under one reservation; settle/log on every path. Partial billing on abort is delivered by Pooling 0.5.

Deviations / deferrals:

- **TTFB timeout ownership resolved.** It was added by Pooling Phase 1E: OpenAI uses `UPSTREAM_TTFB_TIMEOUT_MS` (15 s) and Anthropic uses `ANTHROPIC_TTFB_TIMEOUT_MS` (30 s).
- **Reasoning deltas dropped.** `thinking_delta` is optional in the plan; emitting unsigned thinking blocks can break Claude Code. Phase 4 owns reasoning echo.
- **`tool_choice: any → required`** exactly as AGENTS.md §2.1 requires. ZenMux/DeepSeek reasoning rejects `required`; Phase 4 owns the capability downgrade (see §4).
- **Claude Code 20+ step E2E not run here.** Wire-format text/stream/tool tests are automated; the multi-step CLI run remains owner-run.
- `partial` billing on abort is delivered by Pooling Phase 0.5 (§7.2).

Verification (2026-10-21):

- `pnpm --filter @morphic/api typecheck` ✅, `lint` ✅ (0 errors, 68 warnings, none in Phase 2 files).
- `pnpm -w typecheck` ✅ 4/4.
- Full API suite: **164 tests, 162 pass, 2 fail**; both failures are the known environment cases from §2 (`P1-04` and Duitku sandbox).
- Phase 2 tests: 26 translator unit tests + 11 route integration tests (text, stream, tools both ways, clamping, count_tokens, error mapping, missing default, invalid bodies, 32 MB cap, `/v1/models` alias).

Rollback: `ANTHROPIC_ENABLED=false` (route unmounts) or revert the Phase 2 PR. Billing/OpenAI behavior is unchanged apart from the shared orchestration extraction.

## 7.2 Pooling Phase 0 / 0.5 / 1A–1F

**State:** complete (2026-10-21) and consolidated on `feature/api-implementation` (2026-10-22). Phase 1G is intentionally deferred until 1E has run in production with `POOL_ENABLED=true` and no incidents.

Shipped:

- **Phase 0** — `lib/sse-sanitize.ts` (usage stripping, model rewrite, generic error payload), wired into streaming + non-stream `v1.ts`; abort miscount fixed in `completion.ts`; `connection: close` removed.
- **Phase 0.5** — `settle.status = 'partial'`; client-abort and upstream-break billing; `clientGone` / `upstreamBroke` split; `deltaText` includes reasoning deltas.
- **1A** — fail-fast Redis client options, fail-open store calls, env-derived slot TTL.
- **1B** — `model_provider_pool` table + migration `0014`, idempotent seed script (skips brand-only `qwen`/`kimi`).
- **1C** — circuit keys per `(providerId, providerModelId)`, single half-open trial, memo, provider aggregate.
- **1D** — 3-query routing snapshot with TTL/single-flight/stale-if-error, `createRoutePlan`, weighted ordering, deprecation redirect, `CB_LAST_RESORT`.
- **1E** — route-plan failover loop in shared `completion.ts`, `MAX_POOL_ATTEMPTS`, TTFB/total timeouts, Appendix B error classes, `Retry-After`, trial release, attempts collection.
- **1F** — `request_logs` pool columns (migration `0015`), `alertProviderProblem` with Redis/in-memory cooldown, failover/circuit/partial metrics.

Key env flags (all default safe):

| Flag | Default |
|---|---|
| `POOL_ENABLED` | false |
| `MAX_POOL_ATTEMPTS` | 3 |
| `ROUTER_CACHE_TTL_MS` | 30000 |
| `UPSTREAM_TTFB_TIMEOUT_MS` | 15000 |
| `ANTHROPIC_TTFB_TIMEOUT_MS` | 30000 |
| `UPSTREAM_TOTAL_TIMEOUT_MS` | 55000 (fallback chain) |
| `CB_LAST_RESORT` | false |
| `CB_TRIAL_TTL_MS` | total timeout + 5000 |
| `ALERT_PROVIDER_COOLDOWN_MS` | 600000 |

Verification: **300 API tests, 298 pass, 2 fail** — only the known `P1-04` and Duitku environment cases. `typecheck` 4/4, `lint` 0 errors, `shared` 9/9.

Rollback: `POOL_ENABLED=false` returns to legacy candidates immediately. Revert commits for a full rollback; migrations `0014`/`0015` are additive and safe to leave in place.

## 7.3 Phase 3 implementation notes

**State:** complete and committed on `feature/api-implementation` (2026-10-22). `main` remains `origin/main`.

Phase 3 was largely delivered by Pooling 1E: `routes/anthropic.ts` already called the shared `startCompletion` loop, which builds `createRoutePlan` and iterates `plan.next()`. This phase audited that path and closed the remaining gaps.

Shipped:

- `apps/api/src/routes/anthropic.ts` — streaming finalize now mirrors Phase 0.5:
  - `clientGone` detection via `stream.onAbort`, `stream.aborted`, `c.req.raw.signal.aborted`, and write failures.
  - Client abort after headers settles `partial` with `client_disconnected`.
  - Upstream break settles `partial` by default, or `error` when `PARTIAL_BILLING_UPSTREAM_BREAK=refund`; zero delivered tokens is `error`.
  - Explicit upstream error payload settles `error` with `invalid_upstream_response`.
  - A mid-stream break emits the sanitized `event: error` instead of a fabricated `message_stop`.
  - Idle heartbeat and normal `message_stop` behavior are unchanged.
- `apps/api/src/routes/anthropic.ts` — `provider_unavailable` now returns `503 api_error` with `Retry-After` clamped to 1–120 seconds and message `provider unavailable`. `routing_unavailable` / `provider_not_configured` remain `503 provider not configured`.
- `apps/api/src/routes/anthropic-failover.test.ts` (new) — 7 tests.

Audit:

- Anthropic completion uses the route plan and provider candidates: **yes**.
- All candidates use OpenAI translation: **yes** (`prepareBody` always translates; no `api_format`).
- Failover only before headers/first byte: **yes**; once a 2xx stream is returned, the route is fixed.
- Settle uses the served route's pricing/upstream pricing: **yes**; a fallback pool cost override was proven to affect `upstreamCostCredits` while the user charge stayed model-level.

Tests:

1. Primary `500` → fallback success; `attempts=2`, served fallback, `failover_reasons=['http_500']`, fallback pool pricing used.
2. All candidates `500` → `500 api_error`, full refund, no upstream leakage.
3. All circuits open → `503 api_error` + `Retry-After`, no upstream call, no reservation.
4. Client abort mid-stream → `partial`, charged, circuit stays closed, zero `recordFailure`.
5. Upstream cut mid-stream → `partial` by default / `error` with `PARTIAL_BILLING_UPSTREAM_BREAK=refund`; no failover after headers.
6. Deprecated alias redirect still fails over and sets `X-Morphic-Warning`.
7. Non-stream unusable body (`invalid_body`) fails over to a valid fallback.

Verification (2026-10-22):

- New file: **7/7 pass**.
- Full API suite: **307 tests, 305 pass, 2 fail** — only the known `P1-04` and Duitku environment cases.
- `pnpm -w typecheck`: 4/4.
- `lint`: 0 errors, 68 pre-existing warnings.
- Existing `anthropic.test.ts`: 11/11.

Deviations / observed:

- **Attempt exhaustion keeps the Phase 2 mapping.** Two candidates that both return `500` produce `500 api_error`, not a literal `503`; `503` is the all-circuits-open / no-usable-candidate path. Phase 3's “all fail → 503” wording is therefore satisfied by the circuit path, not by attempt exhaustion. Owner decision if a literal 503 is required.
- **`usage_records.provider_id` remains null.** `settle()` does not accept a provider id; `request_logs.served_provider_id` is the authoritative served-provider record. Fixing this needs `packages/db/src/billing.ts` (pooling-owned).
- **Claude Code 20+ step E2E is still owner-run.** Part C of `docs/pooling-phase-1e-manual-testing.md` covers it.

Rollback: set `ANTHROPIC_ENABLED=false` to unmount the route, or revert `routes/anthropic.ts` and the new test.

## 8. Test data hygiene

The API suite writes to the configured test DB and leaves rows behind (users, providers/models, packages, payments, ledger). After each baseline run, test rows are removed and the DB is restored to seed state (1 user, 3 providers, 3 models, seed packages).

Do not point `DATABASE_URL` in `.env.test` at production; `test-guard` will reject it unless the host is explicitly allowlisted.

## 9. Handoff — start here for Phase 4

**State:** Protocol Phases 0–3 and Pooling Phases 0/0.5/1A–1F are **complete** (2026-10-22) on `feature/api-implementation`. `main` remains `origin/main`. Phase 4 is next. Pooling 1G is deferred until 1E has run in production; Pooling Phase 2 (multi-server) and Protocol Phase 5 (native Anthropic) are not started.

Phase 2 modified files (already merged):

- `apps/api/src/app.ts`
- `apps/api/src/middleware/auth.ts`
- `apps/api/src/routes/v1.ts`
- `apps/api/src/routes/gateway.test.ts`
- `apps/api/src/domain/router.ts` (`totalTimeoutMs` only)
- `packages/shared/package.json`, `packages/shared/src/index.ts`

Phase 2 new files (already merged):

- `apps/api/src/domain/normalize.ts` + `normalize.test.ts`
- `apps/api/src/domain/stream-finalize.ts` + `stream-finalize.test.ts`
- `apps/api/src/domain/completion.ts`
- `apps/api/src/domain/anthropic/{request,response,stream}.ts` + tests
- `apps/api/src/routes/anthropic.ts` + `anthropic.test.ts`
- `packages/shared/src/anthropic.ts`

Phase 3 changed files (committed on `feature/api-implementation`):

- `apps/api/src/routes/anthropic.ts` (modified — stream finalize, partial billing, `Retry-After`)
- `apps/api/src/routes/anthropic-failover.test.ts` (new — 7 tests)

Local config already set (gitignored):

- `.env.test` → Neon URL, `TEST_DB_HOST_ALLOWLIST`, `TRUST_CF_CONNECTING_IP=1`
- `.env` → `ZENMUX_API_KEY`, `ANTHROPIC_DEFAULT_MODEL=deepseek-v4`
- To use the edge locally, also set `ANTHROPIC_ENABLED=true` (route is unmounted otherwise).

Phase 3 delivered (AGENTS.md §7):

- Anthropic completion uses the pooled route plan and provider candidates.
- All candidates use OpenAI translation in this phase; no `api_format`.
- Failover only before headers/first byte.
- Settle uses the served route's pricing/upstream pricing.
- Tests: primary fail → fallback; all candidates fail; all circuits open → 503 + `Retry-After`; client abort → no provider failure; partial stream → partial billing.
- Full notes and the 7 new tests: §7.3.

Phase 4 is **next**: provider capability matrix, reasoning echo/re-injection, and the `tool_choice: required` downgrade for reasoning models. Pooling 1G remains gated on production observation.

Before live E2E / Phase 4:

- `POOL_ENABLED=false` keeps legacy behavior; set it to `true` only after seeding `model_provider_pool` and verifying parity.
- point the public model at ZenMux: base `https://zenmux.ai/api/v1`, provider model `deepseek/deepseek-v4.1-flash`, credential `env:ZENMUX_API_KEY`.

Design around these upstream quirks:

- `tool_choice: required` → 400 on the reasoning model; Phase 4 needs a per-provider downgrade (`any → auto`).
- reasoning echo is conditional; Phase 2 drops `thinking` and reasoning deltas. If tool turn 2 fails against DeepSeek, Phase 4 owns re-injection (`reasoning_echo_required`).
- upstream `count_tokens` is 404; the local `ceil(chars/4)` estimate is the only path.
- bad key is 403 (not 401); 402 = `reject_no_credit`.
- Anthropic TTFB (30 s) is implemented in Pooling 1E via `ANTHROPIC_TTFB_TIMEOUT_MS`.

Known environment-only test failures: `P1-04` (Neon latency vs 60 s window) and `Duitku` (real sandbox + placeholder credentials).

After each test run, delete test rows and restore seed state (1 user, 3 providers, 3 models, 6 packages, 0 payments/usage/ledger).
