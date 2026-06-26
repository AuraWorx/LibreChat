/* eslint-disable i18next/no-literal-string */
import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, RefreshCw } from 'lucide-react';
import { cn } from '~/utils';

interface BedrockModel {
  id: string;
  name: string;
  provider: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  Anthropic: 'Anthropic',
  Amazon: 'Amazon Nova',
  Meta: 'Meta Llama',
  Google: 'Google',
  Mistral: 'Mistral',
  Deepseek: 'DeepSeek',
  Cohere: 'Cohere',
  Ai21: 'AI21 Labs',
  Writer: 'Writer',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-1.5 inline-flex flex-shrink-0 items-center rounded p-0.5 text-text-tertiary hover:text-text-secondary transition-colors"
    >
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  );
}

export default function SetupInstructions() {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<BedrockModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const baseUrl = `https://${window.location.hostname}/bedrock`;

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const res = await fetch('/bedrock/models.json');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setModels(data.models || []);
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (open && models.length === 0) {
      fetchModels();
    }
  }, [open]);

  const groups = models.reduce<Record<string, BedrockModel[]>>((acc, m) => {
    const key = m.provider;
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  const providerOrder = Object.keys(groups).sort((a, b) => {
    if (a === 'Anthropic') return -1;
    if (b === 'Anthropic') return 1;
    return a.localeCompare(b);
  });

  return (
    <div className={cn('rounded-lg border border-border-light')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-text-primary"
      >
        Setup instructions
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="border-t border-border-light px-4 py-3 space-y-4 text-xs text-text-secondary">

          {/* Environment variables */}
          <div className="space-y-1">
            <p className="font-medium text-text-primary">Environment</p>
            <div className="font-mono space-y-0.5">
              <p>export ANTHROPIC_BASE_URL={baseUrl}</p>
              <p>export ANTHROPIC_API_KEY=&lt;your-key&gt;</p>
            </div>
          </div>

          {/* Claude Code */}
          <div className="space-y-1">
            <p className="font-medium text-text-primary">Claude Code</p>
            <p className="font-mono">claude --model us.anthropic.claude-sonnet-4-6</p>
          </div>

          {/* SDK / direct API */}
          <div className="space-y-1">
            <p className="font-medium text-text-primary">SDK / direct API</p>
            <div className="font-mono space-y-0.5">
              <p>{'# Python'}</p>
              <p>{'client = Anthropic()  # picks up env vars'}</p>
              <p>{'# TypeScript'}</p>
              <p>{'const client = new Anthropic();'}</p>
            </div>
          </div>

          {/* Full setup guide link */}
          <div>
            <a
              href="/setup"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-500 hover:text-blue-400 transition-colors"
            >
              Full setup guide (macOS, Windows, VS Code, JetBrains) →
            </a>
          </div>

          {/* Models table */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-medium text-text-primary">Models supported for Claude Code</p>
              <button
                type="button"
                onClick={fetchModels}
                disabled={loadingModels}
                className="inline-flex items-center gap-1 rounded border border-border-light px-2 py-0.5 text-text-tertiary hover:text-text-secondary disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={10} className={loadingModels ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            {loadingModels && (
              <p className="py-3 text-center text-text-tertiary">Loading…</p>
            )}

            {!loadingModels && models.length > 0 && (
              <div className="overflow-auto rounded border border-border-light">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border-light bg-surface-secondary">
                      <th className="py-1.5 pl-3 pr-2 text-left font-semibold text-text-secondary w-28">Provider</th>
                      <th className="py-1.5 px-2 text-left font-semibold text-text-secondary w-40">Model</th>
                      <th className="py-1.5 pl-2 pr-3 text-left font-semibold text-text-secondary">Bedrock model ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providerOrder.map((providerKey) =>
                      groups[providerKey].map((model, mi) => (
                        <tr key={model.id} className="border-b border-border-light last:border-0">
                          <td className="py-1.5 pl-3 pr-2 text-text-secondary">
                            {mi === 0 ? (PROVIDER_LABELS[providerKey] ?? providerKey) : ''}
                          </td>
                          <td className="py-1.5 px-2 text-text-secondary">{model.name}</td>
                          <td className="py-1.5 pl-2 pr-3">
                            <span className="flex items-center font-mono text-text-primary">
                              <span className="select-all">{model.id}</span>
                              <CopyButton text={model.id} />
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {!loadingModels && models.length === 0 && (
              <p className="py-3 text-center text-text-tertiary">No models available.</p>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
