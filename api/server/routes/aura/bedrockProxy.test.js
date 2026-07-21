'use strict';

jest.mock('../../middleware/aura/bedrockProxyAuth');
jest.mock('../../middleware/aura/rateLimiter');
jest.mock('../../controllers/aura/bedrockProxyController');
jest.mock('../../services/aura/bedrockTranslator');

const request = require('supertest');
const express = require('express');
const { bedrockProxyAuth } = require('../../middleware/aura/bedrockProxyAuth');
const { createUserRateLimiter, createIpRateLimiter } = require('../../middleware/aura/rateLimiter');
const {
  handleMessages,
  handleCountTokens,
} = require('../../controllers/aura/bedrockProxyController');

const FAKE_MODELS = [
  { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', name: 'Claude 3.5 Sonnet v2', recommendedId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0' },
  { id: 'anthropic.claude-sonnet-4-6', name: 'Claude Sonnet 4.6', recommendedId: 'us.anthropic.claude-sonnet-4-6' },
  { id: 'amazon.nova-pro-v1:0', name: 'Amazon Nova Pro', recommendedId: 'amazon.nova-pro-v1:0' },
];

function makeApp({ modelList = FAKE_MODELS } = {}) {
  // Fresh require each call so route setup runs with current mocks
  jest.resetModules();
  jest.mock('../../middleware/aura/bedrockProxyAuth');
  jest.mock('../../middleware/aura/rateLimiter');
  jest.mock('../../controllers/aura/bedrockProxyController');
  jest.mock('../../services/aura/bedrockTranslator');

  const { bedrockProxyAuth: auth } = require('../../middleware/aura/bedrockProxyAuth');
  const {
    createUserRateLimiter: mkUser,
    createIpRateLimiter: mkIp,
  } = require('../../middleware/aura/rateLimiter');
  const {
    handleMessages: hm,
    handleCountTokens: hct,
  } = require('../../controllers/aura/bedrockProxyController');
  const { getLiveModelList } = require('../../services/aura/bedrockTranslator');

  auth.mockImplementation((req, res, next) => next());
  const passThrough = jest.fn((req, res, next) => next());
  passThrough.resetKey = jest.fn();
  mkUser.mockReturnValue(passThrough);
  mkIp.mockReturnValue(passThrough);
  hm.mockImplementation((req, res) => res.status(200).json({ ok: true }));
  hct.mockImplementation((req, res) => res.status(200).json({ input_tokens: 7 }));
  getLiveModelList.mockResolvedValue(modelList);

  const router = require('./bedrockProxy');
  const app = express();
  app.use(express.json());
  app.use('/bedrock', router);
  return app;
}

