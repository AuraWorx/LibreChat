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
        <div className="border-t border-border-light px-4 py-3 font-mono text-xs text-text-secondary">
          <p>export ANTHROPIC_BASE_URL={baseUrl}</p>
          <p>export ANTHROPIC_AUTH_TOKEN=&lt;your-key&gt;</p>
        </div>
      )}
    </div>
  );
}
