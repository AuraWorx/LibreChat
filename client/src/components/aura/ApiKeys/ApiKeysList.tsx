import React from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@librechat/client';
import { cn } from '~/utils';
import type { ApiKey } from '~/hooks/aura/useApiKeys';

interface ApiKeysListProps {
  keys: ApiKey[];
  onDeleteClick: (key: ApiKey) => void;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
}

export default function ApiKeysList({ keys, onDeleteClick }: ApiKeysListProps) {
  if (keys.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No API keys yet. Generate one to use Claude models from external tools like Claude Code.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {keys.map((key) => (
        <li
          key={key.id}
          className={cn(
            'flex items-start justify-between rounded-lg border border-border-light bg-surface-secondary p-3',
          )}
        >
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-text-primary">{key.name}</span>
            <span className="text-xs text-text-secondary">Ends in …{key.lastFour}</span>
            <span className="text-xs text-text-secondary">
              Created {formatDate(key.createdAt)}
              {' · '}
              {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never used'}
            </span>
          </div>
          <Button
            aria-label={`Delete ${key.name}`}
            onClick={() => onDeleteClick(key)}
            className="ml-2 flex-shrink-0 text-text-secondary hover:text-text-primary"
          >
            <Trash2 size={16} />
          </Button>
        </li>
      ))}
    </ul>
  );
}
