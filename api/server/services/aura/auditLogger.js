'use strict';

// v1: logs lifecycle events to stdout (ECS log group, 30d retention).
// Step 5 swaps this to CloudWatch SDK once the dedicated audit log group + IAM land.

const REDACTED_FIELDS = new Set(['hash', 'token']);

function sanitizeKey(key) {
  const out = {};
  for (const [k, v] of Object.entries(key)) {
    if (!REDACTED_FIELDS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

function emit(event, { actor, key, requestId }) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    actor,
    key: sanitizeKey(key),
    requestId: requestId ?? null,
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

function keyCreated({ actor, key, requestId }) {
  emit('key.created', { actor, key, requestId });
}

function keyDeleted({ actor, key, requestId }) {
  emit('key.deleted', { actor, key, requestId });
}

function keyRejected({ reason, lastFour, requestId }) {
  emit('key.rejected', { actor: null, key: { lastFour }, requestId, reason });
}

function proxyRequest({
  userId,
  keyId,
  model,
  requestTokens,
  responseTokens,
  cacheWriteTokens,
  cacheReadTokens,
  durationMs,
  statusCode,
}) {
  const entry = {
    ts: new Date().toISOString(),
    event: 'bedrock_proxy_request',
    userId,
    keyId,
    model,
    requestTokens: requestTokens ?? -1,
    responseTokens: responseTokens ?? -1,
    cacheWriteTokens: cacheWriteTokens ?? 0,
    cacheReadTokens: cacheReadTokens ?? 0,
    durationMs,
    statusCode,
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

module.exports = { keyCreated, keyDeleted, keyRejected, proxyRequest };
