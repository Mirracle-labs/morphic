import type { ChatChunk, SseEvent } from './types';

/**
 * Serializes one event to SSE wire format.
 * @param event SseEvent object with event name and JSON payload
 * @returns Serialized SSE string
 */
export const formatSse = (event: SseEvent): string =>
  `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;

const extractData = (block: string): string | null => {
  const lines = block.split('\n').filter((line) => line.startsWith('data:'));
  return lines.length ? lines.map((line) => line.slice(5).trimStart()).join('\n') : null;
};

/**
 * Yields parsed chat chunks from an upstream SSE reader; stops at [DONE].
 * The caller owns the reader (and cancels it on client disconnect).
 * @param reader ReadableStreamDefaultReader reading Uint8Array chunks
 * @returns AsyncGenerator yielding ChatChunk objects
 */
export async function* parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ChatChunk> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const data = extractData(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (data === '[DONE]') {
        return;
      }
      if (data) {
        yield JSON.parse(data) as ChatChunk;
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

