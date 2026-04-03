/**
 * Botcall API client
 */

const DEFAULT_API_URL = 'https://api.botcall.io';

interface ApiConfig {
  apiKey: string;
  apiUrl?: string;
}

let config: ApiConfig | null = null;

export function setApiConfig(apiKey: string, apiUrl?: string) {
  config = { apiKey, apiUrl };
}

export function getApiConfig(): ApiConfig | null {
  return config;
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!config?.apiKey) {
    throw new Error('Not authenticated. Run: botcall auth login --api-key YOUR_KEY');
  }

  const url = `${config.apiUrl || DEFAULT_API_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json() as { success: boolean; error?: { message: string }; data?: T };

  if (!data.success) {
    throw new Error(data.error?.message || 'API request failed');
  }

  return data.data as T;
}

// ============ Phone Numbers ============

export interface PhoneNumber {
  id: string;
  number: string;
  capabilities: { sms: boolean; voice: boolean; mms: boolean };
  status: string;
  createdAt: string;
}

export async function listNumbers(): Promise<PhoneNumber[]> {
  return apiRequest<PhoneNumber[]>('/v1/phone/numbers');
}

export async function provisionNumber(options: {
  areaCode?: string;
  country?: string;
}): Promise<PhoneNumber> {
  return apiRequest<PhoneNumber>('/v1/phone/numbers', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function releaseNumber(numberId: string): Promise<void> {
  await apiRequest(`/v1/phone/numbers/${numberId}`, {
    method: 'DELETE',
  });
}

// ============ Messages ============

export interface Message {
  id: string;
  from: string;
  to: string;
  body: string;
  direction: 'inbound' | 'outbound';
  status: string;
  receivedAt: string;
  code: string | null;
}

export async function getMessages(options: { limit?: number; numberId?: string } = {}): Promise<Message[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.numberId) params.set('numberId', options.numberId);

  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<Message[]>(`/v1/phone/messages${query}`);
}

export async function sendMessage(to: string, body: string, fromNumberId?: string): Promise<Message> {
  return apiRequest<Message>('/v1/phone/messages', {
    method: 'POST',
    body: JSON.stringify({ to, body, fromNumberId }),
  });
}

export interface PollResult {
  message: {
    id: string;
    from: string;
    to: string;
    body: string;
    receivedAt: string;
  };
  code: string | null;
}

export async function pollForMessage(options: {
  timeout?: number;
  since?: string;
  numberId?: string;
}): Promise<PollResult> {
  const params = new URLSearchParams();
  if (options.timeout) params.set('timeout', options.timeout.toString());
  if (options.since) params.set('since', options.since);
  if (options.numberId) params.set('numberId', options.numberId);

  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<PollResult>(`/v1/phone/messages/poll${query}`);
}

// ============ Billing ============

export interface Usage {
  plan: 'inactive' | 'starter' | 'pro';
  limits: { phoneNumbers: number; smsPerMonth: number };
  usage: { phoneNumbers: number; smsThisMonth: number };
  canProvision: boolean;
  canReceiveSms: boolean;
}

export async function getUsage(): Promise<Usage> {
  return apiRequest<Usage>('/v1/billing/usage');
}

export async function createCheckout(plan: 'starter' | 'pro', returnUrl?: string): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/v1/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan, returnUrl: returnUrl || 'https://botcall.io' }),
  });
}

export async function createPortal(returnUrl?: string): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/v1/billing/portal', {
    method: 'POST',
    body: JSON.stringify({ returnUrl: returnUrl || 'https://botcall.io' }),
  });
}

// ============ Code Extraction (local) ============

export function extractCode(text: string): string | null {
  const patterns = [
    /(?:code|pin|otp|passcode)[:\s]+(\d{4,8})/i,
    /is[:\s]+(\d{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
    /\b(\d{5})\b/,
    /\b(\d{8})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}
