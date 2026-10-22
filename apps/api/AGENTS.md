# AGENTS.md — Morphic API Protocol Track

Status: Protocol Phases 0–3 and Pooling Phases 0/0.5/1A–1F complete. Phase 4 is next; Pooling 1G is deferred until 1E runs in production. Pooling Phase 2 (multi-server) and Protocol Phase 5 (native Anthropic) are not started.
Repo: `/home/rose/projects/morphic`.
Scope: inbound protocol compatibility for the Hono gateway.

This file is the protocol-track contract. It does not replace the pooling plan.

## 1. Authoritative documents

Precedence:

1. `apps/api/plan-pooling-providers.md` — authoritative for provider pool, candidate ordering, circuit breaker, failover, partial billing, SSE sanitizer, and `v1.ts` failover loop.
2. `apps/api/AGENTS.md` (this file) — authoritative for inbound OpenAI/Anthropic protocol behavior, auth headers, model aliases, error envelopes, and translator logic.
3. `docs/ai-harness-compatibility-guide.md` — reference only (9router patterns; not a spec).

If the two plans conflict, **stop and ask**. Do not silently pick one.

## 2. Current state (verified)

- Hono 4.9 + `@hono/node-server`, pnpm monorepo, Drizzle/Postgres, Redis.
- `apps/api/src/app.ts`: CORS, request-id, global error handler, route mounts.
- `apps/api/src/routes/v1.ts`: `POST /v1/chat/completions`, `GET /v1/models`, shared `startCompletion`, SSE sanitizer + heartbeat, partial billing.
- `apps/api/src/domain/router.ts`: routing snapshot + `createRoutePlan`, `OpenAiCompatibleAdapter`, Appendix B error normalization, TTFB/total timeouts.
- `apps/api/src/domain/completion.ts`: shared resolve → reserve → failover → settle/log loop for OpenAI and Anthropic.
- `apps/api/src/middleware/auth.ts`: Bearer `mp-...` plus `x-api-key` on inference routes.
- `packages/shared/src/types.ts`: lenient `chatCompletionRequestSchema`.
- `packages/shared/src/models.ts`: hardcoded canonical models + aliases.
- `packages/db/src/schema.ts`: `providers`, `models`, `model_provider_pool`, request-log pool fields.
- Seed providers: DeepSeek, Qwen, Kimi (OpenAI-compatible).
- `/v1/messages` + `/v1/messages/count_tokens` mounted when `ANTHROPIC_ENABLED=true`, with Anthropic translators and error envelope.

Known protocol gaps (Phase 4):

- Capability metadata is not stored per provider/model; unsupported tools/vision are not rejected early.
- `tool_choice: required` is sent as-is and can 400 on reasoning models.
- Reasoning echo/re-injection (`reasoning_echo_required`) is not implemented.

## 3. Locked decisions

1. **Single Claude default.** Every `claude-*` / `sonnet` request resolves to one model from `ANTHROPIC_DEFAULT_MODEL`. No opus/sonnet/haiku split.
2. **Sonnet is the default.** `/v1/models` exposes one synthetic `claude-sonnet-4-5` alias.
3. **`content: null` → `""`** in the upstream payload. `tool_calls` and `tool_call_id` stay intact. Update the current test that asserts `null` is forwarded.
4. **Limits:**
   - OpenAI body cap: 10 MB (unchanged).
   - Anthropic body cap: 32 MB.
   - `MAX_MESSAGES=2000` for both.
   - OpenAI streaming TTFB: 15 s (pooling default; introduced in Pooling Phase 1E).
   - Anthropic streaming TTFB: 30 s.
   - OpenAI total timeout: 55 s (unchanged).
   - Anthropic total timeout: 180 s per attempt.
   - SSE heartbeat: 15 s.
   - Partial billing and abort behavior: follow pooling Phase 0.5.
5. **Translation-first for every provider.** DeepSeek, Qwen, Kimi, GLM, MiniMax, and other open-weight/cheap models all use OpenAI translation. Native Anthropic is optional later, per provider, only if translation fails a measured Claude Code test.
6. **Fallback means provider A → provider B for the same public model**, not a different model. Pool entries may have different `provider_model_id`, but must satisfy D9 parity (context + capabilities).
7. **No native Anthropic in the first implementation.** Add `api_format` per provider/pool entry only in the optional phase.

## 4. Hard boundaries

Do not break the running system:

