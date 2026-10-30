import { Hono, type Context } from 'hono';
import { db, schema as s } from '@morphic/db';
import { asc, eq } from 'drizzle-orm';
import { readyModelIds } from '@morphic/shared/model-readiness';

/**
 * Public install scripts: `curl -fsSL <url> | bash` (macOS/Linux) and `irm <url> | iex`
 * (Windows PowerShell). They contain no secrets: the API key is read from the caller's own
 * environment ($MORPHIC_API_KEY) and only ever written to a local file on their machine.
 *
 * Only MORPHIC_-prefixed variables choose the gateway. A generic BASE_URL is often set by other
 * tools (one user's pointed at another AI service), and following it would send the Morphic key
 * there. API_KEY is still accepted as a fallback for the key, but only if it looks like mp-...
 */
const quickstart = new Hono();

const CACHE_MS = 60_000;
let cached: { at: number; models: Array<{ id: string; name: string }> } | null = null;

async function activeModels() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.models;
  const models = await db
    .select({ id: s.models.publicModelId, name: s.models.displayName })
    .from(s.models)
    .where(eq(s.models.status, 'active'));
  cached = { at: Date.now(), models };
  return models;
}

// Strict allowlist: hostname labels + optional port. Rejects any shell metacharacters
// (quotes, semicolons, backticks, $, spaces, etc.) before they reach script templates.
const SAFE_HOST_RE = /^[a-zA-Z0-9.-]+(:[0-9]{1,5})?$/;

const gatewayBase = (c: { req: { url: string; header: (name: string) => string | undefined } }) => {
  if (process.env.NEXT_PUBLIC_GATEWAY_URL) {
    return `${process.env.NEXT_PUBLIC_GATEWAY_URL.replace(/\/+$/, '')}/v1`;
  }
  const rawHost = c.req.header('x-forwarded-host') || c.req.header('host');
  const proto = c.req.header('x-forwarded-proto') || (c.req.url.startsWith('https') ? 'https' : 'http');
  if (rawHost && SAFE_HOST_RE.test(rawHost)) {
    return `${proto}://${rawHost}/v1`;
  }
  return `${new URL(c.req.url).origin.replace(/\/+$/, '')}/v1`;
};
const modelsMap = (models: Array<{ id: string; name: string }>) =>
  Object.fromEntries(models.map((m) => [m.id, { name: m.name }]));

