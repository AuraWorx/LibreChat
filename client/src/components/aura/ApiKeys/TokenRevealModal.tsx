/* eslint-disable i18next/no-literal-string */
import React, { useState, useEffect } from 'react';
import { Button } from '@librechat/client';
import { cn } from '~/utils';

interface TokenRevealModalProps {
  token: string;
  keyName: string;
  onClose: () => void;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function TokenRevealModal({ token, keyName, onClose }: TokenRevealModalProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);

  // Block Escape key from dismissing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  const handleCopy = async () => {
    const ok = await copyToClipboard(token);
    if (ok) {
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
    }
  };

  const baseUrl = `https://${window.location.hostname}/bedrock`;

  const handleCopyExport = async () => {
    const exportText = `export ANTHROPIC_BASE_URL=${baseUrl}\nexport ANTHROPIC_API_KEY=${token}`;
    const ok = await copyToClipboard(exportText);
    if (ok) {
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    }
  };

  return (
    <div className={cn('flex flex-col gap-4 p-4')} role="dialog" aria-modal="true">
      <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
        ⚠ Copy this token now. You will not be able to see it again.
      </div>
      <p className="font-medium text-text-primary">Name: {keyName}</p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={token}
          className="flex-1 rounded border border-border-light bg-surface-secondary px-3 py-2 font-mono text-sm text-text-primary"
        />
        <Button onClick={handleCopy} aria-label={copied ? 'Copied!' : 'Copy'}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      {copyFailed && (
        <p className="text-sm text-red-600">Copy failed — please copy the token manually.</p>
      )}
      <div className="rounded border border-border-light bg-surface-secondary p-3 font-mono text-xs text-text-secondary">
        <p className="select-all">export ANTHROPIC_BASE_URL={baseUrl}</p>
        <p className="select-all">export ANTHROPIC_API_KEY={token}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={handleCopyExport}
          aria-label={exportCopied ? 'Copied!' : 'Copy export commands'}
        >
          {exportCopied ? 'Copied!' : 'Copy export commands'}
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
