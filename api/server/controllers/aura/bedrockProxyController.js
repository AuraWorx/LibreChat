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

// Client created per-call so tests can override BedrockRuntimeClient.mockImplementation per test.
// The SDK credential provider caches internally, so there is no per-call auth overhead.
function getClient() {
  return new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
}

const ERROR_MAP = {
  ThrottlingException:       { status: 429, retryAfter: '10',  error: 'rate_limit_error',  message: 'Bedrock throttled the request' },
  ValidationException:       { status: 400,                    error: 'invalid_request_error', message: 'Invalid request parameters' },
  AccessDeniedException:     { status: 403,                    error: 'permission_error',   message: 'Access denied to Bedrock model' },
  ModelNotReadyException:    { status: 503, retryAfter: '15',  error: 'overloaded_error',   message: 'Model not ready, retry shortly' },
  ResourceNotFoundException: { status: 404,                    error: 'not_found_error',    message: 'Model not found' },
};

function mapError(err, res) {
  const mapped = ERROR_MAP[err.name] ?? { status: 500, error: 'api_error', message: 'Internal proxy error' };
  if (mapped.retryAfter) res.set('Retry-After', mapped.retryAfter);
  res.status(mapped.status).json({ error: mapped.error, message: mapped.message });
  return mapped.status;
}

async function handleMessages(req, res) {
  const start = Date.now();
  const { body: anthropicBody, headers, bedrockKeyDoc } = req;
  const betaHeader = headers['anthropic-beta'];
  const isStreaming = anthropicBody.stream === true;

  let statusCode = 200;
  let requestTokens = -1;
  let responseTokens = -1;

  try {
    const { modelId, body } = translateRequestBody(anthropicBody, betaHeader);
    const bodyBytes = Buffer.from(JSON.stringify(body));

    if (isStreaming) {
      const command = new InvokeModelWithResponseStreamCommand({ modelId, body: bodyBytes, contentType: 'application/json', accept: 'application/json' });
      const response = await getClient().send(command);
      await streamBedrockResponse(response.body, res);
    } else {
      const command = new InvokeModelCommand({ modelId, body: bodyBytes, contentType: 'application/json', accept: 'application/json' });
      const response = await getClient().send(command);
      const parsed = JSON.parse(Buffer.from(response.body).toString('utf8'));
      requestTokens = parsed.usage?.input_tokens ?? -1;
      responseTokens = parsed.usage?.output_tokens ?? -1;
      res.status(200).json(parsed);
    }
  } catch (err) {
    console.error('[bedrock_proxy_error]', err.name, err.message);
    statusCode = mapError(err, res);
  } finally {
    auditLogger.proxyRequest({
      userId: bedrockKeyDoc?.userId,
      keyId: bedrockKeyDoc?._id,
      model: anthropicBody.model,
      requestTokens,
      responseTokens,
      durationMs: Date.now() - start,
      statusCode,
    });
  }
}

async function handleCountTokens(req, res) {
  const { body: anthropicBody, headers, bedrockKeyDoc } = req;
  const betaHeader = headers['anthropic-beta'];

  const bodyWithoutStream = { ...anthropicBody };
  delete bodyWithoutStream.stream;

  try {
    const { modelId, body } = translateRequestBody(bodyWithoutStream, betaHeader);
    const bodyBytes = Buffer.from(JSON.stringify(body));
    const command = new CountTokensCommand({ modelId, body: bodyBytes, contentType: 'application/json' });
    const response = await getClient().send(command);
    res.status(200).json({ input_tokens: response.inputTokenCount });
  } catch (err) {
    mapError(err, res);
  }
}

module.exports = { handleMessages, handleCountTokens };
