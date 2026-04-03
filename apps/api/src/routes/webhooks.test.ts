import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@botcall/phone', () => ({
  handleIncomingSms: vi.fn().mockResolvedValue({}),
  getSmsProvider: vi.fn(() => ({
    name: 'telnyx',
    parseInboundWebhook: vi.fn((body: any) => ({
      messageSid: body?.data?.id ?? '',
      from: body?.data?.payload?.from?.phone_number ?? '',
      to: body?.data?.payload?.to?.[0]?.phone_number ?? '',
      body: body?.data?.payload?.text ?? '',
      numMedia: 0,
      mediaUrls: [],
    })),
  })),
}));
vi.mock('@botcall/db', () => ({
  getDb: vi.fn(),
  users: {},
  phoneNumbers: {},
  eq: vi.fn(),
}));
vi.mock('@botcall/core', () => ({
  createUserFromClerk: vi.fn(),
  createApiKey: vi.fn(),
}));

import { webhookRoutes } from './webhooks.js';
import { handleIncomingSms } from '@botcall/phone';

const TELNYX_PAYLOAD = {
  data: {
    id: 'evt-abc',
    event_type: 'message.received',
    payload: {
      from: { phone_number: '+15551234567' },
      to: [{ phone_number: '+12065551234' }],
      text: 'Your code is 847291',
    },
  },
};

describe('POST /webhooks/telnyx/sms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TELNYX_PUBLIC_KEY;
    delete process.env.NODE_ENV;
  });

  it('calls handleIncomingSms with the raw JSON payload', async () => {
    const res = await webhookRoutes.request('/telnyx/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TELNYX_PAYLOAD),
    });

    expect(res.status).toBe(200);
    expect(handleIncomingSms).toHaveBeenCalledWith({
      messageSid: 'evt-abc',
      from: '+15551234567',
      to: '+12065551234',
      body: 'Your code is 847291',
      numMedia: 0,
      mediaUrls: [],
    });
  });

  it('returns 500 in production when TELNYX_PUBLIC_KEY is not set', async () => {
    process.env.NODE_ENV = 'production';

    const res = await webhookRoutes.request('/telnyx/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TELNYX_PAYLOAD),
    });

    expect(res.status).toBe(500);
    expect(handleIncomingSms).not.toHaveBeenCalled();
  });

  it('returns 200 and skips handleIncomingSms for non-message events', async () => {
    const payload = { data: { event_type: 'message.sent' } };

    const res = await webhookRoutes.request('/telnyx/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    expect(handleIncomingSms).not.toHaveBeenCalled();
  });
});
