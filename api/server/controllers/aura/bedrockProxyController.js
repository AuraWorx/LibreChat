'use strict';

const {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  CountTokensCommand,
} = require('@aws-sdk/client-bedrock-runtime');
const { translateRequestBody } = require('../../services/aura/bedrockTranslator');
const { streamBedrockResponse } = require('../../services/aura/bedrockStreamer');
const auditLogger = require('../../services/aura/auditLogger');
const BedrockDailyUsage = require('../../../models/aura/BedrockDailyUsage');

function getClient() {
  return new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
}

const ERROR_MAP = {
  ThrottlingException:       { status: 429, retryAfter: '10',  error: 'rate_limit_error',     message: 'Bedrock throttled the request' },
  ValidationException:       { status: 400,                    error: 'invalid_request_error', message: 'Invalid request parameters' },
  AccessDeniedException:     { status: 403,                    error: 'permission_error',      message: 'Access denied to Bedrock model' },
  ModelNotReadyException:    { status: 503, retryAfter: '15',  error: 'overloaded_error',      message: 'Model not ready, retry shortly' },
  ResourceNotFoundException: { status: 404,                    error: 'not_found_error',       message: 'Model not found' },
};

function mapError(err, res) {
  const mapped = ERROR_MAP[err.name] ?? { status: 500, error: 'api_error', message: 'Internal proxy error' };
  if (mapped.retryAfter) res.set('Retry-After', mapped.retryAfter);
  res.status(mapped.status).json({ error: mapped.error, message: mapped.message });
  return mapped.status;
}

function getEnvLimit(envVar) {
  const v = parseInt(process.env[envVar] || '0', 10);
  return v > 0 ? v : null;
}

