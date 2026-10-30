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

test('appFromRequest: Claude Code and Codex headers, also when the User-Agent is rewritten', () => {
  // Captured 2026-10-30: claude-cli 2.1.314 on /v1/messages, codex-cli 0.166.0 on /v1/responses.
  assert.equal(app({ 'user-agent': 'claude-cli/2.1.314 (external, sdk-cli)', 'x-app': 'cli', 'x-claude-code-session-id': 's' }), 'Claude Code');
  assert.equal(app({ 'user-agent': 'Anthropic/JS 0.128.0', 'x-claude-code-session-id': 's' }), 'Claude Code');
  assert.equal(app({ 'user-agent': 'codex_exec/0.166.0 (Fedora 43.0.0; x86_64)', originator: 'codex_exec' }), 'Codex');
  assert.equal(app({ 'user-agent': 'reqwest/0.12', originator: 'codex_cli_rs' }), 'Codex');
  assert.equal(app({ 'user-agent': 'OpenAI/JS 5.0.0', 'x-codex-turn-metadata': '{}' }), 'Codex');
  assert.equal(app({ 'user-agent': 'OpenAI/JS 5.0.0', originator: 'my-tool' }), null);
});
