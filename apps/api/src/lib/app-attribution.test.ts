import test from 'node:test';
import assert from 'node:assert/strict';
import { appFromRequest } from './app-attribution.js';

const app = (h: Record<string, string>) => appFromRequest(new Headers(h));

test('appFromRequest: title, then referer, then known user agent', () => {
  assert.equal(app({ 'x-title': 'Kilo Code', 'user-agent': 'codex_cli_rs/0.5' }), 'Kilo Code');
  assert.equal(app({ 'x-title': '  My <b>Agent</b>  ' }), 'My bAgentb');
  assert.equal(app({ 'http-referer': 'https://cline.bot/' }), 'Cline');
  assert.equal(app({ 'http-referer': 'https://www.example.org/x' }), 'example.org');
  assert.equal(app({ 'user-agent': 'claude-cli/1.0.80 (external, cli)' }), 'Claude Code');
  assert.equal(app({ 'user-agent': 'OpenAI/Python 1.40.0' }), null);
  assert.equal(app({}), null);
});

test('appFromRequest: OpenCode 1.19 headers on a custom OpenAI-compatible provider', () => {
  // What opencode 1.19.3 sends to a non-OpenCode provider (strings from the shipped binary).
  assert.equal(app({ 'user-agent': 'opencode/1.19.3', 'x-opencode-session-id': 'ses_1', 'x-session-affinity': 'ses_1' }), 'OpenCode');
  // Newer dev builds: opencode/<channel>/<version>/<name>.
  assert.equal(app({ 'user-agent': 'opencode/latest/1.20.0/opencode' }), 'OpenCode');
  // SDK-rewritten User-Agent still credited through the session header.
  assert.equal(app({ 'user-agent': 'ai-sdk/openai-compatible/1.0.0', 'x-opencode-session-id': 'ses_2' }), 'OpenCode');
});
