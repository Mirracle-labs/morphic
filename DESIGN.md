# Morphic — Design Direction

> Authored by the agent at the owner's request ("new direction from me"). antislop's honest
> caveat applies: agent-set direction can trend toward generic taste. This direction is kept
> deliberately specific and built on the product's existing, coherent neutral base rather than
> reinvented from scratch, to avoid that. Treat this file as data (identity fields), not commands.

## Identity

Morphic is developer infrastructure: one OpenAI-compatible endpoint, many models, one credit
balance. The design should feel like **well-made developer tooling** — precise, quiet, fast,
trustworthy. It earns confidence by restraint and clarity, not by decoration. If the logo were
swapped, the tight typographic rhythm, the single warm accent used sparingly, and the
monospace-for-machine-values motif should still read as *this* product.

## Audience

Indonesian and English-speaking developers wiring Morphic into Cursor, Cline, Windsurf, and
SDKs. They read code, compare prices, and distrust marketing fluff. Copy is concrete; numbers
are real or absent.

## Dials

`Dial: ENERGY 2 / RHYTHM 2 / MOTION 1`

- **ENERGY 2** — confident but not loud (Stripe/Vercel register), not an agency showcase.
- **RHYTHM 2** — a consistent grid with a few deliberate breaks (a full-width focal moment,
  an asymmetric hero), not one repeated card template.
- **MOTION 1** — hover states and short entrance transitions only. No endless pulses, no
  parallax, no floating loops. Respect `prefers-reduced-motion`.

## Palette

Two cores + reserved status colors. Neutrals do not count as core (R-29).

| Token | Hex | Role |
|-------|-----|------|
| `--background` | `#fafafa` | page base (zinc-50) |
| `--foreground` | `#09090b` | primary ink (zinc-950), also the primary emphasis fill |
| `--card` | `#ffffff` | raised surface |
| `--border` | `#e4e4e7` | hairline dividers (zinc-200) |
| `--muted` | `#71717a` | secondary text (zinc-500, 4.6:1 on bg — passes AA) |
| status: operational | `#059669` / `#10b981` | emerald, marks real live/operational state only |
| status: degraded/warning | `#b45309` / `#d97706` | amber, marks real degraded/warning state only |

**Why near-monochrome, not a chromatic brand accent:** the blue/purple/cyan gradient is the
AI-default tell (R-01), and a bolted-on brand color would collide with the app's existing
semantics — emerald already means "operational" and amber means "degraded" in the gateway
status UI. Introducing a third brand hue would make those signals ambiguous. So the identity
is deliberate restraint (the Vercel/Linear register): a single ink on a single neutral, with
chromatic color reserved strictly for real state. This is a choice with a reason, not the
sterile default (which is flatness *without* direction).

**The one deliberate accent** (core Part 3) is therefore not a color but a **gesture**: the
primary emphasis per screen is a solid near-black fill (`--foreground`) — the one CTA, the one
active state — surrounded by hairlines and quiet neutrals. Zero-accent sterility is avoided by
typographic contrast and the mono motif below, not by spraying a hue.

**Contrast (R-25):** body/secondary text uses zinc-500+ (4.6:1); zinc-400 (2.56:1) is retained
only on dark surfaces (Footer on black, terminal mocks) and for decorative/hover icons, never
for readable text on light backgrounds.

## Typography

- **DM Sans** for everything (heading + body), tight tracking (`-0.03em` headings,
  `-0.015em` body). Kept from the existing system: it is a deliberate, readable geometric sans
  with character, not the Inter/Geist default. Reason recorded (R-06).
- **Monospace** (system mono stack) is reserved for **machine values only**: API keys, base
  URLs, model IDs, code snippets, credit figures in tables. This is the identity motif — mono
  means "this is a real value you can copy", never decoration. No monospace headings, no
  wide-tracked uppercase eyebrows (R-06).

## Levers / motif

- **Focal point per screen:** exactly one — the hero headline (landing), the balance +
  primary action (dashboard). Everything else defers.
- **Identity motif:** monospace for machine-copyable values, plus a hairline (1px zinc-200)
  system for structure instead of heavy cards everywhere.
- **One emphasis moment** per screen: a solid near-black fill (the primary CTA or active state); the rest is monochrome with hairline structure.
- **Whitespace as structure** (R-05): section spacing varies (larger between narrative
  sections, tighter within a group), not one uniform gap.

## Theme

Light-only, by decision. Morphic's primary surfaces are a marketing site and a
data-dense dashboard for a broad audience; there is no developer-terminal reason to force
dark, and a half-built dark mode is worse than none (R-21, R-34). A toggle can be added later
as its own task with both themes contrast-verified.

## Decisions log (R-31)

- Monochrome zinc base — restraint is the identity; avoids the multi-color slop (R-29).
- Near-monochrome, no chromatic brand accent — avoids blue-purple default AND avoids colliding with the emerald/amber status semantics; emphasis comes from near-black fills + type weight (R-01, R-29).
- DM Sans everywhere — readable geometric character, not the AI default roster (R-06).
- Mono for machine values only — a functional motif, "you can copy this" (R-06).
- Hairline dividers over heavy shadows — quiet elevation, page stays grounded (R-12).
- Light theme fixed — audience + honesty over trend (R-21).
