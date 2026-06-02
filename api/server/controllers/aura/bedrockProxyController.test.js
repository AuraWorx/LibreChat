'use strict';

jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('../../services/aura/bedrockStreamer');
jest.mock('../../services/aura/auditLogger');

const {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  CountTokensCommand,
} = require('@aws-sdk/client-bedrock-runtime');
const { streamBedrockResponse } = require('../../services/aura/bedrockStreamer');
const auditLogger = require('../../services/aura/auditLogger');
const { handleMessages, handleCountTokens } = require('./bedrockProxyController');

function mockReq(overrides = {}) {
  return {
    body: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
    headers: {},
    bedrockKeyDoc: { _id: 'kid1', userId: 'uid1' },
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
}

function makeBedrockClient(sendImpl) {
  BedrockRuntimeClient.mockImplementation(() => ({ send: jest.fn().mockImplementation(sendImpl) }));
}

afterEach(() => jest.clearAllMocks());

describe('handleMessages — non-streaming', () => {
  it('calls InvokeModelCommand and returns JSON on stream:false', async () => {
    const fakeResponse = { body: Buffer.from(JSON.stringify({ id: 'msg_1', content: [{ text: 'hello' }], usage: { input_tokens: 10, output_tokens: 5 } })) };
    makeBedrockClient(() => Promise.resolve(fakeResponse));
    streamBedrockResponse.mockResolvedValue();

    const req = mockReq({ body: { model: 'claude-sonnet-4-6', messages: [], max_tokens: 16, stream: false } });
    const res = mockRes();
    await handleMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalled();
  });

  it('defaults to non-streaming when stream is omitted', async () => {
    const fakeResponse = { body: Buffer.from(JSON.stringify({ usage: { input_tokens: 5, output_tokens: 3 } })) };
    makeBedrockClient(() => Promise.resolve(fakeResponse));

    const req = mockReq();
    const res = mockRes();
    await handleMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('handleMessages — streaming', () => {
  it('calls InvokeModelWithResponseStreamCommand and pipes through streamer on stream:true', async () => {
    async function* fakeStream() { yield { chunk: { bytes: Buffer.from('{}') } }; }
    makeBedrockClient(() => Promise.resolve({ body: fakeStream() }));
    streamBedrockResponse.mockResolvedValue();

    const req = mockReq({ body: { model: 'claude-sonnet-4-6', messages: [], max_tokens: 16, stream: true } });
    const res = mockRes();
    await handleMessages(req, res);

    expect(streamBedrockResponse).toHaveBeenCalled();
  });
});

describe('handleMessages — error mapping', () => {
  async function callWithError(errorName) {
    const err = new Error('AWS error');
    err.name = errorName;
    makeBedrockClient(() => Promise.reject(err));
    const req = mockReq();
    const res = mockRes();
    await handleMessages(req, res);
    return res;
  }

  it('maps ThrottlingException → 429 + Retry-After: 10', async () => {
    const res = await callWithError('ThrottlingException');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '10');
  });

  it('maps ValidationException → 400', async () => {
    const res = await callWithError('ValidationException');
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('maps AccessDeniedException → 403', async () => {
    const res = await callWithError('AccessDeniedException');
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('maps ModelNotReadyException → 503 + Retry-After: 15', async () => {
    const res = await callWithError('ModelNotReadyException');
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '15');
  });

  it('maps ResourceNotFoundException → 404', async () => {
    const res = await callWithError('ResourceNotFoundException');
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('maps unknown error → 500', async () => {
    const res = await callWithError('UnknownError');
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('never exposes raw error.message in response body', async () => {
    const err = new Error('Super secret AWS internal message');
    err.name = 'ThrottlingException';
    makeBedrockClient(() => Promise.reject(err));
    const req = mockReq();
    const res = mockRes();
    await handleMessages(req, res);
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('Super secret AWS internal message');
  });

  it('emits bedrock_proxy_request log with error statusCode', async () => {
    const err = new Error('throttled');
    err.name = 'ThrottlingException';
    makeBedrockClient(() => Promise.reject(err));
    const req = mockReq();
    const res = mockRes();
    await handleMessages(req, res);
    expect(auditLogger.proxyRequest).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 429 }));
  });
});

describe('handleMessages — observability', () => {
  it('emits bedrock_proxy_request log on success', async () => {
    const fakeResponse = { body: Buffer.from(JSON.stringify({ usage: { input_tokens: 8, output_tokens: 4 } })) };
    makeBedrockClient(() => Promise.resolve(fakeResponse));
    const req = mockReq();
    const res = mockRes();
    await handleMessages(req, res);
    expect(auditLogger.proxyRequest).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200 }));
  });
});

describe('handleCountTokens', () => {
  it('calls CountTokensCommand and returns { input_tokens: N }', async () => {
    makeBedrockClient(() => Promise.resolve({ inputTokenCount: 42 }));
    const req = mockReq();
    const res = mockRes();
    await handleCountTokens(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ input_tokens: 42 });
  });

  it('strips stream field before translating body', async () => {
    makeBedrockClient(() => Promise.resolve({ inputTokenCount: 5 }));
    const req = mockReq({ body: { model: 'claude-sonnet-4-6', messages: [], max_tokens: 100, stream: true } });
    const res = mockRes();
    await handleCountTokens(req, res);
    // CountTokensCommand is auto-mocked — check constructor call args directly
    const ctorArgs = CountTokensCommand.mock.calls[CountTokensCommand.mock.calls.length - 1][0];
    const sentBody = JSON.parse(Buffer.from(ctorArgs.body).toString());
    expect(sentBody.stream).toBeUndefined();
  });

  it('maps Bedrock errors same as handleMessages', async () => {
    const err = new Error('denied');
    err.name = 'AccessDeniedException';
    makeBedrockClient(() => Promise.reject(err));
    const req = mockReq();
    const res = mockRes();
    await handleCountTokens(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
