'use strict';

async function streamBedrockResponse(bedrockStream, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const item of bedrockStream) {
      const bytes = item.chunk?.bytes;
      if (bytes) {
        res.write(`data: ${Buffer.from(bytes).toString('utf8')}\n\n`);
      }
    }
  } catch (err) {
    const errorEvent = JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Stream interrupted' } });
    res.write(`data: ${errorEvent}\n\n`);
  }

  res.end();
}

module.exports = { streamBedrockResponse };
