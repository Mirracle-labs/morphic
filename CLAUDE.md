# Morphic

Unified AI gateway (OpenAI-compatible) with credit billing. pnpm + turbo monorepo:
`apps/web` (Next.js dashboard/admin), `apps/api` (Hono gateway), `packages/db`
(Drizzle/Postgres + billing), `packages/shared` (credit math, key/crypto utils).

## Local development

Postgres + Redis run via `docker compose up -d postgres redis`. The DB layer auto-selects
the driver from `DATABASE_URL` host: Neon (HTTP/WS) for `*.neon.tech`, plain postgres-js
otherwise (see `packages/db/src/index.ts`). Migrate + seed with `pnpm db:migrate && pnpm db:seed`,
then `pnpm dev` (web :3000, api :8787).

## Tests

- `pnpm --filter @morphic/api test` — security + payments suites (node:test via tsx, real DB).
- `pnpm --filter @morphic/shared test` — credit-math self-checks.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read `antislop.md` (core) and then the skill for the task:
- UI / visual: `skills/antislop-ui/SKILL.md`
- Copy & text: `skills/antislop-copywriting/SKILL.md`
- People: `skills/antislop-human/SKILL.md`
- Mobile / responsive: `skills/antislop-layoutmobile/SKILL.md`
- Code comments: `skills/antislop-code/SKILL.md`
Before starting, ask the user when antislop applies: during the work, or after it is done.
To update antislop later: download `antislop.md` again, or run `npx antislop-ai --update` if it was installed as skill folders.

This project installs antislop via the Claude Code plugin `antislop@anti-slop` (skills
`antislop:antislop-ui`, `-copywriting`, `-human`, `-layoutmobile`, `-code`), so the skill
paths above resolve through the plugin rather than local `skills/` folders. UI audits live
in `anti-slop/` (see `anti-slop/audit-001-2026-09-26.md`).
<!-- antislop:end -->
