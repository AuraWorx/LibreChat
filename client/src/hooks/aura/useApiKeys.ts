import { useState, useEffect, useCallback } from 'react';

export interface ApiKey {
  _id: string;
  name: string;
  lastFour: string;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
}

export interface CreateKeyResult {
  token?: string;
  error?: string;
  _id?: string;
  name?: string;
  lastFour?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
}

export function useApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bedrock-keys', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys ?? []);
      } else {
        setError('Failed to load keys');
      }
    } catch {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const createKey = useCallback(async (name: string): Promise<CreateKeyResult> => {
    try {
      const res = await fetch('/api/bedrock-keys', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.status === 409) {
        return { error: 'duplicate_name' };
      }
      if (!res.ok) {
        return { error: 'create_failed' };
      }
      const data = await res.json();
      const { token: _token, ...keyWithoutToken } = data;
      setKeys((prev) => [...prev, keyWithoutToken as ApiKey]);
      return data;
    } catch {
      return { error: 'network_error' };
    }
  }, []);

  const deleteKey = useCallback(async (id: string): Promise<void> => {
    const snapshot = keys; // synchronous capture before the async boundary
    setKeys((prev) => prev.filter((k) => k._id !== id));
    try {
      const res = await fetch(`/api/bedrock-keys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        setKeys(snapshot);
      }
    } catch {
      setKeys(snapshot);
    }
  }, [keys]);

  return { keys, isLoading, error, fetchKeys, createKey, deleteKey };
}
