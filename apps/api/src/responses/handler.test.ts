import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleResponses } from './handler';
import type { ChatCompletion, ChatRequest } from './types';

const mockChatCompletion: ChatCompletion = {
  id: 'c1',
  created: 1790000000,
  model: 'test-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello from mock chat!' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

test('1. Fake returns chat completion JSON (200) -> handler returns 200 with object: "response"', async () => {
  const req = new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mp-key' },
    body: JSON.stringify({ model: 'test-model', input: 'Hello' }),
  });

  const fakeForward = async () =>
    Response.json(mockChatCompletion, {
      status: 200,
      headers: { 'X-Request-Id': 'req-123' },
    });

  const res = await handleResponses(req, fakeForward);
  assert.equal(res.status, 200);

  const json = (await res.json()) as { object: string; model: string; output: { content: { text: string }[] }[] };
  assert.equal(json.object, 'response');
  assert.equal(json.model, 'test-model');
  assert.equal(json.output[0].content[0].text, 'Hello from mock chat!');
});

test('2. Fake returns error (status 402) -> handler returns the same status 402 and body', async () => {
  const req = new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test-model', input: 'Hello' }),
  });

  const errorBody = { error: { message: 'Out of credit', code: 'insufficient_funds' } };
  const fakeForward = async () =>
    Response.json(errorBody, {
      status: 402,
      headers: { 'X-Request-Id': 'req-402' },
    });

  const res = await handleResponses(req, fakeForward);
  assert.equal(res.status, 402);
  assert.deepEqual(await res.json(), errorBody);
});

test('3. Request body not json -> 400 invalid_request', async () => {
  const req = new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });

  const fakeForward = async () => Response.json(mockChatCompletion);
  const res = await handleResponses(req, fakeForward);
  assert.equal(res.status, 400);

  const body = (await res.json()) as { error: { code: string; type: string } };
  assert.equal(body.error.code, 'invalid_request');
  assert.equal(body.error.type, 'invalid_request_error');
});

test('4. Header check: fake receives authorization and not content-length', async () => {
  let capturedHeaders: Headers | undefined;
  const req = new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mp-key-99',
      'Content-Length': '42',
      'User-Agent': 'test-agent',
    },
    body: JSON.stringify({ model: 'test-model', input: 'Hello' }),
  });

  const fakeForward = async (_body: ChatRequest, headers: Headers) => {
    capturedHeaders = headers;
    return Response.json(mockChatCompletion);
  };

  await handleResponses(req, fakeForward);
  assert.ok(capturedHeaders);
  assert.equal(capturedHeaders.get('authorization'), 'Bearer mp-key-99');
  assert.equal(capturedHeaders.get('user-agent'), 'test-agent');
  assert.equal(capturedHeaders.get('content-type'), 'application/json');
  assert.equal(capturedHeaders.get('content-length'), null);
});

test('5. Response headers include x-request-id copied from the fake', async () => {
  const req = new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test-model', input: 'Hello' }),
  });

  const fakeForward = async () =>
    Response.json(mockChatCompletion, {
      headers: {
        'X-Request-Id': 'req-trace-456',
        'X-RateLimit-Remaining-Requests': '42',
      },
    });

  const res = await handleResponses(req, fakeForward);
  assert.equal(res.headers.get('x-request-id'), 'req-trace-456');
  assert.equal(res.headers.get('x-ratelimit-remaining-requests'), '42');
});

test('6. Streaming: fake forwardChat returns SSE Response -> yields converted Responses SSE events and no [DONE]', async () => {
  const req = new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test-model', input: 'Hello', stream: true }),
  });

  const ssePayload =
    'data: {"model":"m","choices":[{"delta":{"content":"Hel"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    'data: [DONE]\n\n';

  const encoder = new TextEncoder();
  const fakeStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(ssePayload));
      controller.close();
    },
  });

  const fakeForward = async () =>
    new Response(fakeStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': 'req-stream' },
    });

  const res = await handleResponses(req, fakeForward);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.equal(res.headers.get('x-request-id'), 'req-stream');

  const text = await res.text();
  assert.ok(text.includes('event: response.created'));
  assert.ok(text.includes('event: response.output_text.delta'));
  assert.ok(text.includes('event: response.completed'));
  assert.equal(text.includes('[DONE]'), false);
});

test('7. Streaming error: fake stream throws mid-stream -> output ends with response.failed', async () => {
  const req = new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test-model', input: 'Hello', stream: true }),
  });

  const encoder = new TextEncoder();
  const fakeStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
      controller.error(new Error('upstream connection lost'));
    },
  });

  const fakeForward = async () =>
    new Response(fakeStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

  const res = await handleResponses(req, fakeForward);
  const text = await res.text();
  assert.ok(text.includes('event: response.created'));
  assert.ok(text.includes('event: response.failed'));
  assert.ok(text.includes('upstream connection lost'));
});

test('8. body.stream === true -> forwardChat receives stream:true and stream_options.include_usage:true', async () => {
  let capturedBody: ChatRequest | undefined;
  const req = new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test-model', input: 'Hello', stream: true }),
  });

  const fakeForward = async (body: ChatRequest) => {
    capturedBody = body;
    return new Response(new ReadableStream());
  };

  await handleResponses(req, fakeForward);
  assert.ok(capturedBody);
  assert.equal(capturedBody.stream, true);
  assert.deepEqual(capturedBody.stream_options, { include_usage: true });
});

test('9. Stream cancellation cancels the upstream reader', async () => {
  let cancelCalled = false;
  let cancelReason: unknown;
  const fakeStream = new ReadableStream<Uint8Array>({
    cancel(reason) {
      cancelCalled = true;
      cancelReason = reason;
    },
  });

  const req = new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test-model', input: 'Hello', stream: true }),
  });

  const fakeForward = async () =>
    new Response(fakeStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

  const res = await handleResponses(req, fakeForward);
  assert.ok(res.body);
  await res.body.cancel('client abort');
  assert.equal(cancelCalled, true);
  assert.equal(cancelReason, 'client abort');
});
