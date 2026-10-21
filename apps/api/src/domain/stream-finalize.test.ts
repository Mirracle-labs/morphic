import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpenAiStreamFinalizer,
  startHeartbeat,
  heartbeatMs,
  STREAM_ERROR_PAYLOAD,
} from './stream-finalize';

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

test('finalizer: keeps [DONE] and adds nothing at the end', () => {
  const f = createOpenAiStreamFinalizer();
  f.push(sse({ choices: [{ delta: { content: 'hi' } }] }) + 'data: [DONE]\n\n');
  assert.equal(f.done, true);
  assert.equal(f.end(), '');
});

test('finalizer: adds [DONE] when the upstream ends without it', () => {
  const f = createOpenAiStreamFinalizer();
  f.push(sse({ choices: [{ delta: { content: 'hi' } }] }));
  assert.equal(f.done, false);
  assert.equal(f.end(), 'data: [DONE]\n\n');
});

test('finalizer: adds a newline before [DONE] when the last chunk has no trailing newline', () => {
  const f = createOpenAiStreamFinalizer();
  f.push('data: {"choices":[]}');
  assert.equal(f.end(), '\ndata: [DONE]\n\n');
});

test('finalizer: detects [DONE] split across chunks', () => {
  const f = createOpenAiStreamFinalizer();
  f.push('data: [DO');
  f.push('NE]\n\n');
  assert.equal(f.done, true);
  assert.equal(f.end(), '');
});

test('finalizer: accepts data:[DONE] without a space', () => {
  const f = createOpenAiStreamFinalizer();
  f.push('data:[DONE]\n');
  assert.equal(f.done, true);
});

test('finalizer: fail() returns a sanitized error chunk followed by [DONE]', () => {
  const f = createOpenAiStreamFinalizer();
  f.push(sse({ choices: [{ delta: { content: 'partial' } }] }));
  const out = f.fail();
  assert.ok(out.startsWith(`data: ${JSON.stringify(STREAM_ERROR_PAYLOAD)}\n\n`));
  assert.ok(out.endsWith('data: [DONE]\n\n'));
  assert.equal(out.includes('partial'), false);
  assert.equal(f.done, true);
});

test('startHeartbeat: writes after each idle interval and stops cleanly', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const heartbeat = startHeartbeat(() => {
    count += 1;
  }, 10);

  t.mock.timers.tick(10);
  assert.equal(count, 1);
  t.mock.timers.tick(20);
  assert.equal(count, 2);
  t.mock.timers.tick(10);
  assert.equal(count, 3);

  heartbeat.stop();
  t.mock.timers.tick(50);
  assert.equal(count, 3);
  t.mock.timers.reset();
});

test('startHeartbeat: touch() postpones the beat while activity continues', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const heartbeat = startHeartbeat(() => {
    count += 1;
  }, 10);

  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(9);
    heartbeat.touch();
  }
  assert.equal(count, 0);

  t.mock.timers.tick(10);
  assert.equal(count, 1);

  heartbeat.stop();
  t.mock.timers.reset();
});

test('startHeartbeat: canWrite() suppresses a beat without stopping later beats', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  let allowed = false;
  const heartbeat = startHeartbeat(
    () => {
      count += 1;
    },
    10,
    () => allowed,
  );

  t.mock.timers.tick(20);
  assert.equal(count, 0);
  allowed = true;
  t.mock.timers.tick(10);
  assert.equal(count, 1);

  heartbeat.stop();
  t.mock.timers.reset();
});

test('heartbeatMs: honors SSE_HEARTBEAT_MS and rejects bad values', () => {
  const original = process.env.SSE_HEARTBEAT_MS;
  try {
    process.env.SSE_HEARTBEAT_MS = '2500';
    assert.equal(heartbeatMs(), 2500);
    process.env.SSE_HEARTBEAT_MS = 'nope';
    assert.equal(heartbeatMs(), 15_000);
  } finally {
    if (original === undefined) delete process.env.SSE_HEARTBEAT_MS;
    else process.env.SSE_HEARTBEAT_MS = original;
  }
});
