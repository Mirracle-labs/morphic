import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamConverter } from './stream-converter';
import { parseSseStream } from './sse';
import type { MessageItem, ResponsesObject, ResponsesRequest } from './types';

const mockReq: ResponsesRequest = {
  model: 'test-model',
  input: 'Say hi',
};

test('A. Text stream event sequence and sequence numbers', () => {
  const converter = new StreamConverter(mockReq);
  const events = [
    ...converter.push({ model: 'm', choices: [{ delta: { content: 'Hel' } }] }),
    ...converter.push({ choices: [{ delta: { content: 'lo' } }] }),
    ...converter.push({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ...converter.push({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }),
    ...converter.finish(),
  ];

  const types = events.map((e) => e.event);
  assert.deepEqual(types, [
    'response.created',
    'response.in_progress',
    'response.output_item.added',
    'response.content_part.added',
    'response.output_text.delta',
    'response.output_text.delta',
    'response.output_text.done',
    'response.content_part.done',
    'response.output_item.done',
    'response.completed',
  ]);

  // Sequence numbers are 0, 1, 2, ... strictly increasing with no gaps
  events.forEach((e, idx) => {
    assert.equal(e.data.sequence_number, idx);
  });

  // Final response object assertions
  const finalEvent = events[events.length - 1];
  const finalResp = finalEvent.data.response as ResponsesObject;
  assert.equal(finalResp.status, 'completed');
  assert.equal(finalResp.usage?.input_tokens, 5);

  const firstOutput = finalResp.output[0] as MessageItem;
  assert.equal(firstOutput.type, 'message');
  assert.equal(firstOutput.content[0].type, 'output_text');
  if (firstOutput.content[0].type === 'output_text') {
    assert.equal(firstOutput.content[0].text, 'Hello');
  }
});

test('B. Tool stream event sequence and argument aggregation', () => {
  const converter = new StreamConverter(mockReq);
  const events = [
    ...converter.push({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'f', arguments: '' } }] } }],
    }),
    ...converter.push({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] } }],
    }),
    ...converter.push({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }],
    }),
    ...converter.push({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    }),
    ...converter.finish(),
  ];

  const types = events.map((e) => e.event);
  assert.ok(types.includes('response.output_item.added'));
  assert.ok(types.includes('response.function_call_arguments.delta'));
  assert.ok(types.includes('response.function_call_arguments.done'));
  assert.ok(types.includes('response.output_item.done'));
  assert.ok(types.includes('response.completed'));

  const doneEvent = events.find((e) => e.event === 'response.function_call_arguments.done');
  assert.equal(doneEvent?.data.arguments, '{"a":1}');

  const finalEvent = events[events.length - 1];
  const finalResp = finalEvent.data.response as ResponsesObject;
  assert.equal(finalResp.status, 'completed');
  assert.equal(finalResp.output[0].type, 'function_call');
  if (finalResp.output[0].type === 'function_call') {
    assert.equal(finalResp.output[0].arguments, '{"a":1}');
  }
});

test('C. finish_reason: length -> response.incomplete with max_output_tokens', () => {
  const converter = new StreamConverter(mockReq);
  converter.push({ choices: [{ delta: { content: 'chunk' }, finish_reason: 'length' }] });
  const events = converter.finish();

  const terminal = events[events.length - 1];
  assert.equal(terminal.event, 'response.incomplete');

  const resp = terminal.data.response as ResponsesObject;
  assert.equal(resp.status, 'incomplete');
  assert.equal(resp.incomplete_details?.reason, 'max_output_tokens');
});

test('D. fail("boom") -> response.created, response.in_progress, response.failed', () => {
  const converter = new StreamConverter(mockReq);
  const events = converter.fail('boom');

  const types = events.map((e) => e.event);
  assert.deepEqual(types, ['response.created', 'response.in_progress', 'response.failed']);

  const failedEvent = events[events.length - 1];
  const resp = failedEvent.data.response as ResponsesObject;
  assert.equal(resp.status, 'failed');
  assert.equal(resp.error?.message, 'boom');
});

test('E. parseSseStream yields parsed chat chunks across chunk boundaries and stops at [DONE]', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('data: {"a"'),
    encoder.encode(':1}\n\ndata: [DONE]\n\n'),
  ];

  let chunkIndex = 0;
  const fakeStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(chunks[chunkIndex++]);
      } else {
        controller.close();
      }
    },
  });

  const parsed: unknown[] = [];
  for await (const chunk of parseSseStream(fakeStream.getReader())) {
    parsed.push(chunk);
  }

  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], { a: 1 });
});