- Existing `/v1/chat/completions` and OpenCode behavior must stay green. Old tests stay green.
- Public API shape is frozen except the explicit additions in this file: `/v1/messages`, `/v1/messages/count_tokens`, and one additive `claude-sonnet-4-5` model entry. Existing model IDs and OpenAI response shapes do not change.
- Do not change auth/session/payment/credits/pricing except:
  - additive `x-api-key` support for inference;
  - `partial` settlement status from pooling Phase 0.5.
- Do not change `settle` semantics beyond the pooling plan.
- Do not add runtime/dev dependencies.
- Do not run migrations/seeds against production. Local/test DB only.
- Do not log API keys, prompts, full bodies, provider credentials, or provider model IDs.
- Do not return upstream text, provider names, provider model IDs, or upstream status to clients.
- Do not copy 9router OAuth/account pooling, cloaking/fingerprinting, prompt-mutating token savers, or combo logic.
- No drive-by refactors, formatting, renames, or unrelated fixes.
- Every behavior change needs a test that fails before and passes after.

Security invariants:

- API key lookup remains SHA-256 + DB; no plaintext keys.
- `x-api-key` is accepted only on inference routes.
- CORS stays origin-restricted; only add required headers.
- Body limit runs before auth/parse.
- Upstream base URLs come from DB only; never from client input.
- Client abort aborts upstream; no writes after close.
- Reserve before upstream; settle on every path.
- Never trust client `X-Request-Id`; server generates it.

## 5. Track separation with the pooling plan

`plan-pooling-providers.md` remains authoritative for pool, circuit breaker, failover, partial billing, SSE sanitizer, and `v1.ts` streaming/billing internals.

This protocol track owns inbound protocol behavior. The pooling plan's §0.2 denylist applies to **pooling PRs only**; it does not override the protocol allowlist in §6. Conversely, protocol PRs must not change pool schema, circuit logic, or billing semantics.

If a protocol task needs a pooling-owned file, stop and ask. If a pooling task needs a protocol-owned file, same rule.

Merge order (do not reorder without owner approval):

1. **Pooling Phase 0 + 0.5** — sanitizer, abort fix, partial billing.
2. **Protocol Phase 1** — OpenAI hardening.
3. **Protocol Phase 2** — Anthropic `/v1/messages`.
4. **Pooling Phase 1** — pool, circuit isolation, failover loop.
5. **Protocol Phase 3** — pool integration.
6. **Protocol Phase 4** — provider quirks/capability matrix.
7. **Protocol Phase 5** — optional native Anthropic.

Shared-file rule:

- `routes/v1.ts`: Pooling 0/0.5 edits first, then Protocol Phase 1. Pooling Phase 1E merges after Protocol Phase 2. No parallel PRs touching this file.
- `domain/router.ts`: Pooling Phase 1E owns the route plan. Protocol Phase 2 may add only an optional per-request `totalTimeoutMs` field; Phase 1E must preserve it.
- `lib/sse-sanitize.ts`: Pooling owns it. Protocol must not edit it; add protocol-only helpers in `domain/stream-finalize.ts` if needed.
- `middleware/auth.ts`, `app.ts`, `packages/shared/**`: Protocol only. Pooling must not touch them.
- `packages/db/**`, `domain/circuit-breaker.ts`, `domain/router.ts` route plan: Pooling only. Protocol must not change pool schema or circuit logic.

## 6. File ownership

Protocol may create/modify:

- `apps/api/src/routes/anthropic.ts` (new)
- `apps/api/src/app.ts` (mount route, CORS headers)
- `apps/api/src/middleware/auth.ts` (`x-api-key` only)
- `apps/api/src/domain/normalize.ts` (new)
- `apps/api/src/domain/completion.ts` (new, extracted orchestration)
- `apps/api/src/domain/anthropic/**` (new)
- `apps/api/src/domain/stream-finalize.ts` (new)
- `apps/api/src/routes/v1.ts` (OpenAI normalization/error/limits; coordinated)
- `apps/api/src/domain/router.ts` (only optional `totalTimeoutMs` in Phase 2; coordinated)
- `packages/shared/src/anthropic.ts` (new)
- `packages/shared/src/models.ts` (Claude alias only)
- `packages/shared/src/types.ts` (only if protocol schema needs it)
- Tests next to the files above.

Protocol must not modify:

- `packages/db/src/schema.ts`, migrations, seeds
- `apps/api/src/domain/circuit-breaker.ts`
- `apps/api/src/lib/sse-sanitize.ts`
- `apps/api/src/index.ts` (background jobs)
- payment, webhook, session-auth, dashboard, catalog routes
- `plan-pooling-providers.md`

## 7. Phases

### Phase 0 — Baseline and decisions (no code)

