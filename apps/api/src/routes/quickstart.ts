import { Hono } from 'hono';
import type { Context } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq } from 'drizzle-orm';

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

export async function handleOpencodeBash(c: Context): Promise<Response> {
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
}

quickstart.get('/opencode.sh', handleOpencodeBash);

// Windows: same job as opencode.sh. Runs inside the user's own PowerShell session via
// `irm ... | iex`, so it must never call `exit` (that would close their window): errors stop the
// script block with `return`. Works on Windows PowerShell 5.1 and PowerShell 7.
export async function handleOpencodePs1(c: Context): Promise<Response> {
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
}

quickstart.get('/opencode.ps1', handleOpencodePs1);

export { quickstart };
