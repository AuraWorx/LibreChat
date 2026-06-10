'use strict';

jest.mock('../../../models/aura/BedrockApiKey');
jest.mock('../../services/aura/auditLogger', () => ({
  keyRejected: jest.fn(),
  proxyRequest: jest.fn(),
  keyCreated: jest.fn(),
  keyDeleted: jest.fn(),
}));

const mongoose = require('mongoose');
const BedrockApiKey = require('../../../models/aura/BedrockApiKey');
const auditLogger = require('../../services/aura/auditLogger');
const { extractToken, validateBedrockKey, bedrockProxyAuth } = require('./bedrockProxyAuth');
const crypto = require('crypto');

beforeAll(() => {
  // Simulate a connected mongoose instance so the 503 guard doesn't fire by default.
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1,
    writable: true,
    configurable: true,
  });
});

afterEach(() => jest.clearAllMocks());

describe('extractToken', () => {
  it('extracts token from Authorization: Bearer header', () => {
    const req = { headers: { authorization: 'Bearer mytoken123' } };
    expect(extractToken(req)).toBe('mytoken123');
  });

  it('extracts token from x-api-key header', () => {
    const req = { headers: { 'x-api-key': 'mytoken123' } };
    expect(extractToken(req)).toBe('mytoken123');
  });

  it('prefers Bearer over x-api-key when both present', () => {
    const req = { headers: { authorization: 'Bearer bearer-token', 'x-api-key': 'apikey-token' } };
    expect(extractToken(req)).toBe('bearer-token');
  });

  it('returns null when no auth headers present', () => {
    const req = { headers: {} };
    expect(extractToken(req)).toBeNull();
  });

  it('returns null for malformed Authorization header (no Bearer prefix)', () => {
    const req = { headers: { authorization: 'Token something' } };
    expect(extractToken(req)).toBeNull();
  });
});

describe('validateBedrockKey', () => {
  it('returns key doc when token matches active key', async () => {
    const fakeDoc = { _id: 'id1', userId: 'u1', active: true };
    BedrockApiKey.findByHash.mockResolvedValue(fakeDoc);
    const result = await validateBedrockKey('sometoken');
    expect(result).toBe(fakeDoc);
  });

  it('hashes the input token before lookup', async () => {
    BedrockApiKey.findByHash.mockResolvedValue(null);
    await validateBedrockKey('sometoken');
    const expectedHash = crypto.createHash('sha256').update('sometoken').digest('hex');
    expect(BedrockApiKey.findByHash).toHaveBeenCalledWith(expectedHash);
  });

  it('returns null when no key matches', async () => {
    BedrockApiKey.findByHash.mockResolvedValue(null);
    const result = await validateBedrockKey('badtoken');
    expect(result).toBeNull();
  });

  it('throws 503 error when mongoose is not connected', async () => {
    const original = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: 0,
      writable: true,
      configurable: true,
    });
    await expect(validateBedrockKey('sometoken')).rejects.toMatchObject({ statusCode: 503 });
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: original,
      writable: true,
      configurable: true,
    });
  });
});

describe('bedrockProxyAuth middleware', () => {
  function mockRes() {
    return {
      statusCode: null,
      body: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
      set(k, v) {
        this.headers[k] = v;
        return this;
      },
    };
  }

  it('emits keyRejected with reason missing_token and passes no lastFour when no auth header', async () => {
    const req = { headers: {}, requestId: 'req-1' };
    const res = mockRes();
    const next = jest.fn();
    await bedrockProxyAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(auditLogger.keyRejected).toHaveBeenCalledWith({
      reason: 'missing_token',
      lastFour: null,
      requestId: 'req-1',
    });
  });

  it('emits keyRejected with invalid_or_revoked + token lastFour when key not found', async () => {
    BedrockApiKey.findByHash.mockResolvedValue(null);
    const req = { headers: { authorization: 'Bearer abcdefghijklmnop' }, requestId: 'req-2' };
    const res = mockRes();
    const next = jest.fn();
    await bedrockProxyAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(auditLogger.keyRejected).toHaveBeenCalledWith({
      reason: 'invalid_or_revoked',
      lastFour: 'mnop',
      requestId: 'req-2',
    });
  });

  it('on valid key: calls next, sets req.bedrockKeyDoc, fires touchLastUsed, no rejection', async () => {
    const keyDoc = { _id: 'kid', userId: 'uid', lastUsedAt: null };
    BedrockApiKey.findByHash.mockResolvedValue(keyDoc);
    BedrockApiKey.touchLastUsed.mockResolvedValue({ modifiedCount: 1 });
    const req = { headers: { authorization: 'Bearer goodtoken1234' }, requestId: 'req-3' };
    const res = mockRes();
    const next = jest.fn();
    await bedrockProxyAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.bedrockKeyDoc).toBe(keyDoc);
    expect(BedrockApiKey.touchLastUsed).toHaveBeenCalledWith('kid', null);
    expect(auditLogger.keyRejected).not.toHaveBeenCalled();
  });

  it('does not reject the request if touchLastUsed write fails', async () => {
    const keyDoc = { _id: 'kid', userId: 'uid', lastUsedAt: null };
    BedrockApiKey.findByHash.mockResolvedValue(keyDoc);
    BedrockApiKey.touchLastUsed.mockRejectedValue(new Error('docdb down'));
    const req = { headers: { authorization: 'Bearer goodtoken1234' }, requestId: 'req-4' };
    const res = mockRes();
    const next = jest.fn();
    await bedrockProxyAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 503 with Retry-After when mongoose not connected', async () => {
    const original = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: 0,
      writable: true,
      configurable: true,
    });
    const req = { headers: { authorization: 'Bearer goodtoken1234' }, requestId: 'req-5' };
    const res = mockRes();
    const next = jest.fn();
    await bedrockProxyAuth(req, res, next);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('5');
    expect(next).not.toHaveBeenCalled();
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: original,
      writable: true,
      configurable: true,
    });
  });
});
