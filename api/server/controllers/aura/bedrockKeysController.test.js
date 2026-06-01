'use strict';

jest.mock('../../../models/aura/BedrockApiKey');
jest.mock('../../services/aura/auditLogger');

const mongoose = require('mongoose');
const BedrockApiKey = require('../../../models/aura/BedrockApiKey');
const auditLogger = require('../../services/aura/auditLogger');
const { createKey, listKeys, deleteKey } = require('./bedrockKeysController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

const userId = new mongoose.Types.ObjectId().toString();
const keyId = new mongoose.Types.ObjectId().toString();

afterEach(() => jest.clearAllMocks());

describe('createKey', () => {
  it('returns 201 with token, lastFour, id, name, createdAt on success', async () => {
    const fakeToken = 'a'.repeat(40);
    BedrockApiKey.generateToken.mockReturnValue({ token: fakeToken, hash: 'hashval', lastFour: 'aaaa' });
    BedrockApiKey.findOne.mockResolvedValue(null);
    const fakeDoc = { _id: new mongoose.Types.ObjectId(), name: 'my-key', lastFour: 'aaaa', createdAt: new Date() };
    BedrockApiKey.create.mockResolvedValue(fakeDoc);

    const req = { user: { id: userId }, body: { name: 'my-key' } };
    const res = mockRes();
    await createKey(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.token).toBe(fakeToken);
    expect(payload.lastFour).toBe('aaaa');
    expect(payload.name).toBe('my-key');
  });

  it('returns 400 when name is missing', async () => {
    const req = { user: { id: userId }, body: {} };
    const res = mockRes();
    await createKey(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when name is empty string', async () => {
    const req = { user: { id: userId }, body: { name: '' } };
    const res = mockRes();
    await createKey(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when name exceeds 100 chars', async () => {
    const req = { user: { id: userId }, body: { name: 'a'.repeat(101) } };
    const res = mockRes();
    await createKey(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 409 when a key with same name already exists for user', async () => {
    BedrockApiKey.findOne.mockResolvedValue({ name: 'dup', active: true });
    const req = { user: { id: userId }, body: { name: 'dup' } };
    const res = mockRes();
    await createKey(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('allows same name across different users', async () => {
    BedrockApiKey.findOne.mockResolvedValue(null);
    BedrockApiKey.generateToken.mockReturnValue({ token: 'tok', hash: 'h', lastFour: 'x9zT' });
    const fakeDoc = { _id: new mongoose.Types.ObjectId(), name: 'shared', lastFour: 'x9zT', createdAt: new Date() };
    BedrockApiKey.create.mockResolvedValue(fakeDoc);
    const req = { user: { id: new mongoose.Types.ObjectId().toString() }, body: { name: 'shared' } };
    const res = mockRes();
    await createKey(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('emits key.created audit event', async () => {
    BedrockApiKey.findOne.mockResolvedValue(null);
    BedrockApiKey.generateToken.mockReturnValue({ token: 'tok', hash: 'h', lastFour: 'x9zT' });
    const fakeDoc = { _id: new mongoose.Types.ObjectId(), name: 'audit-key', lastFour: 'x9zT', createdAt: new Date() };
    BedrockApiKey.create.mockResolvedValue(fakeDoc);
    const req = { user: { id: userId }, body: { name: 'audit-key' }, requestId: 'req_1' };
    const res = mockRes();
    await createKey(req, res);
    expect(auditLogger.keyCreated).toHaveBeenCalled();
  });
});

describe('listKeys', () => {
  it('returns only the authenticated user\'s active keys', async () => {
    const keys = [{ _id: new mongoose.Types.ObjectId(), name: 'a', lastFour: '1111', active: true }];
    BedrockApiKey.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(keys) }),
    });
    const req = { user: { id: userId } };
    const res = mockRes();
    await listKeys(req, res);
    expect(BedrockApiKey.find).toHaveBeenCalledWith({ userId, active: true });
    expect(res.json).toHaveBeenCalled();
  });

  it('never returns hash field', async () => {
    const rawKeys = [{ _id: new mongoose.Types.ObjectId(), name: 'a', lastFour: '1111', hash: 'SECRET', active: true, createdAt: new Date(), lastUsedAt: null }];
    BedrockApiKey.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(rawKeys) }),
    });
    const req = { user: { id: userId } };
    const res = mockRes();
    await listKeys(req, res);
    const returned = res.json.mock.calls[0][0].keys;
    expect(returned[0].hash).toBeUndefined();
  });
});

describe('deleteKey', () => {
  it('returns 204 on successful soft delete', async () => {
    BedrockApiKey.findOne.mockResolvedValue({ _id: keyId, name: 'k', lastFour: '1234' });
    BedrockApiKey.softDelete.mockResolvedValue({ modifiedCount: 1 });
    const req = { user: { id: userId }, params: { id: keyId } };
    const res = mockRes();
    await deleteKey(req, res);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 404 when key does not exist', async () => {
    BedrockApiKey.findOne.mockResolvedValue(null);
    const req = { user: { id: userId }, params: { id: keyId } };
    const res = mockRes();
    await deleteKey(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 404 for invalid ObjectId format', async () => {
    const req = { user: { id: userId }, params: { id: 'not-valid' } };
    const res = mockRes();
    await deleteKey(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('emits key.deleted audit event on success', async () => {
    BedrockApiKey.findOne.mockResolvedValue({ _id: keyId, name: 'k', lastFour: '1234' });
    BedrockApiKey.softDelete.mockResolvedValue({ modifiedCount: 1 });
    const req = { user: { id: userId }, params: { id: keyId }, requestId: 'req_del' };
    const res = mockRes();
    await deleteKey(req, res);
    expect(auditLogger.keyDeleted).toHaveBeenCalled();
  });
});
