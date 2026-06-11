'use strict';

// Returns token usage object so the controller can update the daily accumulator.
async function streamBedrockResponse(bedrockStream, res) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  // SSE headers are set lazily on the first real chunk so that stream-level
  // errors arriving before any data can still be returned as proper HTTP errors
  // (once res.write() is called the status line is flushed and can't change).
  let headersSent = false;

  try {
    for await (const item of bedrockStream) {
      // Bedrock embeds stream-level errors as typed union members on the item
      // rather than throwing exceptions — check for them explicitly so they
      // aren't silently dropped (previously caused empty-200 SSE responses).
      const streamErr =
        item.internalServerException ||
        item.modelStreamErrorException ||
        item.modelTimeoutException ||
        item.throttlingException;
      if (streamErr) {
        const err = new Error(streamErr.message || 'Bedrock stream error');
        err.name = streamErr.name || 'ModelStreamErrorException';
        throw err;
      }

      const bytes = item.chunk?.bytes;
      if (!bytes) continue;

      if (!headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        headersSent = true;
      }

      const text = Buffer.from(bytes).toString('utf8');
      res.write(`data: ${text}\n\n`);

      try {
        const event = JSON.parse(text);
        if (event.type === 'message_start' && event.message?.usage) {
          const u = event.message.usage;
          usage.inputTokens = u.input_tokens ?? 0;
          usage.cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
          usage.cacheReadTokens = u.cache_read_input_tokens ?? 0;
        } else if (event.type === 'message_delta' && event.usage) {
          usage.outputTokens = event.usage.output_tokens ?? 0;
        }
      } catch {
        /* non-JSON chunk — skip */
      }
    }
  } catch (err) {
    if (!headersSent) {
      // No data written yet — propagate so the controller can send a proper HTTP error response
      throw err;
    }
    // Headers already flushed — can't change status; write an SSE error event instead
    const errorEvent = JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: 'Stream interrupted' },
    });
    res.write(`data: ${errorEvent}\n\n`);
  }

  if (!headersSent) {
    // Stream ended cleanly but delivered no data — treat as an error
    const err = new Error('Bedrock returned empty stream');
    err.name = 'EmptyStreamError';
    throw err;
  }

  res.end();
  return usage;
}

module.exports = { streamBedrockResponse };
