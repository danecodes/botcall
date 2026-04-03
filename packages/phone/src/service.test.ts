import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@botcall/db', () => {
  const mockDb: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'msg-1' }]),
  };
  // transaction passes mockDb itself as tx so assertions on db.insert etc still work
  mockDb.transaction = vi.fn((cb: (tx: any) => any) => cb(mockDb));
  return {
    getDb: vi.fn(() => mockDb),
    phoneNumbers: {},
    smsMessages: {},
    usageRecords: {},
    eq: vi.fn(),
    and: vi.fn(),
    desc: vi.fn(),
    gte: vi.fn(),
  };
});

vi.mock('@botcall/sms-providers', () => ({
  createSmsProviderFromEnv: vi.fn(() => ({
    name: 'telnyx',
  })),
}));

import type { InboundMessage } from '@botcall/sms-providers';
import { extractCode, handleIncomingSms } from './service.js';
import { getDb } from '@botcall/db';

describe('extractCode', () => {
  it('extracts 6-digit code', () => {
    expect(extractCode('Your verification code is 847291')).toBe('847291');
  });

  it('extracts 4-digit code', () => {
    expect(extractCode('Your PIN is 3842')).toBe('3842');
  });

  it('handles "code: XXXXXX" prefix', () => {
    expect(extractCode('code: 123456')).toBe('123456');
  });

  it('handles "is XXXXXX" pattern', () => {
    expect(extractCode('Your code is 990012')).toBe('990012');
  });

  it('prefers labelled code over incidental number — Order #847291 your PIN: 8472', () => {
    // "PIN: 8472" should match before the bare 6-digit order number
    expect(extractCode('Order #847291 your PIN: 8472')).toBe('8472');
  });

  it('returns null when no code present', () => {
    expect(extractCode('Hello, welcome to our service!')).toBeNull();
  });

  // Known gap: some email clients split digits across elements e.g. <b>8</b><b>4</b>...
  // Simple regex works for plain-text SMS but not for rendered HTML email bodies.
  // Will be addressed when the email feature ships.
  it.todo('extracts codes from HTML email bodies with split digit elements');
});

describe('handleIncomingSms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores message with correct from/to', async () => {
    const db = getDb() as any;
    // Number lookup returns a match
    db.limit.mockResolvedValueOnce([{
      id: 'num-1',
      userId: 'user-1',
      number: '+12065551234',
    }]);

    const message: InboundMessage = {
      messageSid: 'evt-abc',
      from: '+15551234567',
      to: '+12065551234',
      body: 'Your code is 847291',
      numMedia: 0,
      mediaUrls: [],
    };

    await handleIncomingSms(message);

    expect(db.insert).toHaveBeenCalled();
    const insertArgs = db.values.mock.calls[0][0];
    expect(insertArgs.from).toBe('+15551234567');
    expect(insertArgs.to).toBe('+12065551234');
    expect(insertArgs.body).toBe('Your code is 847291');
  });
});