function getEffectiveLimits(keyDoc) {
  const k = keyDoc?.limits ?? {};
  return {
    maxOutputTokensPerRequest: k.maxOutputTokensPerRequest ?? getEnvLimit('BEDROCK_MAX_OUTPUT_TOKENS_PER_REQUEST'),
    dailyInputTokens:          k.dailyInputTokens          ?? getEnvLimit('BEDROCK_DAILY_INPUT_TOKEN_LIMIT'),
    dailyOutputTokens:         k.dailyOutputTokens         ?? getEnvLimit('BEDROCK_DAILY_OUTPUT_TOKEN_LIMIT'),
    dailyCacheWriteTokens:     k.dailyCacheWriteTokens     ?? getEnvLimit('BEDROCK_DAILY_CACHE_WRITE_TOKEN_LIMIT'),
  };
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function checkDailyLimits(userId, limits) {
  if (!limits.dailyInputTokens && !limits.dailyOutputTokens && !limits.dailyCacheWriteTokens) {
    return null;
  }
  const usage = await BedrockDailyUsage.findOne({ userId, date: todayUTC() }).lean();
  if (!usage) return null;
  if (limits.dailyInputTokens && usage.inputTokens >= limits.dailyInputTokens) {
    return { limit_type: 'daily_input_tokens', limit: limits.dailyInputTokens, used: usage.inputTokens };
  }
  if (limits.dailyOutputTokens && usage.outputTokens >= limits.dailyOutputTokens) {
    return { limit_type: 'daily_output_tokens', limit: limits.dailyOutputTokens, used: usage.outputTokens };
  }
  if (limits.dailyCacheWriteTokens && usage.cacheWriteTokens >= limits.dailyCacheWriteTokens) {
    return { limit_type: 'daily_cache_write_tokens', limit: limits.dailyCacheWriteTokens, used: usage.cacheWriteTokens };
  }
  return null;
}

function incrementUsage(userId, counters) {
  BedrockDailyUsage.increment(userId, todayUTC(), counters).catch((err) =>
    console.error('[bedrock_usage_error]', err.message),
  );
}

function checkAllowedModels(requestedModel, keyDoc) {
  const keyAllowed = keyDoc?.allowedModels;
  const globalAllowed = process.env.BEDROCK_ALLOWED_MODELS
    ? process.env.BEDROCK_ALLOWED_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
    : null;
  const effective = keyAllowed?.length ? keyAllowed : globalAllowed;
  if (!effective || !effective.length) return null;
  const bare = requestedModel.replace(/^(anthropic\.|us\.|global\.|eu\.|ap\.)/, '');
  if (effective.some((m) => m === requestedModel || m.includes(bare) || requestedModel.includes(m.replace(/^(us\.|anthropic\.)/, '')))) {
    return null;
  }
  return { error: 'model_not_permitted', message: `Model ${requestedModel} is not permitted for this key` };
}

async function handleMessages(req, res) {
  const start = Date.now();
  const { body: anthropicBody, headers, bedrockKeyDoc } = req;
  const betaHeader = headers['anthropic-beta'];
  const isStreaming = anthropicBody.stream === true;
  const userId = bedrockKeyDoc?.userId;

  let statusCode = 200;
  let requestTokens = -1;
  let responseTokens = -1;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;

  try {
    // Model allowlist check
    const modelError = checkAllowedModels(anthropicBody.model, bedrockKeyDoc);
    if (modelError) {
      return res.status(403).json(modelError);
    }

    // Daily token limit pre-call check
    const limits = getEffectiveLimits(bedrockKeyDoc);
    const exceeded = await checkDailyLimits(userId, limits);
    if (exceeded) {
      return res.status(429).json({
        error: 'daily_token_limit_exceeded',
        message: 'Daily token budget exhausted. Resets at midnight UTC.',
        ...exceeded,
      });
    }

    const { modelId, body } = translateRequestBody(anthropicBody, betaHeader, {
      maxOutputTokensPerRequest: limits.maxOutputTokensPerRequest,
    });
    const bodyBytes = Buffer.from(JSON.stringify(body));

    if (isStreaming) {
      const command = new InvokeModelWithResponseStreamCommand({ modelId, body: bodyBytes, contentType: 'application/json', accept: 'application/json' });
      const response = await getClient().send(command);
      const usage = await streamBedrockResponse(response.body, res);
      requestTokens = usage.inputTokens || -1;
      responseTokens = usage.outputTokens || -1;
      cacheWriteTokens = usage.cacheWriteTokens;
      cacheReadTokens = usage.cacheReadTokens;
    } else {
      const command = new InvokeModelCommand({ modelId, body: bodyBytes, contentType: 'application/json', accept: 'application/json' });
      const response = await getClient().send(command);
      const parsed = JSON.parse(Buffer.from(response.body).toString('utf8'));
      requestTokens = parsed.usage?.input_tokens ?? -1;
      responseTokens = parsed.usage?.output_tokens ?? -1;
      cacheWriteTokens = parsed.usage?.cache_creation_input_tokens ?? 0;
      cacheReadTokens = parsed.usage?.cache_read_input_tokens ?? 0;
      res.status(200).json(parsed);
    }
  } catch (err) {
    console.error('[bedrock_proxy_error]', err.name, err.message);
    statusCode = mapError(err, res);
  } finally {
    auditLogger.proxyRequest({
      userId,
      keyId: bedrockKeyDoc?._id,
      model: anthropicBody.model,
      requestTokens,
      responseTokens,
      cacheWriteTokens,
      cacheReadTokens,
      durationMs: Date.now() - start,
      statusCode,
    });
    // Fire-and-forget daily accumulator update on success only
    if (statusCode === 200 && userId) {
      incrementUsage(userId, {
        inputTokens: requestTokens > 0 ? requestTokens : 0,
        outputTokens: responseTokens > 0 ? responseTokens : 0,
        cacheWriteTokens,
        cacheReadTokens,
      });
    }
  }
}

async function handleCountTokens(req, res) {
  const { body: anthropicBody, headers, bedrockKeyDoc } = req;
  const betaHeader = headers['anthropic-beta'];
  const limits = getEffectiveLimits(bedrockKeyDoc);

  try {
    const { modelId, body } = translateRequestBody(anthropicBody, betaHeader, {
      maxOutputTokensPerRequest: limits.maxOutputTokensPerRequest,
    });
    delete body.stream;
    const bodyBytes = Buffer.from(JSON.stringify(body));
    const command = new CountTokensCommand({ modelId, body: bodyBytes, contentType: 'application/json' });
    const response = await getClient().send(command);
    res.status(200).json({ input_tokens: response.inputTokenCount });
  } catch (err) {
    mapError(err, res);
  }
}

module.exports = { handleMessages, handleCountTokens };
