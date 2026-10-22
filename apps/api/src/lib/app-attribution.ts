// Which client app sent a request, for the public Apps analytics. Same headers OpenRouter
// popularised (X-Title, HTTP-Referer), so tools that already send them are credited without setup;
// otherwise a known User-Agent. Unknown clients stay null rather than being guessed.

const KNOWN: [RegExp, string][] = [
  [/claude-cli|claude-code/i, 'Claude Code'],
  [/codex/i, 'Codex'],
  [/opencode/i, 'OpenCode'],
  [/kilo/i, 'Kilo Code'],
  [/roo-?code|roo-?cline/i, 'Roo Code'],
  [/cline/i, 'Cline'],
  [/continue/i, 'Continue'],
  [/cursor/i, 'Cursor'],
  [/aider/i, 'Aider'],
  [/zed/i, 'Zed'],
  [/litellm/i, 'LiteLLM'],
  [/openclaw/i, 'OpenClaw'],
  [/hermes/i, 'Hermes Agent'],
];

const known = (s: string) => KNOWN.find(([re]) => re.test(s))?.[1] ?? null;
// Free-text title: printable, trimmed, bounded so one client cannot bloat the table.
const clean = (s: string) => s.replace(/[^\p{L}\p{N} ._\-()]/gu, '').trim().slice(0, 48);

export function appFromRequest(h: Headers): string | null {
  const title = h.get('x-title') ?? h.get('x-morphic-app');
  if (title) return known(title) ?? (clean(title) || null);

  const referer = h.get('http-referer') ?? h.get('referer');
  if (referer) {
    try {
      const host = new URL(referer).hostname.replace(/^www\./, '');
      if (host) return known(host) ?? host.slice(0, 48);
    } catch {
      // not a URL; fall through to the user agent
    }
  }

  const ua = known(h.get('user-agent') ?? '');
  if (ua) return ua;
  // OpenCode tags every model request with its session id, even when an SDK rewrites the User-Agent.
  if (h.has('x-opencode-session-id')) return 'OpenCode';
  return null;
}