describe('bedrockProxy route', () => {
  describe('GET /bedrock/v1/models', () => {
    it('returns only Anthropic models in Anthropic API shape', async () => {
      const app = makeApp();
      const res = await request(app).get('/bedrock/v1/models');
      expect(res.status).toBe(200);
      expect(res.body.has_more).toBe(false);
      expect(res.body.data).toHaveLength(2); // amazon.nova excluded
      expect(res.body.data[0]).toMatchObject({
        type: 'model',
        id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        display_name: 'Claude 3.5 Sonnet v2',
        created_at: expect.any(Number),
      });
      expect(res.body.first_id).toBe('us.anthropic.claude-3-5-sonnet-20241022-v2:0');
      expect(res.body.last_id).toBe('us.anthropic.claude-sonnet-4-6');
    });

    it('returns empty data array when no Anthropic models available', async () => {
      const app = makeApp({ modelList: [{ id: 'amazon.nova-pro-v1:0', name: 'Nova Pro', recommendedId: 'amazon.nova-pro-v1:0' }] });
      const res = await request(app).get('/bedrock/v1/models');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.first_id).toBeNull();
      expect(res.body.last_id).toBeNull();
    });

    it('returns 500 when getLiveModelList throws', async () => {
      jest.resetModules();
      jest.mock('../../middleware/aura/bedrockProxyAuth');
      jest.mock('../../middleware/aura/rateLimiter');
      jest.mock('../../controllers/aura/bedrockProxyController');
      jest.mock('../../services/aura/bedrockTranslator');

      const { bedrockProxyAuth: auth } = require('../../middleware/aura/bedrockProxyAuth');
      const { createUserRateLimiter: mkUser, createIpRateLimiter: mkIp } = require('../../middleware/aura/rateLimiter');
      const { getLiveModelList } = require('../../services/aura/bedrockTranslator');

      auth.mockImplementation((req, res, next) => next());
      const pt = jest.fn((req, res, next) => next());
      pt.resetKey = jest.fn();
      mkUser.mockReturnValue(pt);
      mkIp.mockReturnValue(pt);
      getLiveModelList.mockRejectedValue(new Error('AWS error'));

      const router = require('./bedrockProxy');
      const app = express();
      app.use(express.json());
      app.use('/bedrock', router);

      const res = await request(app).get('/bedrock/v1/models');
      expect(res.status).toBe(500);
      expect(res.body.error.type).toBe('api_error');
    });
  });

  describe('GET /bedrock/v1/models/:modelId', () => {
    it('returns model by recommendedId', async () => {
      const app = makeApp();
      const res = await request(app).get('/bedrock/v1/models/us.anthropic.claude-sonnet-4-6');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        type: 'model',
        id: 'us.anthropic.claude-sonnet-4-6',
        display_name: 'Claude Sonnet 4.6',
      });
    });

    it('returns model by bare id', async () => {
      const app = makeApp();
      const res = await request(app).get('/bedrock/v1/models/anthropic.claude-sonnet-4-6');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('us.anthropic.claude-sonnet-4-6');
    });

    it('returns 404 for unknown model', async () => {
      const app = makeApp();
      const res = await request(app).get('/bedrock/v1/models/anthropic.fake-model');
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('not_found_error');
    });
  });

  it('POST /bedrock/v1/messages → 200 via handleMessages', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/bedrock/v1/messages')
      .send({ model: 'claude-sonnet-4-6', messages: [], max_tokens: 16 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /bedrock/v1/messages/count_tokens → 200 via handleCountTokens', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/bedrock/v1/messages/count_tokens')
      .send({ model: 'claude-sonnet-4-6', messages: [], max_tokens: 16 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ input_tokens: 7 });
  });

  it('GET /bedrock/v1/messages → 404 (only POST registered)', async () => {
    const app = makeApp();
    const res = await request(app).get('/bedrock/v1/messages');
    expect(res.status).toBe(404);
  });

  it('auth middleware is applied before handlers', async () => {
    jest.resetModules();
    jest.mock('../../middleware/aura/bedrockProxyAuth');
    jest.mock('../../middleware/aura/rateLimiter');
    jest.mock('../../controllers/aura/bedrockProxyController');

    const { bedrockProxyAuth: auth } = require('../../middleware/aura/bedrockProxyAuth');
    const {
      createUserRateLimiter: mkUser,
      createIpRateLimiter: mkIp,
    } = require('../../middleware/aura/rateLimiter');
    const { handleMessages: hm } = require('../../controllers/aura/bedrockProxyController');

    auth.mockImplementation((req, res) => res.status(401).json({ error: 'unauthorized' }));
    const passThrough = jest.fn((req, res, next) => next());
    passThrough.resetKey = jest.fn();
    mkUser.mockReturnValue(passThrough);
    mkIp.mockReturnValue(passThrough);
    hm.mockImplementation((req, res) => res.status(200).json({ ok: true }));

    const router = require('./bedrockProxy');
    const app = express();
    app.use(express.json());
    app.use('/bedrock', router);

    const res = await request(app)
      .post('/bedrock/v1/messages')
      .send({ model: 'claude-sonnet-4-6', messages: [], max_tokens: 16 });
    expect(res.status).toBe(401);
  });
});
