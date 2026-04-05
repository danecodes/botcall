import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Stripe
const mockStripe = {
  customers: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
  webhooks: { constructEvent: vi.fn() },
  subscriptions: { retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
  billingPortal: { sessions: { create: vi.fn() } },
};

vi.mock('stripe', () => {
  // Must be a real class/function that works with `new`
  function StripeMock() { return mockStripe; }
  return { default: StripeMock };
});

// Mock DB
const mockSelectResult: any[] = [];
const mockDb: any = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockImplementation(() => Promise.resolve(mockSelectResult)),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};

vi.mock('@botcall/db', () => ({
  getDb: vi.fn(() => mockDb),
  subscriptions: { userId: 'user_id', stripeCustomerId: 'stripe_customer_id', plan: 'plan', status: 'status' },
  usageRecords: { userId: 'user_id', action: 'action', createdAt: 'created_at' },
  users: { id: 'id' },
  phoneNumbers: { userId: 'user_id', status: 'status', provider: 'provider' },
  eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: any[]) => ({ op: 'and', args })),
  gte: vi.fn((a, b) => ({ op: 'gte', a, b })),
  sql: vi.fn((strings: any, ...values: any[]) => strings),
}));

import {
  PLAN_LIMITS,
  getPlans,
  getUserPlanAndUsage,
  checkUsageLimit,
  cancelSubscription,
} from './billing.js';

describe('PLAN_LIMITS', () => {
  it('has correct limits for each tier', () => {
    expect(PLAN_LIMITS.inactive).toEqual({ phoneNumbers: 0, smsPerMonth: 0 });
    expect(PLAN_LIMITS.starter).toEqual({ phoneNumbers: 1, smsPerMonth: 100 });
    expect(PLAN_LIMITS.pro).toEqual({ phoneNumbers: 5, smsPerMonth: 500 });
  });
});

describe('getPlans', () => {
  it('returns starter and pro plans', () => {
    const plans = getPlans();
    expect(plans.starter.price).toBe(900);
    expect(plans.pro.price).toBe(2900);
    expect(plans.starter.limits).toEqual(PLAN_LIMITS.starter);
    expect(plans.pro.limits).toEqual(PLAN_LIMITS.pro);
  });
});

describe('getUserPlanAndUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.SMS_PROVIDER = 'telnyx';
  });

  it('returns inactive plan when no subscription exists', async () => {
    // First call: subscription lookup → empty
    mockDb.where.mockResolvedValueOnce([]);
    // Second call: phone count → 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    // Third call: SMS count → 0
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await getUserPlanAndUsage('user-1');

    expect(result.plan).toBe('inactive');
    expect(result.limits).toEqual(PLAN_LIMITS.inactive);
    expect(result.canProvision).toBe(false);
    expect(result.canReceiveSms).toBe(false);
  });

  it('normalizes legacy free plan to inactive', async () => {
    mockDb.where.mockResolvedValueOnce([{ plan: 'free', status: 'active' }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await getUserPlanAndUsage('user-1');

    expect(result.plan).toBe('inactive');
  });

  it('returns correct usage for starter plan', async () => {
    mockDb.where.mockResolvedValueOnce([{ plan: 'starter', status: 'active' }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    mockDb.where.mockResolvedValueOnce([{ count: 50 }]);

    const result = await getUserPlanAndUsage('user-1');

    expect(result.plan).toBe('starter');
    expect(result.usage.smsThisMonth).toBe(50);
    expect(result.canReceiveSms).toBe(true);
    expect(result.canProvision).toBe(true);
  });

  it('blocks SMS when at limit', async () => {
    mockDb.where.mockResolvedValueOnce([{ plan: 'starter', status: 'active' }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    mockDb.where.mockResolvedValueOnce([{ count: 100 }]);

    const result = await getUserPlanAndUsage('user-1');

    expect(result.canReceiveSms).toBe(false);
  });

  it('blocks provisioning when at phone limit', async () => {
    mockDb.where.mockResolvedValueOnce([{ plan: 'starter', status: 'active' }]);
    mockDb.where.mockResolvedValueOnce([{ count: 1 }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await getUserPlanAndUsage('user-1');

    expect(result.canProvision).toBe(false);
  });
});

describe('checkUsageLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.SMS_PROVIDER = 'telnyx';
  });

  it('blocks inactive plan', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await checkUsageLimit('user-1', 'provision');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No active subscription');
  });

  it('blocks past_due subscription', async () => {
    mockDb.where.mockResolvedValueOnce([{ plan: 'starter', status: 'past_due' }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await checkUsageLimit('user-1', 'receive_sms');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not active');
  });

  it('allows within limits', async () => {
    mockDb.where.mockResolvedValueOnce([{ plan: 'starter', status: 'active' }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    mockDb.where.mockResolvedValueOnce([{ count: 10 }]);

    const result = await checkUsageLimit('user-1', 'receive_sms');

    expect(result.allowed).toBe(true);
  });

  it('blocks send_sms when at limit', async () => {
    mockDb.where.mockResolvedValueOnce([{ plan: 'starter', status: 'active' }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);
    mockDb.where.mockResolvedValueOnce([{ count: 100 }]);

    const result = await checkUsageLimit('user-1', 'send_sms');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Monthly SMS limit');
  });

  it('blocks provision when at phone number limit', async () => {
    mockDb.where.mockResolvedValueOnce([{ plan: 'starter', status: 'active' }]);
    mockDb.where.mockResolvedValueOnce([{ count: 1 }]);
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    const result = await checkUsageLimit('user-1', 'provision');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Phone number limit');
  });
});

describe('cancelSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  });

  it('calls stripe.subscriptions.cancel', async () => {
    mockStripe.subscriptions.cancel.mockResolvedValueOnce({});

    await cancelSubscription('sub_123');

    expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_123');
  });
});
