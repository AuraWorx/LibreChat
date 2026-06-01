'use strict';

jest.mock('../../../models/aura/BedrockApiKey');

const mongoose = require('mongoose');
const BedrockApiKey = require('../../../models/aura/BedrockApiKey');
const { extractToken, validateBedrockKey } = require('./bedrockProxyAuth');
const crypto = require('crypto');

beforeAll(() => {
  // Simulate a connected mongoose instance so the 503 guard doesn't fire by default.
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, writable: true, configurable: true });
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
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, writable: true, configurable: true });
    await expect(validateBedrockKey('sometoken')).rejects.toMatchObject({ statusCode: 503 });
    Object.defineProperty(mongoose.connection, 'readyState', { value: original, writable: true, configurable: true });
  });
});
