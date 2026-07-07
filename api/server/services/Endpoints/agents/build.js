const { logger } = require('@librechat/data-schemas');
const { loadAgent: loadAgentFn } = require('@librechat/api');
const { isAgentsEndpoint, removeNullishValues, Constants } = require('librechat-data-provider');
const generateArtifactsPrompt = require('~/app/clients/prompts/artifacts');
const { getMCPServerTools } = require('~/server/services/Config');
const db = require('~/models');

const loadAgent = (params) => loadAgentFn(params, { getAgent: db.getAgent, getMCPServerTools });

const buildOptions = (req, endpoint, parsedBody, endpointType) => {
  const { spec, iconURL, agent_id, chatProjectId, artifacts, ...model_parameters } = parsedBody;

  // For non-agents endpoints (Bedrock, custom, etc.) using ephemeral agents, inject the
  // artifact system prompt into promptPrefix so models know to produce :::artifact{} blocks.
  // Assistants cover this in assistants/build.js; named agents use their configured
  // instructions; this closes the gap for Bedrock and other ephemeral-agent endpoints.
  if (typeof artifacts === 'string' && !isAgentsEndpoint(endpoint)) {
    const artifactPrompt = generateArtifactsPrompt({ endpoint, artifacts });
    if (typeof artifactPrompt === 'string' && artifactPrompt) {
      const existingPrefix = typeof model_parameters.promptPrefix === 'string'
        ? model_parameters.promptPrefix
        : '';
      model_parameters.promptPrefix = existingPrefix
        ? `${existingPrefix}\n\n${artifactPrompt}`
        : artifactPrompt;
    }
  }
  const agentPromise = loadAgent({
    req,
    spec,
    agent_id: isAgentsEndpoint(endpoint) ? agent_id : Constants.EPHEMERAL_AGENT_ID,
    endpoint,
    model_parameters,
  }).catch((error) => {
    logger.error(`[/agents/:${agent_id}] Error retrieving agent during build options step`, error);
    return undefined;
  });

  /** @type {import('librechat-data-provider').TConversation | undefined} */
  const addedConvo = req.body?.addedConvo;

  return removeNullishValues({
    spec,
    iconURL,
    endpoint,
    agent_id,
    endpointType,
    chatProjectId,
    model_parameters,
    agent: agentPromise,
    addedConvo,
  });
};

module.exports = { buildOptions };
