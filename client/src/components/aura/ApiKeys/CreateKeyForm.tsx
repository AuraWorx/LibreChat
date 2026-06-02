import React, { useState } from 'react';
import { Button, Input } from '@librechat/client';
import { cn } from '~/utils';
import type { CreateKeyResult } from '~/hooks/aura/useApiKeys';

interface CreateKeyFormProps {
  createKey: (name: string) => Promise<CreateKeyResult>;
  onKeyCreated: (token: string, keyName: string) => void;
}

export default function CreateKeyForm({ createKey, onKeyCreated }: CreateKeyFormProps) {
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (trimmed.length > 100) {
      setError('Name must be 100 characters or fewer.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await createKey(trimmed);
      if (result.error === 'duplicate_name') {
        setError('A key with that name is already in use.');
        return;
      }
      if (result.error) {
        setError('Failed to create key. Please try again.');
        return;
      }
      if (result.token) {
        setName('');
        onKeyCreated(result.token, trimmed);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn('flex flex-col gap-2')}>
      <div className="flex gap-2">
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. claude-code-laptop)"
          maxLength={101}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={!trimmed || isLoading}
        >
          {isLoading ? 'Generating…' : 'Generate Key'}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
