import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create a deeply chainable mock DB
function createChainMock() {
  const results: { returnValue: any }[] = [];
  let callIndex = 0;

  const chain: any = {};
  const methods = ['select', 'from', 'innerJoin', 'insert', 'values', 'update', 'set', 'delete'];

  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }

  // Terminal methods that return promises
  chain.where = vi.fn().mockImplementation(() => {
    const r = results[callIndex++];
    const result = r ? r.returnValue : [];
    // Return a promise-like that also has .limit() and .returning()
    const terminal = Promise.resolve(result);
    (terminal as any).limit = vi.fn().mockResolvedValue(result);
    (terminal as any).returning = vi.fn().mockResolvedValue(result);
    return terminal;
  });

  chain.returning = vi.fn().mockImplementation(() => {
    const r = results[callIndex++];
    return Promise.resolve(r ? r.returnValue : []);
  });

  chain.limit = vi.fn().mockImplementation(() => {
    const r = results[callIndex++];
    return Promise.resolve(r ? r.returnValue : []);
  });

  chain._pushResult = (value: any) => {
    results.push({ returnValue: value });
  };

  chain._reset = () => {
    callIndex = 0;
    results.length = 0;
    for (const m of methods) {
      chain[m].mockClear();
    }
    chain.where.mockClear();
    chain.returning.mockClear();
    chain.limit.mockClear();
  };

  return chain;
}

const mockDb = createChainMock();

vi.mock('@botcall/db', () => ({
  getDb: vi.fn(() => mockDb),
  apiKeys: {
    userId: 'user_id', keyHash: 'key_hash', keyPrefix: 'key_prefix',
    name: 'name', lastUsedAt: 'last_used_at', createdAt: 'created_at', id: 'id',
  },
  users: { id: 'id' },
  eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: any[]) => ({ op: 'and', args })),
}));

import { createApiKey, validateApiKey, revokeApiKey } from './auth.js';

describe('createApiKey', () => {
  beforeEach(() => {
    mockDb._reset();
  });

  it('generates a key with bs_live_ prefix', async () => {
    mockDb._pushResult([{
      id: 'key-1', keyPrefix: 'bs_live_xxxx', name: 'Default', createdAt: new Date(),
    }]);

    const result = await createApiKey('user-1');

    expect(result.key).toMatch(/^bs_live_/);
    expect(result.key.length).toBeGreaterThan(12);
    expect(result.id).toBe('key-1');
  });

  it('stores a SHA-256 hash, not the raw key', async () => {
    mockDb._pushResult([{
      id: 'key-1', keyPrefix: 'bs_live_xxxx', name: 'Default', createdAt: new Date(),
    }]);

    await createApiKey('user-1');

    const insertedValues = mockDb.values.mock.calls[0][0];
    expect(insertedValues.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(insertedValues.keyHash).not.toContain('bs_live_');
  });
});

describe('validateApiKey', () => {
  beforeEach(() => {
    mockDb._reset();
  });

  it('returns null for non bs_live_ prefix', async () => {
    const result = await validateApiKey('invalid_key_123');
    expect(result).toBeNull();
  });

  it('returns null for unknown key', async () => {
    mockDb._pushResult([]); // where+limit returns empty

    const result = await validateApiKey('bs_live_nonexistent_key_123456');
    expect(result).toBeNull();
  });

  it('returns user for valid key', async () => {
    const mockUser = { id: 'user-1', email: 'test@test.com', name: 'Test' };
    mockDb._pushResult([{ users: mockUser }]); // where+limit finds key

    const result = await validateApiKey('bs_live_valid_key_123456789012');
    expect(result).toEqual(mockUser);
  });
});

describe('revokeApiKey', () => {
  beforeEach(() => {
    mockDb._reset();
  });

  it('returns true when key exists', async () => {
    mockDb._pushResult([{ id: 'key-1' }]); // delete returning

    const result = await revokeApiKey('key-1', 'user-1');
    expect(result).toBe(true);
  });

  it('returns false when key not found', async () => {
    mockDb._pushResult([]); // delete returning empty

    const result = await revokeApiKey('nonexistent', 'user-1');
    expect(result).toBe(false);
  });
});
