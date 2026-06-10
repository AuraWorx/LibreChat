'use strict';

// Returns token usage object so the controller can update the daily accumulator.
async function streamBedrockResponse(bedrockStream, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

  try {
    for await (const item of bedrockStream) {
      const bytes = item.chunk?.bytes;
      if (bytes) {
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
    }
  } catch (err) {
    const errorEvent = JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: 'Stream interrupted' },
    });
    res.write(`data: ${errorEvent}\n\n`);
  }

  res.end();
  return usage;
}

module.exports = { streamBedrockResponse };
