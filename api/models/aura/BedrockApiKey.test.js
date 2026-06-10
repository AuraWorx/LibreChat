'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const BedrockApiKey = require('./BedrockApiKey');

// No real DB needed — generateToken is pure crypto; validate() works offline;
// findByHash/softDelete are mocked below.

describe('BedrockApiKey.generateToken', () => {
  it('returns a 40-char base64url token', () => {
    const { token } = BedrockApiKey.generateToken();
    expect(token).toHaveLength(40);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns correct SHA-256 hash', () => {
    const { token, hash } = BedrockApiKey.generateToken();
    expect(hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
  });

  it('returns lastFour matching final 4 chars of token', () => {
    const { token, lastFour } = BedrockApiKey.generateToken();
    expect(lastFour).toBe(token.slice(-4));
  });

  it('produces unique tokens on each call', () => {
    const a = BedrockApiKey.generateToken();
    const b = BedrockApiKey.generateToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe('BedrockApiKey schema validation', () => {
  it('requires userId', async () => {
    const { hash, lastFour } = BedrockApiKey.generateToken();
    const doc = new BedrockApiKey({ name: 'test', hash, lastFour });
    await expect(doc.validate()).rejects.toThrow(/userId/);
  });

  it('requires name', async () => {
    const { hash, lastFour } = BedrockApiKey.generateToken();
    const doc = new BedrockApiKey({ userId: new mongoose.Types.ObjectId(), hash, lastFour });
    await expect(doc.validate()).rejects.toThrow(/name/);
  });

  it('rejects name longer than 100 chars', async () => {
    const { hash, lastFour } = BedrockApiKey.generateToken();
    const doc = new BedrockApiKey({
      userId: new mongoose.Types.ObjectId(),
      name: 'a'.repeat(101),
      hash,
      lastFour,
    });
    await expect(doc.validate()).rejects.toThrow(/name/);
  });

  it('defaults allowedModels to null', () => {
    const { hash, lastFour } = BedrockApiKey.generateToken();
    const doc = new BedrockApiKey({
      userId: new mongoose.Types.ObjectId(),
      name: 'x',
      hash,
      lastFour,
    });
    expect(doc.allowedModels).toBeNull();
  });

  it('defaults lastUsedAt to null', () => {
    const { hash, lastFour } = BedrockApiKey.generateToken();
    const doc = new BedrockApiKey({
      userId: new mongoose.Types.ObjectId(),
      name: 'x',
      hash,
      lastFour,
    });
    expect(doc.lastUsedAt).toBeNull();
  });

  it('defaults active to true', () => {
    const { hash, lastFour } = BedrockApiKey.generateToken();
    const doc = new BedrockApiKey({
      userId: new mongoose.Types.ObjectId(),
      name: 'x',
      hash,
      lastFour,
    });
    expect(doc.active).toBe(true);
  });
});

describe('BedrockApiKey.findByHash', () => {
  afterEach(() => jest.restoreAllMocks());

  it('queries with hash and active:true', async () => {
    const spy = jest.spyOn(BedrockApiKey, 'findOne').mockResolvedValue({ hash: 'abc' });
    await BedrockApiKey.findByHash('abc');
    expect(spy).toHaveBeenCalledWith({ hash: 'abc', active: true });
  });

  it('returns null when findOne returns null', async () => {
    jest.spyOn(BedrockApiKey, 'findOne').mockResolvedValue(null);
    const result = await BedrockApiKey.findByHash('unknown');
    expect(result).toBeNull();
  });
});

describe('BedrockApiKey.touchLastUsed', () => {
  afterEach(() => jest.restoreAllMocks());

  it('writes lastUsedAt when key has never been used', async () => {
    const id = new mongoose.Types.ObjectId();
    const spy = jest.spyOn(BedrockApiKey, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    await BedrockApiKey.touchLastUsed(id, null);
    expect(spy).toHaveBeenCalledTimes(1);
    const [filter, update] = spy.mock.calls[0];
    expect(filter).toEqual({ _id: id });
    expect(update.$set.lastUsedAt).toBeInstanceOf(Date);
  });

  it('writes lastUsedAt when last use is older than the debounce window', async () => {
    const id = new mongoose.Types.ObjectId();
    const spy = jest.spyOn(BedrockApiKey, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    const stale = new Date(Date.now() - (BedrockApiKey.LAST_USED_DEBOUNCE_MS + 1000));
    await BedrockApiKey.touchLastUsed(id, stale);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('skips the write (debounced) when last use is within the window', async () => {
    const id = new mongoose.Types.ObjectId();
    const spy = jest.spyOn(BedrockApiKey, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    const recent = new Date(Date.now() - 1000);
    const result = await BedrockApiKey.touchLastUsed(id, recent);
    expect(spy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ debounced: true, modifiedCount: 0 });
  });
});
