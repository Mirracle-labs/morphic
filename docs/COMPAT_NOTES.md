# Compatibility Notes — Protocol Track

Phase 0 record (baseline + `[VERIFY]` findings). Owner-run where noted.
Last updated: 2026-10-21.

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
Overlap points for the pooling PR:

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
- [ ] Partial billing on abort — owned by Pooling Phase 0.5, not this track.


## 7.1 Phase 2 implementation notes

**State:** complete and green in the working tree (2026-10-21). Merge-order deviation from AGENTS.md §5 remains: Phase 1 and Phase 2 landed before Pooling Phase 0/0.5.

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
- Billing/failover: shared `startCompletion`; one runtime failover on network error/5xx under one reservation; settle/log on every path. `partial` on client abort remains Pooling Phase 0.5.

Deviations / deferrals:

- **TTFB timeout not added.** AGENTS.md file ownership allows Phase 2 to touch `router.ts` only for `totalTimeoutMs`; `UPSTREAM_TTFB_TIMEOUT_MS` / `ANTHROPIC_TTFB_TIMEOUT_MS` belong to Pooling Phase 1E.
- **Reasoning deltas dropped.** `thinking_delta` is optional in the plan; emitting unsigned thinking blocks can break Claude Code. Phase 4 owns reasoning echo.
- **`tool_choice: any → required`** exactly as AGENTS.md §2.1 requires. ZenMux/DeepSeek reasoning rejects `required`; Phase 4 owns the capability downgrade (see §4).
- **Claude Code 20+ step E2E not run here.** Wire-format text/stream/tool tests are automated; the multi-step CLI run remains owner-run.
- `partial` billing on abort is still Phase 0.5.

Verification (2026-10-21):

- `pnpm --filter @morphic/api typecheck` ✅, `lint` ✅ (0 errors, 68 warnings, none in Phase 2 files).
- `pnpm -w typecheck` ✅ 4/4.
- Full API suite: **164 tests, 162 pass, 2 fail**; both failures are the known environment cases from §2 (`P1-04` and Duitku sandbox).
- Phase 2 tests: 26 translator unit tests + 11 route integration tests (text, stream, tools both ways, clamping, count_tokens, error mapping, missing default, invalid bodies, 32 MB cap, `/v1/models` alias).

Rollback: `ANTHROPIC_ENABLED=false` (route unmounts) or revert the Phase 2 PR. Billing/OpenAI behavior is unchanged apart from the shared orchestration extraction.

## 8. Test data hygiene

The API suite writes to the configured test DB and leaves rows behind (users, providers/models, packages, payments, ledger). After each baseline run, test rows are removed and the DB is restored to seed state (1 user, 3 providers, 3 models, seed packages).

Do not point `DATABASE_URL` in `.env.test` at production; `test-guard` will reject it unless the host is explicitly allowlisted.

## 9. Handoff — start here for Phase 3

**State:** Phase 0, Phase 1 and Phase 2 are **complete** in the working tree (verified 2026-10-21). **Nothing is committed yet.** Phases 1–2 are ready to move onto a branch/PR; the merge-order deviation in §7 still needs explicit owner sign-off.

Modified files:

- `apps/api/src/app.ts`
- `apps/api/src/middleware/auth.ts`
- `apps/api/src/routes/v1.ts`
- `apps/api/src/routes/gateway.test.ts`
- `apps/api/src/domain/router.ts` (`totalTimeoutMs` only)
- `packages/shared/package.json`, `packages/shared/src/index.ts`

New files:

- `apps/api/src/domain/normalize.ts` + `normalize.test.ts`
- `apps/api/src/domain/stream-finalize.ts` + `stream-finalize.test.ts`
- `apps/api/src/domain/completion.ts`
- `apps/api/src/domain/anthropic/{request,response,stream}.ts` + tests
- `apps/api/src/routes/anthropic.ts` + `anthropic.test.ts`
- `packages/shared/src/anthropic.ts`
- `docs/COMPAT_NOTES.md`

Local config already set (gitignored):

- `.env.test` → Neon URL, `TEST_DB_HOST_ALLOWLIST`, `TRUST_CF_CONNECTING_IP=1`
- `.env` → `ZENMUX_API_KEY`, `ANTHROPIC_DEFAULT_MODEL=deepseek-v4`
- To use the edge locally, also set `ANTHROPIC_ENABLED=true` (route is unmounted otherwise).

Phase 3 target (AGENTS.md §7):

- Anthropic completion uses the pooled route plan and provider candidates (after Pooling 1E).
- All candidates use OpenAI translation in this phase.
- Failover only before headers/first byte.
- Settle uses the served route's pricing/upstream pricing.
- Tests: primary fail → fallback; all fail → 503; client abort → no provider failure; partial stream → partial billing.

Phase 3 is blocked on Pooling Phase 0/0.5 and Phase 1 (route plan + failover loop). Until then, `domain/completion.ts` performs the same single runtime fallback for both protocols.

Before live E2E:

- re-confirm the `v1.ts` ordering deviation (Phases 1–2 landed before Pooling 0/0.5).
- point the public model at ZenMux: base `https://zenmux.ai/api/v1`, provider model `deepseek/deepseek-v4.1-flash`, credential `env:ZENMUX_API_KEY`.

Design around these upstream quirks:

- `tool_choice: required` → 400 on the reasoning model; Phase 4 needs a per-provider downgrade (`any → auto`).
- reasoning echo is conditional; Phase 2 drops `thinking` and reasoning deltas. If tool turn 2 fails against DeepSeek, Phase 4 owns re-injection (`reasoning_echo_required`).
- upstream `count_tokens` is 404; the local `ceil(chars/4)` estimate is the only path.
- bad key is 403 (not 401); 402 = `reject_no_credit`.
- Anthropic TTFB (30 s) is deferred to Pooling 1E because Phase 2 may only add `totalTimeoutMs` to `router.ts`.

Known environment-only test failures: `P1-04` (Neon latency vs 60 s window) and `Duitku` (real sandbox + placeholder credentials).

Known environment-only test failures: `P1-04` (Neon latency vs 60 s window) and `Duitku` (real sandbox + placeholder credentials).

After each test run, delete test rows and restore seed state (1 user, 3 providers, 3 models, 6 packages, 0 payments/usage/ledger).