- Confirm `.env.test` points to a local test DB with `ALLOW_TEST_DB_WRITE=1`.
- Record baseline: `pnpm --filter @morphic/api typecheck`, `lint`, `test`.
- Confirm upstream capabilities per provider: tools, parallel tools, usage, reasoning, vision.
- Confirm Claude Code version env behavior: `ANTHROPIC_BASE_URL` join and `ANTHROPIC_MODEL`.
- Decide `ANTHROPIC_DEFAULT_MODEL` value.
- Add `docs/COMPAT_NOTES.md` with `[VERIFY]` results (human-run).

Exit: baseline green; decisions recorded; no code changes.

### Phase 1 — OpenAI compatibility hardening

Goal: make `/v1/chat/completions` reliable for OpenCode and agentic clients without changing the happy path.

Files: `domain/normalize.ts`, `routes/v1.ts`, `domain/completion.ts` (if extracting), `middleware/auth.ts`, `app.ts`, tests.

#### 1.1 Normalize messages

Implement `normalizeMessages`:

- `content` null/missing → `""`; all-text array → string; keep multimodal array.
- role `developer` → `system`.
- drop `tool_calls: []`.
- ensure `tool_calls[].type="function"`; `id` non-empty; `arguments` string; empty → `"{}"`.

Implement `repairToolPairs`:

- assistant `tool_calls` must be followed by matching `role:"tool"` messages.
- reorder immediate results.
- missing result → synthetic `error: tool result missing`.
- orphan tool message → drop.
- duplicate ids → suffix.

Apply before `callProvider`. Preserve unknown fields.

Tests: null/empty/omitted content, developer role, empty tool_calls, orphan/missing/duplicate/reordered pairs. No 500.

#### 1.2 Error mapping

- Do **not** change OpenAI error status behavior in this track. Leave 400/401/403/429/5xx semantics to pooling Phase 1E / Appendix B.
- Only add internal logging and ensure no leakage.
- Anthropic error mapping lives in the Anthropic route (Phase 2), not in the shared OpenAI mapper.
- Log upstream status internally; never return upstream text/provider/status.
- `request_id` stays in every error body.

Tests: assert current OpenAI behavior is unchanged for upstream 400, 401, 429, 500, and non-JSON body; assert no leakage.

#### 1.3 Auth, CORS, limits

- `apiKeyAuth` accepts `x-api-key` and `Authorization: Bearer`; same `mp-` key/hash.
- CORS adds `x-api-key`, `anthropic-version`, `anthropic-beta`, `x-goog-api-key`.
- Keep 10 MB for `/chat/*`; add `MAX_MESSAGES=2000`.
- Do not add timeout behavior here; Pooling Phase 1E owns TTFB/total timeout for OpenAI.

Tests: x-api-key, Bearer, 401, 413, 400 message cap.

#### 1.4 Stream finalization

- If upstream ends without `[DONE]`, emit one `data: [DONE]\n\n` for OpenAI clients.
- Emit `: keepalive` every `SSE_HEARTBEAT_MS` (15 s) when idle.
- Never inject `[DONE]` on the Anthropic route.
- On upstream error mid-stream, emit sanitized error chunk then `[DONE]`.
- Preserve pooling Phase 0 partial billing.

Tests: missing `[DONE]`, idle heartbeat, error chunk, client abort.

Acceptance: old tests green; OpenCode tool loop works; `content:null` test updated; typecheck/lint/test green.

Rollback: `NORMALIZE_OPENAI=false`; revert PR.

### Phase 2 — Anthropic `/v1/messages`

Goal: Claude Code and Anthropic SDK work through translation. No native provider path.

Files: `routes/anthropic.ts`, `domain/anthropic/**`, `domain/completion.ts`, `domain/stream-finalize.ts`, `packages/shared/src/anthropic.ts`, `packages/shared/src/models.ts`, `app.ts`, `domain/router.ts` (optional `totalTimeoutMs` only), tests.

#### 2.1 Request translator

| Anthropic | Internal OpenAI |
|---|---|
| `system` string/array | system message; join `\n`; drop `cache_control` |
| text block | text part |
| image base64/url | `image_url` data URI/URL |
| `tool_use` | `assistant.tool_calls[]` |
| `tool_result` | `role:"tool"` + `tool_call_id` |
| tools `{name,description,input_schema}` | `{type:"function",function:{name,description,parameters}}` |
| tool_choice auto/any/tool/none | auto/required/named/none |
| `stop_sequences` | `stop` |
| `metadata.user_id` | `user` |
| `thinking` | drop |
| `cache_control`, `top_k` | drop |
| `is_error` | prefix `[tool error]` |

