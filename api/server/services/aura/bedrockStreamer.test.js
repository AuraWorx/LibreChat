'use strict';

const { streamBedrockResponse } = require('./bedrockStreamer');

function makeRes() {
  return {
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
}

async function* makeStream(items) {
  for (const item of items) yield item;
}

async function* errorStream() {
  yield { chunk: { bytes: Buffer.from(JSON.stringify({ type: 'content_block_start' })) } };
  throw new Error('mid-stream failure');
}

async function* emptyStream() {}

describe('streamBedrockResponse', () => {
  it('sets Content-Type: text/event-stream', async () => {
    const res = makeRes();
    await streamBedrockResponse(emptyStream(), res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
  });

  it('sets Cache-Control: no-cache', async () => {
    const res = makeRes();
    await streamBedrockResponse(emptyStream(), res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
  });

  it('sets Connection: keep-alive', async () => {
    const res = makeRes();
    await streamBedrockResponse(emptyStream(), res);
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
  });

  it('re-emits each chunk bytes as SSE data line', async () => {
    const payload = JSON.stringify({ type: 'content_block_delta', delta: { text: 'hi' } });
    const res = makeRes();
    await streamBedrockResponse(makeStream([{ chunk: { bytes: Buffer.from(payload) } }]), res);
    expect(res.write).toHaveBeenCalledWith(`data: ${payload}\n\n`);
  });

  it('skips chunks without bytes', async () => {
    const res = makeRes();
    await streamBedrockResponse(makeStream([{ chunk: {} }, { someOtherEvent: true }]), res);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('calls res.end() after iterator is exhausted', async () => {
    const res = makeRes();
    await streamBedrockResponse(emptyStream(), res);
    expect(res.end).toHaveBeenCalled();
  });

  it('on mid-stream error emits SSE error event then ends', async () => {
    const res = makeRes();
    await streamBedrockResponse(errorStream(), res);
    const writes = res.write.mock.calls.map((c) => c[0]);
    const errorWrite = writes.find((w) => w.includes('"type":"error"'));
    expect(errorWrite).toBeDefined();
    expect(res.end).toHaveBeenCalled();
  });

  it('empty stream calls res.end() without writing any data', async () => {
    const res = makeRes();
    await streamBedrockResponse(emptyStream(), res);
    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });
});
