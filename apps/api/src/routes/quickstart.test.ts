import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../app';

test('GET /quickstart/opencode.sh returns bash script with correct headers and base URL', async () => {
  // Base URL comes from NEXT_PUBLIC_GATEWAY_URL, else the request origin.
  delete process.env.NEXT_PUBLIC_GATEWAY_URL;
  const res = await app.request('https://morphic-api.web.id/quickstart/opencode.sh');

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/x-shellscript; charset=utf-8');

  const text = await res.text();
  assert.ok(text.includes('#!/usr/bin/env bash'));
  assert.ok(text.includes('https://morphic-api.web.id/v1'));
  assert.ok(text.includes('opencode.json'));
});

test('GET /quickstart/opencode.ps1 returns PowerShell script with correct headers and base URL', async () => {
  const res = await app.request('/quickstart/opencode.ps1', {
    headers: {
      host: 'morphic-api.web.id',
      'x-forwarded-proto': 'https',
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');

  const text = await res.text();
  assert.ok(text.includes('opencode quickstart for Windows'));
  assert.ok(text.includes('https://morphic-api.web.id/v1'));
  assert.ok(text.includes('opencode.json'));
  // The default is the first ready DeepSeek model, else the first ready model: whatever the DB holds.
  assert.match(text, /model = 'morphic\/[^']+'/);
});


test('GET /.well-known/opencode: login command + remote provider config, key stays a placeholder', async () => {
  delete process.env.NEXT_PUBLIC_GATEWAY_URL;
  for (const [path, shell] of [['/.well-known/opencode', 'sh'], ['/windows/.well-known/opencode', 'powershell']] as const) {
    const res = await app.request(`https://morphic-api.web.id${path}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.auth.env, 'MORPHIC_API_KEY');
    assert.equal(body.auth.command[0], shell);
    const provider = body.config.provider.morphic;
    assert.equal(provider.npm, '@ai-sdk/openai-compatible');
    assert.equal(provider.options.baseURL, 'https://morphic-api.web.id/v1');
    // opencode substitutes the stored key locally; the gateway never sees or serves it.
    assert.equal(provider.options.apiKey, '{env:MORPHIC_API_KEY}');
    for (const m of Object.values(provider.models) as { limit: { context: number; output: number } }[]) {
      assert.ok(m.limit.output > 0 && m.limit.output <= m.limit.context);
    }
    // Nothing credential-shaped besides that placeholder.
    assert.ok(!JSON.stringify(body).replaceAll('{env:MORPHIC_API_KEY}', '').match(/encrypted|credential|env:/i));
  }
});
