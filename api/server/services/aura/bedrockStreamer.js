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

// Stream an OpenAI-compatible Bedrock model response (Gemma, GLM, DeepSeek, Mistral)
// back to the client as Anthropic-format SSE, so Claude Code reads all models uniformly.
async function streamOpenAICompatResponse(bedrockStream, res, modelId) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  let headersSent = false;
  let contentStarted = false;

  const stopReasonMap = { stop: 'end_turn', length: 'max_tokens', max_tokens: 'max_tokens' };

  function writeEvent(event) {
    if (!headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      headersSent = true;
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  try {
    for await (const item of bedrockStream) {
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

      let chunk;
      try {
        chunk = JSON.parse(Buffer.from(bytes).toString('utf8'));
      } catch {
        continue;
      }

      // Meta Llama streaming: { generation: "...", stop_reason: "stop"|null, ... }
      if ('generation' in chunk) {
        if (!contentStarted) {
          writeEvent({
            type: 'message_start',
            message: {
              id: `msg_${modelId.slice(-6)}`,
              type: 'message',
              role: 'assistant',
              model: modelId,
              usage: { input_tokens: chunk.prompt_token_count ?? 0, output_tokens: 0 },
            },
          });
          writeEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
          contentStarted = true;
        }
        if (chunk.generation) {
          writeEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk.generation } });
        }
        if (chunk.stop_reason) {
          const metrics = chunk['amazon-bedrock-invocationMetrics'];
          usage.inputTokens = metrics?.inputTokenCount ?? chunk.prompt_token_count ?? 0;
          usage.outputTokens = metrics?.outputTokenCount ?? chunk.generation_token_count ?? 0;
          writeEvent({ type: 'content_block_stop', index: 0 });
          writeEvent({
            type: 'message_delta',
            delta: { stop_reason: stopReasonMap[chunk.stop_reason] ?? 'end_turn', stop_sequence: null },
            usage: { output_tokens: usage.outputTokens },
          });
          writeEvent({ type: 'message_stop' });
        }
        continue;
      }

      // Nova streaming: { messageStart/contentBlockDelta/contentBlockStop/messageStop/metadata }
      if ('messageStart' in chunk || 'contentBlockDelta' in chunk || 'contentBlockStop' in chunk || 'messageStop' in chunk || ('metadata' in chunk && 'usage' in chunk.metadata)) {
        if (chunk.messageStart && !contentStarted) {
          writeEvent({
            type: 'message_start',
            message: {
              id: `msg_nova_${modelId.slice(-6)}`,
              type: 'message',
              role: 'assistant',
              model: modelId,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          });
          writeEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
          contentStarted = true;
        }
        const deltaText = chunk.contentBlockDelta?.delta?.text;
        if (deltaText) {
          if (!contentStarted) {
            writeEvent({
              type: 'message_start',
              message: { id: `msg_nova_${modelId.slice(-6)}`, type: 'message', role: 'assistant', model: modelId, usage: { input_tokens: 0, output_tokens: 0 } },
            });
            writeEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
            contentStarted = true;
          }
          writeEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: deltaText } });
        }
        if (chunk.messageStop) {
          const stopReason = chunk.messageStop.stopReason;
          writeEvent({ type: 'content_block_stop', index: 0 });
          writeEvent({
            type: 'message_delta',
            delta: { stop_reason: stopReasonMap[stopReason] ?? 'end_turn', stop_sequence: null },
            usage: { output_tokens: usage.outputTokens },
          });
          writeEvent({ type: 'message_stop' });
        }
        if (chunk.metadata?.usage) {
          const metrics = chunk['amazon-bedrock-invocationMetrics'];
          usage.inputTokens = metrics?.inputTokenCount ?? chunk.metadata.usage.inputTokens ?? 0;
          usage.outputTokens = metrics?.outputTokenCount ?? chunk.metadata.usage.outputTokens ?? 0;
        }
        continue;
      }

      // OpenAI streaming: { choices: [{ delta: { content: "..." }, finish_reason: null }] }
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (!contentStarted) {
        // Emit synthetic Anthropic envelope events before the first content delta.
        writeEvent({
          type: 'message_start',
          message: {
            id: chunk.id || `msg_${modelId.slice(-6)}`,
            type: 'message',
            role: 'assistant',
            model: modelId,
            usage: { input_tokens: chunk.usage?.prompt_tokens ?? 0, output_tokens: 0 },
          },
        });
        writeEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        });
        contentStarted = true;
      }

      const deltaText = choice.delta?.content;
      if (deltaText) {
        writeEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: deltaText } });
      }

      // Final chunk: has finish_reason and optionally usage.
      const finishReason = choice.finish_reason || choice.stop_reason;
      if (finishReason) {
        if (chunk.usage) {
          usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
          usage.outputTokens = chunk.usage.completion_tokens ?? 0;
        }
        writeEvent({ type: 'content_block_stop', index: 0 });
        writeEvent({
          type: 'message_delta',
          delta: { stop_reason: stopReasonMap[finishReason] ?? 'end_turn', stop_sequence: null },
          usage: { output_tokens: usage.outputTokens },
        });
        writeEvent({ type: 'message_stop' });
      }
    }
  } catch (err) {
    if (!headersSent) {
      throw err;
    }
    res.write(
      `data: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Stream interrupted' } })}\n\n`,
    );
  }

  if (!headersSent) {
    const err = new Error('Bedrock returned empty stream');
    err.name = 'EmptyStreamError';
    throw err;
  }

  res.end();
  return usage;
}

module.exports = { streamBedrockResponse, streamOpenAICompatResponse };