quickstart.get('/opencode.sh', async (c) => {
  const models = await activeModels();
  const defaultModel =
    models.find((m) => m.id.startsWith('deepseek-v4'))?.id ||
    models.find((m) => m.id.toLowerCase().includes('deepseek'))?.id ||
    models[0]?.id ||
    'deepseek-v4';
  const modelsJson = JSON.stringify(modelsMap(models), null, 2)
    .split('\n')
    .join('\n      ')
    // Goes inside an unquoted heredoc: keep $, ` and \ literal.
    .replace(/[\\$`]/g, '\\$&');
  const defaultBase = gatewayBase(c);

  const script = `#!/usr/bin/env bash
# Morphic x opencode quickstart. Writes ~/.config/opencode/opencode.json for the Morphic provider.
# Usage:
#   export MORPHIC_API_KEY=mp-...
#   curl -fsSL ${defaultBase.replace(/\/v1$/, '')}/quickstart/opencode.sh | bash
set -euo pipefail

BASE_URL="\${MORPHIC_BASE_URL:-${defaultBase}}"
BASE_URL="\${BASE_URL%/}"
API_KEY="\${MORPHIC_API_KEY:-\${API_KEY:-}}"

if [ -z "$API_KEY" ]; then
  echo "x MORPHIC_API_KEY is not set. Run: export MORPHIC_API_KEY=mp-your-key" >&2
  exit 1
fi
case "$API_KEY" in
  mp-*) ;;
  *) echo "x MORPHIC_API_KEY should start with mp-. Copy it from your Morphic dashboard (API Keys)." >&2; exit 1 ;;
esac
# Keys are [A-Za-z0-9_-] only; anything else would break the JSON written below.
if ! printf '%s' "$API_KEY" | grep -Eq '^mp-[A-Za-z0-9_-]+$'; then
  echo "x MORPHIC_API_KEY contains unexpected characters." >&2
  exit 1
fi

echo "> Checking your key against $BASE_URL ..."
if ! curl -fsS -o /dev/null -H "Authorization: Bearer $API_KEY" "$BASE_URL/models"; then
  echo "x The gateway rejected this key (or is unreachable). Check the key." >&2
  exit 1
fi

CONFIG_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
CONFIG="$CONFIG_DIR/opencode.json"
mkdir -p "$CONFIG_DIR"
if [ -f "$CONFIG" ]; then
  BACKUP="$CONFIG.bak.$(date +%Y%m%d%H%M%S)"
  cp "$CONFIG" "$BACKUP"
  echo "> Existing config saved to $BACKUP"
fi

umask 077
cat > "$CONFIG" <<JSON
{
  "\\$schema": "https://opencode.ai/config.json",
  "provider": {
    "morphic": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Morphic AI",
      "options": {
        "baseURL": "$BASE_URL",
        "apiKey": "$API_KEY"
      },
      "models": ${modelsJson}
    }
  },
  "model": "morphic/${defaultModel}"
}
JSON
chmod 600 "$CONFIG"

echo "OK opencode is connected to Morphic (${models.length} models)."
echo "  Config: $CONFIG"
echo "  Run: opencode   then pick a model with /models"
`;

  return c.body(script, 200, {
    'Content-Type': 'text/x-shellscript; charset=utf-8',
    'Cache-Control': 'private, no-store',
  });
});

// Windows: same job as opencode.sh. Runs inside the user's own PowerShell session via
// `irm ... | iex`, so it must never call `exit` (that would close their window): errors stop the
// script block with `return`. Works on Windows PowerShell 5.1 and PowerShell 7.
quickstart.get('/opencode.ps1', async (c) => {
  const models = await activeModels();
  const defaultModel =
    models.find((m) => m.id.startsWith('deepseek-v4'))?.id ||
    models.find((m) => m.id.toLowerCase().includes('deepseek'))?.id ||
    models[0]?.id ||
    'deepseek-v4';
  // Single-quoted here-string: PowerShell expands nothing inside it. The only terminator is a
  // line starting with '@, which JSON.stringify output can never produce.
  const modelsJson = JSON.stringify(modelsMap(models), null, 2);
  const defaultBase = gatewayBase(c);

  const script = `# Morphic x opencode quickstart for Windows. Writes %USERPROFILE%\\.config\\opencode\\opencode.json.
# Usage (PowerShell):
#   $env:MORPHIC_API_KEY = "mp-..."
#   irm ${defaultBase.replace(/\/v1$/, '')}/quickstart/opencode.ps1 | iex
& {
  $ErrorActionPreference = 'Stop'
  # Windows PowerShell 5.1 on older builds defaults to TLS 1.0/1.1.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $BaseUrl = if ($env:MORPHIC_BASE_URL) { $env:MORPHIC_BASE_URL } else { '${defaultBase}' }
  $BaseUrl = $BaseUrl.TrimEnd('/')
  $ApiKey = if ($env:MORPHIC_API_KEY) { $env:MORPHIC_API_KEY } else { $env:API_KEY }

  if (-not $ApiKey) {
    Write-Host 'x MORPHIC_API_KEY is not set. Run: $env:MORPHIC_API_KEY = "mp-your-key"' -ForegroundColor Red
    return
  }
  if ($ApiKey -notmatch '^mp-[A-Za-z0-9_-]+$') {
    Write-Host 'x MORPHIC_API_KEY should look like mp-... Copy it from your Morphic dashboard (API Keys).' -ForegroundColor Red
    return
  }

  Write-Host "> Checking your key against $BaseUrl ..."
  try {
    Invoke-RestMethod -Uri "$BaseUrl/models" -Headers @{ Authorization = "Bearer $ApiKey" } | Out-Null
  } catch {
    Write-Host 'x The gateway rejected this key (or is unreachable). Check the key.' -ForegroundColor Red
    return
  }

  $ConfigRoot = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $HOME '.config' }
  $ConfigDir = Join-Path $ConfigRoot 'opencode'
  $Config = Join-Path $ConfigDir 'opencode.json'
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  if (Test-Path $Config) {
    $Backup = "$Config.bak.$(Get-Date -Format yyyyMMddHHmmss)"
    Copy-Item $Config $Backup
    Write-Host "> Existing config saved to $Backup"
  }

  $Models = @'
${modelsJson}
'@ | ConvertFrom-Json

  $Body = [ordered]@{
    '$schema' = 'https://opencode.ai/config.json'
    provider = [ordered]@{
      morphic = [ordered]@{
        npm = '@ai-sdk/openai-compatible'
        name = 'Morphic AI'
        options = [ordered]@{ baseURL = $BaseUrl; apiKey = $ApiKey }
        models = $Models
      }
    }
    model = 'morphic/${defaultModel}'
  }
  # UTF-8 without BOM: Set-Content -Encoding UTF8 on 5.1 adds a BOM some JSON readers reject.
  [IO.File]::WriteAllText($Config, ($Body | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))

  Write-Host 'OK opencode is connected to Morphic (${models.length} models).' -ForegroundColor Green
  Write-Host "  Config: $Config"
  Write-Host '  Run: opencode   then pick a model with /models'
}
`;

  return c.body(script, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'private, no-store',
  });
});

// ── OpenCode well-known remote config ───────────────────────────────────────
// `opencode auth login <gateway>` fetches <gateway>/.well-known/opencode once, runs `auth.command`
// to read the user's key and stores it locally under `auth.env`. On EVERY start opencode fetches
// this document again and merges `config`, so new Morphic models appear without editing any file.
// Only routable (ready) models are listed. The key never reaches this endpoint: `{env:...}` is
// resolved by opencode on the user's machine. Windows has no /dev/tty, so it logs in via the
// /windows prefix, which serves a PowerShell prompt instead.

const OPENCODE_ENV = 'MORPHIC_API_KEY';
const KEY_PROMPT = 'Morphic API key (mp-...): ';
const OUTPUT_CAP = Number(process.env.HARD_RESERVE_CAP ?? 16384);

type OpencodeModel = {
  name: string;
  limit: { context: number; output: number };
  reasoning: boolean;
  tool_call: boolean;
  attachment: boolean;
};
let readyCache: { at: number; models: Record<string, OpencodeModel> } | null = null;

async function readyOpencodeModels() {
  if (readyCache && Date.now() - readyCache.at < CACHE_MS) return readyCache.models;
  const [models, providers, pool] = await Promise.all([
    db
      .select({
        id: s.models.id,
        providerId: s.models.providerId,
        fallbackProviderId: s.models.fallbackProviderId,
        publicModelId: s.models.publicModelId,
        displayName: s.models.displayName,
        contextLength: s.models.contextLength,
        capabilities: s.models.capabilities,
      })
      .from(s.models)
      .where(eq(s.models.status, 'active')),
    // Credential columns only decide readiness; nothing from them is returned.
    db
      .select({
        id: s.providers.id,
        status: s.providers.status,
        encryptedCredentials: s.providers.encryptedCredentials,
        credentialReference: s.providers.credentialReference,
      })
      .from(s.providers),
    db
      .select({
        modelId: s.modelProviderPool.modelId,
        providerId: s.modelProviderPool.providerId,
        isEnabled: s.modelProviderPool.isEnabled,
        maxOutputTokens: s.modelProviderPool.maxOutputTokens,
      })
      .from(s.modelProviderPool)
      .orderBy(asc(s.modelProviderPool.priority)),
  ]);
  const ready = readyModelIds(models, providers, pool);
  const maxOut = new Map<string, number>();
  for (const p of pool) if (p.isEnabled && p.maxOutputTokens && !maxOut.has(p.modelId)) maxOut.set(p.modelId, p.maxOutputTokens);
  const out = Object.fromEntries(
    models
      .filter((m) => ready.has(m.id))
      .map((m) => {
        const caps = (m.capabilities ?? []).map((c) => c.toLowerCase());
        return [
          m.publicModelId,
          {
            name: m.displayName,
            limit: { context: m.contextLength, output: Math.min(maxOut.get(m.id) ?? OUTPUT_CAP, OUTPUT_CAP, m.contextLength) },
            reasoning: caps.includes('reasoning'),
            tool_call: !caps.includes('no-tools'),
            attachment: caps.includes('multimodal') || caps.includes('vision'),
          },
        ];
      }),
  );
  readyCache = { at: Date.now(), models: out };
  return out;
}

const opencodeWellKnown = (command: string[]) => async (c: Context) =>
  c.json(
    {
      auth: { command, env: OPENCODE_ENV },
      config: {
        provider: {
          morphic: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Morphic',
            options: { baseURL: gatewayBase(c), apiKey: `{env:${OPENCODE_ENV}}` },
            models: await readyOpencodeModels(),
          },
        },
      },
    },
    200,
    // Same document for everyone; a short shared cache keeps opencode start-ups cheap.
    { 'Cache-Control': 'public, max-age=60' },
  );

const wellKnown = new Hono();
wellKnown.get(
  '/.well-known/opencode',
  opencodeWellKnown(['sh', '-c', `printf '${KEY_PROMPT}' >&2; read -r k </dev/tty; printf '%s' "$k"`]),
);
wellKnown.get(
  '/windows/.well-known/opencode',
  opencodeWellKnown(['powershell', '-NoProfile', '-Command', `$k = Read-Host '${KEY_PROMPT.trim()}'; [Console]::Out.Write($k)`]),
);

export { quickstart, wellKnown };