Also: normalize tool IDs to `^[a-zA-Z0-9_-]+$`; run `repairToolPairs`; merge consecutive same-role messages; drop empty text blocks; clamp `max_tokens` to model context/max output.

#### 2.2 Response translator

Non-stream:

```json
{"id":"msg_...","type":"message","role":"assistant","model":"...","content":[{"type":"text","text":"..."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":5}}
```

- `tool_use` blocks for tool calls.
- Stop: `stop`→`end_turn`, `length`→`max_tokens`, `tool_calls`→`tool_use`.
- Invalid tool arguments: repair, else `{}` + log.

Stream order:

```text
message_start
content_block_start → content_block_delta* → content_block_stop
message_delta → message_stop
```

- Deltas: `text_delta`, `input_json_delta`, optional `thinking_delta`.
- No `[DONE]`.
- `: ping` every 15 s.
- Mid-stream failure: `event: error` with Anthropic envelope.

#### 2.3 Route

- `POST /v1/messages`
- `POST /v1/messages/count_tokens`
- Accept Bearer + `x-api-key`; ignore `anthropic-version`; tolerate `anthropic-beta`, `?beta=true`, unknown fields.
- `model` + `max_tokens` required; 32 MB body cap.
- Anthropic error envelope: `{"type":"error","error":{"type":"...","message":"..."}}`.
- Upstream 400/422 → Anthropic 400 `invalid_request_error` (sanitized).
- 401 → `authentication_error`; 429 → `rate_limit_error`; 5xx → `api_error`/`overloaded_error`.
- `count_tokens`: `ceil(chars/4)` locally; never proxy.

#### 2.4 Model alias

- `ANTHROPIC_DEFAULT_MODEL` is the only default.
- All `claude-*` / `sonnet` → that model.
- `/v1/models` includes `claude-sonnet-4-5`.
- Unknown Claude ID → default, not 404.
- If `ANTHROPIC_DEFAULT_MODEL` is unset: log a startup warning; `/v1/messages` returns 503 `provider_not_configured`. Never guess a model.

#### 2.5 Billing and failover

- Reuse reserve/settle, circuit breaker, failover.
- Extract `domain/completion.ts` from `v1.ts` if needed to avoid duplicate billing.
- Partial billing follows pooling Phase 0.5.
- No duplicate billing code.

Acceptance:

- Anthropic SDK text/stream/tool tests pass.
- Claude Code 20+ step task: read/edit/run.
- `count_tokens` works.
- Existing OpenAI/OpenCode green.

Rollback: `ANTHROPIC_ENABLED=false`; unmount route; revert PR.

### Phase 3 — Pool integration

**Status: complete (2026-10-22).**

After pooling Phase 1E.

- Anthropic completion uses the route plan and provider candidates.
- All candidates use OpenAI translation in this phase.
- Failover only before headers/first byte.
- Settle uses served route pricing/upstream pricing.
- Tests: primary fail → fallback; all fail → 503; client abort → no provider failure; partial stream → partial billing.

Delivered:

- `routes/anthropic.ts` now settles client aborts as `partial` (`client_disconnected`) and upstream breaks per `PARTIAL_BILLING_UPSTREAM_BREAK`; it emits a sanitized `event: error` for mid-stream failures.
- All-circuits-open returns `503 api_error` with `Retry-After` (1–120 s).
- `routes/anthropic-failover.test.ts` covers primary → fallback, all candidates failing, all circuits open, client abort, upstream cut, deprecated redirect, and `invalid_body` failover (7 tests).
- Attempt exhaustion keeps the Phase 2 5xx mapping (`500 api_error` / `529`); the Phase 3 “all fail → 503” path is all-circuits-open / no usable candidate. Owner decision if a literal 503 is required.
- `usage_records.provider_id` remains null (`settle()` does not accept it); `request_logs.served_provider_id` is authoritative.

No `api_format` yet.

### Phase 4 — Provider quirks and capability matrix

Focus: open-weight/cheap Chinese models.

Add per provider entry (DB or config):

- `supports_tools`
- `supports_parallel_tools`
- `supports_reasoning`
- `reasoning_echo_required`
- `supports_vision`
- `usage_in_stream`
- `context_length`
- `max_output_tokens`
- `api_format` (reserved, default `openai`)

Behavior:

- Reject unsupported tools/vision early with a clear 400.
- `[VERIFY]` reasoning echo for DeepSeek/GLM/Kimi/MiniMax; cache/re-inject only when required.
- Qwen: test tool calls/stream separately; never assume DeepSeek behavior.
- Pool must not mix capability-mismatched entries (D9).

