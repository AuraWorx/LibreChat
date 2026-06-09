'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const BedrockApiKey = require('../../../models/aura/BedrockApiKey');
const auditLogger = require('../../services/aura/auditLogger');

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
    auditLogger.keyRejected({
      reason: 'missing_token',
      lastFour: null,
      requestId: req.requestId ?? null,
    });
    return res.status(401).json({ error: 'unauthorized', message: 'Missing API key' });
  }
  try {
    const keyDoc = await validateBedrockKey(token);
    if (!keyDoc) {
      // Surface invalid/revoked-key attempts to the audit stream so brute-force
      // probing and graduated-user tools hammering dead keys are observable.
      // lastFour is derived from the presented token, not from any DB record.
      auditLogger.keyRejected({
        reason: 'invalid_or_revoked',
        lastFour: token.length >= 4 ? token.slice(-4) : null,
        requestId: req.requestId ?? null,
      });
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or revoked API key' });
    }
    req.bedrockKeyDoc = keyDoc;
    // Fire-and-forget, debounced lastUsedAt update. Never block the proxy call on
    // this write, and never let its failure reject the request.
    BedrockApiKey.touchLastUsed(keyDoc._id, keyDoc.lastUsedAt).catch(() => {});
    return next();
  } catch (err) {
    if (err.statusCode === 503) {
      res.set('Retry-After', String(err.retryAfter ?? 5));
      return res
        .status(503)
        .json({ error: 'service_unavailable', message: 'Starting up, retry in 5s' });
    }
    return res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = { extractToken, validateBedrockKey, bedrockProxyAuth };
