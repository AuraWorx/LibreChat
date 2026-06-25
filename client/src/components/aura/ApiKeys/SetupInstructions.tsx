/* eslint-disable i18next/no-literal-string */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '~/utils';

export default function SetupInstructions() {
  const [open, setOpen] = useState(false);
  const baseUrl = `https://${window.location.hostname}/bedrock`;

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

        </div>
      )}
    </div>
  );
}
