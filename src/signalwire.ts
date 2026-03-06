// @ts-expect-error - Signalwire types are not properly exported
import { RestClient } from '@signalwire/compatibility-api';
import { getConfig } from './config.js';

let client: ReturnType<typeof RestClient> | null = null;

interface SignalwireConfig {
  projectId?: string;
  apiToken?: string;
  spaceUrl?: string;
}

export function getSignalwireClient() {
  if (!client) {
    const config: SignalwireConfig = getConfig();
    if (!config.projectId || !config.apiToken || !config.spaceUrl) {
      console.error('Missing Signalwire credentials. Run: botcall auth login');
      process.exit(1);
    }
    client = RestClient(config.projectId, config.apiToken, { signalwireSpaceUrl: config.spaceUrl });
  }
  return client;
}

export interface PhoneNumber {
  id: string;
  phoneNumber: string;
  status: string;
  createdAt: string;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  text: string;
  direction: 'inbound' | 'outbound';
  receivedAt: string;
}

interface AvailableNumber {
  phoneNumber?: string;
  region?: string;
}

interface IncomingNumber {
  sid?: string;
  phoneNumber?: string;
  dateCreated?: Date;
}

interface SmsMessage {
  sid?: string;
  from?: string;
  to?: string;
  body?: string;
  direction?: string;
  status?: string;
  dateCreated?: Date;
}

// Search for available phone numbers
export async function searchNumbers(options: {
  areaCode?: string;
  country?: string;
  limit?: number;
}): Promise<Array<{ phoneNumber: string; region: string; cost: string }>> {
  const sw = getSignalwireClient();
  
  const searchParams: Record<string, unknown> = {
    smsEnabled: true,
    voiceEnabled: true,
  };
  
  if (options.areaCode) {
    searchParams.areaCode = options.areaCode;
  }
  
  try {
    // Search for local numbers
    const numbers: AvailableNumber[] = await sw.availablePhoneNumbers('US').local.list(searchParams);
    
    return numbers.slice(0, options.limit || 10).map((num: AvailableNumber) => ({
      phoneNumber: num.phoneNumber || '',
      region: num.region || 'Unknown',
      cost: '$1.00', // Signalwire standard pricing
    }));
  } catch {
    // Try toll-free if local fails
    const numbers: AvailableNumber[] = await sw.availablePhoneNumbers('US').tollFree.list({ smsEnabled: true });
    return numbers.slice(0, options.limit || 10).map((num: AvailableNumber) => ({
      phoneNumber: num.phoneNumber || '',
      region: 'Toll-Free',
      cost: '$2.00',
    }));
  }
}

// Provision (buy) a phone number
export async function provisionNumber(phoneNumber: string): Promise<PhoneNumber> {
  const sw = getSignalwireClient();
  
  const result: IncomingNumber = await sw.incomingPhoneNumbers.create({
    phoneNumber: phoneNumber,
  });
  
  return {
    id: result.sid || '',
    phoneNumber: result.phoneNumber || phoneNumber,
    status: 'active',
    createdAt: result.dateCreated?.toISOString() || new Date().toISOString(),
  };
}

// List owned phone numbers
export async function listNumbers(): Promise<PhoneNumber[]> {
  const sw = getSignalwireClient();
  
  const numbers: IncomingNumber[] = await sw.incomingPhoneNumbers.list();
  
  return numbers.map((num: IncomingNumber) => ({
    id: num.sid || '',
    phoneNumber: num.phoneNumber || '',
    status: 'active',
    createdAt: num.dateCreated?.toISOString() || '',
  }));
}

// Send SMS
export async function sendSms(to: string, text: string, from?: string): Promise<{ id: string; status: string }> {
  const sw = getSignalwireClient();
  
  // Get from number - use provided, or default, or first available
  let fromNumber = from;
  if (!fromNumber) {
    const numbers = await listNumbers();
    if (numbers.length === 0) {
      throw new Error('No phone numbers provisioned. Run: botcall provision');
    }
    fromNumber = numbers[0].phoneNumber;
  }
  
  const message: SmsMessage = await sw.messages.create({
    from: fromNumber,
    to: to,
    body: text,
  });
  
  return {
    id: message.sid || '',
    status: message.status || 'sent',
  };
}

// Get inbound messages
export async function getInbox(options: {
  phoneNumber?: string;
  limit?: number;
}): Promise<Message[]> {
  const sw = getSignalwireClient();
  
  const params: Record<string, unknown> = {};
  
  if (options.phoneNumber) {
    params.to = options.phoneNumber;
  }
  
  // Signalwire uses default pagination, we'll slice after
  const messages: SmsMessage[] = await sw.messages.list(params);
  
  // Filter to inbound only and limit
  const inbound = messages
    .filter((m: SmsMessage) => m.direction === 'inbound')
    .slice(0, options.limit || 20);
  
  return inbound.map((msg: SmsMessage) => ({
    id: msg.sid || '',
    from: msg.from || '',
    to: msg.to || '',
    text: msg.body || '',
    direction: 'inbound' as const,
    receivedAt: msg.dateCreated?.toISOString() || '',
  }));
}

// Extract verification code from message text
export function extractCode(text: string): string | null {
  // Common patterns for verification codes
  const patterns = [
    /\b(\d{6})\b/,           // 6 digits (most common)
    /\b(\d{4})\b/,           // 4 digits  
    /\b(\d{5})\b/,           // 5 digits
    /\b(\d{8})\b/,           // 8 digits
    /code[:\s]+(\d{4,8})/i,  // "code: 123456"
    /is[:\s]+(\d{4,8})/i,    // "is 123456"
    /[:：]\s*(\d{4,8})/,     // ": 123456" (including Chinese colon)
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}
