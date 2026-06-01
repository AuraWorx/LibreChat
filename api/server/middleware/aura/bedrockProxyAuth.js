'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const BedrockApiKey = require('../../../models/aura/BedrockApiKey');

function extractToken(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return apiKey;
  }
  return null;
}

async function validateBedrockKey(rawToken) {
  if (mongoose.connection.readyState !== 1) {
    const err = new Error('Database not ready');
    err.statusCode = 503;
    err.retryAfter = 5;
    throw err;
  }
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return BedrockApiKey.findByHash(hash);
}

async function bedrockProxyAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing API key' });
  }
  try {
    const keyDoc = await validateBedrockKey(token);
    if (!keyDoc) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or revoked API key' });
    }
    req.bedrockKeyDoc = keyDoc;
    return next();
  } catch (err) {
    if (err.statusCode === 503) {
      res.set('Retry-After', String(err.retryAfter ?? 5));
      return res.status(503).json({ error: 'service_unavailable', message: 'Starting up, retry in 5s' });
    }
    return res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = { extractToken, validateBedrockKey, bedrockProxyAuth };