Tests: 10+ turn tool loop with reasoning on/off; Qwen tool call + stream; unsupported vision 400; pool rejects mismatch.

### Phase 5 — Optional native Anthropic

Only if all true:

- Official provider Anthropic-compatible endpoint verified.
- Translation fails a measured Claude Code test (400, tool ID mismatch, or quality gap).
- Owner accepts two billing/error parsers.

Implementation:

- Add `api_format` (`openai|anthropic`) to provider/pool entry.
- Route plan returns format.
- Anthropic edge chooses passthrough vs translate per candidate.
- Native usage/error/SSE parsers.
- Fallback to OpenAI entries still translates.

Do not implement now.

## 8. Environment registry

| Variable | Default | Scope |
|---|---:|---|
| `ANTHROPIC_DEFAULT_MODEL` | required | all Claude aliases |
| `ANTHROPIC_ENABLED` | false | route mount (enable after staging) |
| `ANTHROPIC_MAX_BODY_BYTES` | 33554432 | `/v1/messages` |
| `MAX_BODY_BYTES` | 10485760 | `/v1/chat/completions` |
| `MAX_MESSAGES` | 2000 | both |
| `UPSTREAM_TTFB_TIMEOUT_MS` | 15000 | OpenAI streaming (pooling default) |
| `ANTHROPIC_TTFB_TIMEOUT_MS` | 30000 | Anthropic streaming |
| `UPSTREAM_TOTAL_TIMEOUT_MS` | 55000 | OpenAI (existing) |
| `ANTHROPIC_TOTAL_TIMEOUT_MS` | 180000 | `/v1/messages` |
| `SSE_HEARTBEAT_MS` | 15000 | SSE |
| `NORMALIZE_OPENAI` | true | OpenAI normalization |
| `POOL_ENABLED` | false | pooling plan |
| `MAX_POOL_ATTEMPTS` | 3 | pooling plan |
| `PARTIAL_BILLING_UPSTREAM_BREAK` | charge | pooling plan |

## 9. Commands

```bash
pnpm --filter @morphic/api typecheck
pnpm --filter @morphic/api lint
pnpm --filter @morphic/api test
pnpm --filter @morphic/shared test
pnpm -w typecheck
pnpm -w test
```

Tests require `.env.test` with `ALLOW_TEST_DB_WRITE=1`, `NODE_ENV=test`, and a local test DB. Never point tests at production.

Manual:

```bash
curl -N http://localhost:8787/v1/chat/completions ...
curl -N http://localhost:8787/v1/messages ...
```

## 10. Definition of done

- [ ] OpenCode tool loop works; old tests green.
- [ ] `content:null`, `developer`, orphan/duplicate tools repaired.
- [ ] OpenAI stream always ends with `[DONE]`; heartbeat works.
- [ ] `x-api-key` + Bearer both work.
- [ ] Claude Code 20+ step task succeeds via `/v1/messages`.
- [x] Anthropic SDK text/tool/stream tests pass.
- [x] `count_tokens` works.
- [x] Body/timeout limits enforced with clear errors.
- [x] Billing: reserve/settle/partial correct on all paths.
- [x] No provider identity/secret leakage.
- [ ] Typecheck, lint, tests green.
- [ ] Rollback documented and tested.

## 11. `[VERIFY]` before coding against it

- Each provider’s tool/parallel-tool/usage/reasoning/vision behavior.
- DeepSeek `/anthropic` field compatibility (only if Phase 5).
- Claude Code `ANTHROPIC_BASE_URL` join and `ANTHROPIC_MODEL` behavior for the target version.
- p95 turn duration to tune 180 s.
- Real memory impact of 32 MB × concurrency.

Record results in `docs/COMPAT_NOTES.md` before coding.

## 12. What not to do

- Do not copy 9router OAuth/account pooling, cloaking, or token savers.
- Do not implement native Anthropic before translation works.
- Do not change pool/circuit/billing semantics outside the pooling plan.
- Do not change OpenAI error statuses without owner approval.
- Do not log or return secrets, prompts, provider names, or model IDs.
- Do not run production migrations/seeds.
- Do not mix pooling PRs and protocol PRs.
- Do not add features outside this file.

## 13. Reporting format

For each phase report:

- Files changed.
- Tests added.
- Commands run and results.
- `[VERIFY]` findings.
- Deviations from this plan.
- “Observed, not fixed” items.
- Rollback steps.
