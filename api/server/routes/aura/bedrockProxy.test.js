'use strict';

jest.mock('../../middleware/aura/bedrockProxyAuth');
jest.mock('../../middleware/aura/rateLimiter');
jest.mock('../../controllers/aura/bedrockProxyController');

const request = require('supertest');
const express = require('express');
const { bedrockProxyAuth } = require('../../middleware/aura/bedrockProxyAuth');
const { createUserRateLimiter, createIpRateLimiter } = require('../../middleware/aura/rateLimiter');
const { handleMessages, handleCountTokens } = require('../../controllers/aura/bedrockProxyController');

function makeApp() {
  // Fresh require each call so route setup runs with current mocks
  jest.resetModules();
  jest.mock('../../middleware/aura/bedrockProxyAuth');
  jest.mock('../../middleware/aura/rateLimiter');
  jest.mock('../../controllers/aura/bedrockProxyController');

  const { bedrockProxyAuth: auth } = require('../../middleware/aura/bedrockProxyAuth');
  const { createUserRateLimiter: mkUser, createIpRateLimiter: mkIp } = require('../../middleware/aura/rateLimiter');
  const { handleMessages: hm, handleCountTokens: hct } = require('../../controllers/aura/bedrockProxyController');

  auth.mockImplementation((req, res, next) => next());
  const passThrough = jest.fn((req, res, next) => next());
  passThrough.resetKey = jest.fn();
  mkUser.mockReturnValue(passThrough);
  mkIp.mockReturnValue(passThrough);
  hm.mockImplementation((req, res) => res.status(200).json({ ok: true }));
  hct.mockImplementation((req, res) => res.status(200).json({ input_tokens: 7 }));

  const router = require('./bedrockProxy');
  const app = express();
  app.use(express.json());
  app.use('/bedrock', router);
  return app;
}

describe('bedrockProxy route', () => {
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
    const { createUserRateLimiter: mkUser, createIpRateLimiter: mkIp } = require('../../middleware/aura/rateLimiter');
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
