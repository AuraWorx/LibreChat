import { renderHook, act } from '@testing-library/react';
import { useApiKeys } from './useApiKeys';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ token: 'test-token' }),
}));

const MOCK_KEY = {
  id: 'key1',
  name: 'my-key',
  lastFour: 'x9zT',
  createdAt: '2026-05-28T00:00:00.000Z',
  lastUsedAt: null,
  active: true,
};

function mockFetch(status: number, body: unknown) {
  const mockFn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
  global.fetch = mockFn;
  return mockFn;
}

afterEach(() => {
  jest.restoreAllMocks();

  (global as any).fetch = undefined;
});

describe('useApiKeys — fetchKeys', () => {
  it('fetches GET /api/bedrock-keys and populates keys', async () => {
    mockFetch(200, { keys: [MOCK_KEY] });
    const { result } = renderHook(() => useApiKeys());
    await act(async () => {});
    expect(result.current.keys).toHaveLength(1);
    expect(result.current.keys[0].name).toBe('my-key');
  });

  it('sets isLoading true during fetch and false after', async () => {
    let resolveFetch!: (v: Response) => void;
    global.fetch = jest.fn().mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      }),
    );
    const { result } = renderHook(() => useApiKeys());
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ keys: [] }),
      } as Response);
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('sets error state on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useApiKeys());
    await act(async () => {});
    expect(result.current.error).toBeTruthy();
  });
});

describe('useApiKeys — createKey', () => {
  it('calls POST /api/bedrock-keys with the key name', async () => {
    mockFetch(200, { keys: [] }); // initial fetch
    const { result } = renderHook(() => useApiKeys());
    await act(async () => {});

    const postSpy = mockFetch(201, { ...MOCK_KEY, token: 'full-token-here' });
    await act(async () => {
      await result.current.createKey('my-key');
    });
    expect(postSpy).toHaveBeenCalledWith(
      '/api/bedrock-keys',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'my-key' }),
      }),
    );
  });

  it('returns the token string from the 201 response', async () => {
    mockFetch(200, { keys: [] });
    const { result } = renderHook(() => useApiKeys());
    await act(async () => {});

    mockFetch(201, { ...MOCK_KEY, token: 'the-secret-token' });
    let resolved: unknown;
    await act(async () => {
      resolved = await result.current.createKey('my-key');
    });
    expect((resolved as { token: string }).token).toBe('the-secret-token');
  });

  it('appends the new key (without token) to keys optimistically on 201', async () => {
    mockFetch(200, { keys: [] });
    const { result } = renderHook(() => useApiKeys());
    await act(async () => {});

    mockFetch(201, { ...MOCK_KEY, token: 'tok' });
    await act(async () => {
      await result.current.createKey('my-key');
    });
    expect(result.current.keys).toHaveLength(1);
    expect((result.current.keys[0] as Record<string, unknown>).token).toBeUndefined();
  });

  it('resolves with { error: "duplicate_name" } on 409 without throwing', async () => {
    mockFetch(200, { keys: [] });
    const { result } = renderHook(() => useApiKeys());
    await act(async () => {});

    mockFetch(409, { error: 'conflict' });
    let resolved: unknown;
    await act(async () => {
      resolved = await result.current.createKey('my-key');
    });
    expect((resolved as { error: string }).error).toBe('duplicate_name');
  });
});

describe('useApiKeys — deleteKey', () => {
  it('calls DELETE /api/bedrock-keys/:id', async () => {
    mockFetch(200, { keys: [MOCK_KEY] });
    const { result } = renderHook(() => useApiKeys());
    await act(async () => {});

    const deleteSpy = mockFetch(204, null);
    await act(async () => {
      await result.current.deleteKey('key1');
    });
    expect(deleteSpy).toHaveBeenCalledWith(
      '/api/bedrock-keys/key1',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });

  it('removes the key from local state on 204', async () => {
    mockFetch(200, { keys: [MOCK_KEY] });
    const { result } = renderHook(() => useApiKeys());
    await act(async () => {});

    mockFetch(204, null);
    await act(async () => {
      await result.current.deleteKey('key1');
    });
    expect(result.current.keys).toHaveLength(0);
  });

  it('reverts the optimistic removal when DELETE returns non-204', async () => {
    mockFetch(200, { keys: [MOCK_KEY] });
    const { result } = renderHook(() => useApiKeys());
    await act(async () => {});

    mockFetch(500, { error: 'server_error' });
    await act(async () => {
      await result.current.deleteKey('key1');
    });
    expect(result.current.keys).toHaveLength(1);
  });
});

// eslint-disable-next-line jest/no-export
export {};
