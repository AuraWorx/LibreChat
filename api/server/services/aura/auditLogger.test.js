'use strict';

const { keyCreated, keyDeleted } = require('./auditLogger');

describe('auditLogger', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const baseActor = { userId: 'u_abc', via: 'settings_ui' };
  const baseKey = { id: 'k_123', lastFour: 'x9zT', name: 'claude-code-laptop' };

  it('keyCreated emits structured JSON with event=key.created', () => {
    keyCreated({ actor: baseActor, key: baseKey, requestId: 'req_1' });
    const written = consoleSpy.mock.calls.map((c) => c[0]).join('');
    const log = JSON.parse(written);
    expect(log.event).toBe('key.created');
    expect(log.actor).toEqual(baseActor);
    expect(log.key).toEqual(baseKey);
    expect(log.requestId).toBe('req_1');
    expect(typeof log.ts).toBe('string');
  });

  it('keyDeleted emits structured JSON with event=key.deleted', () => {
    keyDeleted({ actor: baseActor, key: baseKey, requestId: 'req_2' });
    const written = consoleSpy.mock.calls.map((c) => c[0]).join('');
    const log = JSON.parse(written);
    expect(log.event).toBe('key.deleted');
  });

  it('never includes hash or raw token in output', () => {
    keyCreated({ actor: baseActor, key: { ...baseKey, hash: 'secret-hash', token: 'raw-token' }, requestId: 'req_3' });
    const written = consoleSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).not.toContain('secret-hash');
    expect(written).not.toContain('raw-token');
  });

  it('propagates requestId from context', () => {
    keyCreated({ actor: baseActor, key: baseKey, requestId: 'trace-xyz' });
    const written = consoleSpy.mock.calls.map((c) => c[0]).join('');
    const log = JSON.parse(written);
    expect(log.requestId).toBe('trace-xyz');
  });
});
