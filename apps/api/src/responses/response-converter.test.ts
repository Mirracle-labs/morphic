import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromChatCompletion, mapFinishReason, mapUsage } from './response-converter';
import { GatewayError } from './errors';
import type { ChatCompletion, ResponsesRequest } from './types';

const mockReq: ResponsesRequest = {
  model: 'm',
  input: 'Say hi',
};

test('1. Text completion conversion', () => {
  const chat: ChatCompletion = {
    id: 'c1',
    created: 1790000000,
    model: 'm',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  };

  const res = fromChatCompletion(chat, mockReq);
  assert.equal(res.status, 'completed');
  assert.ok(res.id.startsWith('resp_'));
  assert.equal(res.output.length, 1);

  const first = res.output[0];
  assert.equal(first.type, 'message');
  assert.ok(first.id.startsWith('msg_'));
  if (first.type === 'message') {
    assert.deepEqual(first.content, [{ type: 'output_text', text: 'Hello!', annotations: [] }]);
  }

  assert.deepEqual(res.usage, {
    input_tokens: 5,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 2,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 7,
  });

  // Verify output[*] has no top-level output_text field
  for (const item of res.output) {
    assert.equal('output_text' in item, false);
  }
});

test('2. Tool call conversion', () => {
  const chat: ChatCompletion = {
    id: 'c2',
    created: 1790000000,
    model: 'm',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'f', arguments: '{"a":1}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };

  const res = fromChatCompletion(chat, mockReq);
  assert.equal(res.status, 'completed');
  assert.equal(res.output.length, 1);

  const item = res.output[0];
  assert.equal(item.type, 'function_call');
  assert.ok(item.id.startsWith('fc_'));
  if (item.type === 'function_call') {
    assert.equal(item.call_id, 'call_1');
    assert.equal(item.name, 'f');
    assert.equal(item.arguments, '{"a":1}');
    assert.equal(item.status, 'completed');
  }
});

test('3. finish_reason: length maps to incomplete max_output_tokens', () => {
  const info = mapFinishReason('length');
  assert.equal(info.status, 'incomplete');
  assert.deepEqual(info.incomplete, { reason: 'max_output_tokens' });
});

test('4. finish_reason: content_filter maps to incomplete content_filter', () => {
  const info = mapFinishReason('content_filter');
  assert.equal(info.status, 'incomplete');
  assert.deepEqual(info.incomplete, { reason: 'content_filter' });
});

test('5. Missing choices throws GatewayError 502', () => {
  const chat: ChatCompletion = {
    id: 'c3',
    created: 1790000000,
    model: 'm',
    choices: [],
  };

  assert.throws(
    () => fromChatCompletion(chat, mockReq),
    (err: unknown) => err instanceof GatewayError && err.status === 502 && err.code === 'upstream_error',
  );
});

test('6. Missing usage results in usage: null', () => {
  assert.equal(mapUsage(null), null);
  assert.equal(mapUsage(undefined), null);

  const chat: ChatCompletion = {
    id: 'c4',
    created: 1790000000,
    model: 'm',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'test' },
        finish_reason: 'stop',
      },
    ],
  };

  const res = fromChatCompletion(chat, mockReq);
  assert.equal(res.usage, null);
});

