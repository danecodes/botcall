/**
 * Available phone number from a provider search
 */
export interface AvailableNumber {
  phoneNumber: string; // E.164 format: +12065551234
  friendlyName: string;
  locality?: string;
  region?: string;
  capabilities: {
    sms: boolean;
    mms: boolean;
    voice: boolean;
  };
}

/**
 * Purchased phone number with provider-specific ID
 */
export interface PurchasedNumber {
  sid: string; // Provider's ID for this number (needed for updates/release)
  phoneNumber: string; // E.164 format
  friendlyName: string;
  smsEnabled: boolean;
}

/**
 * Parsed inbound SMS message from webhook
 */
export interface InboundMessage {
  messageSid: string;
  from: string; // E.164 format
  to: string; // E.164 format
  body: string;
  numMedia: number;
  mediaUrls: string[];
}

/**
 * Search options for available numbers
 */
export interface SearchNumbersOptions {
  country?: string; // ISO country code, default 'US'
  areaCode?: string;
  smsEnabled?: boolean; // default true
  limit?: number; // default 10
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  accountSid: string;
  authToken: string;
  /** Base URL for webhooks (e.g., https://api.botcall.io) */
  webhookBaseUrl: string;
}

/**
 * Result of sending an SMS
 */
export interface SendSmsResult {
  sid: string;
  status: string;
}

/**
 * SMS Provider interface - implement this for each provider
 */
export interface SmsProvider {
  readonly name: string;

  /**
   * Search for available phone numbers to purchase
   */
  searchNumbers(opts?: SearchNumbersOptions): Promise<AvailableNumber[]>;

  /**
   * Purchase a phone number and configure its SMS webhook
   */
  purchaseNumber(phoneNumber: string): Promise<PurchasedNumber>;

  /**
   * Update the SMS webhook URL for a purchased number
   */
  updateWebhook(numberSid: string): Promise<void>;

  /**
   * Release (delete) a purchased phone number
   */
  releaseNumber(numberSid: string): Promise<void>;

  /**
   * Send an SMS message
   */
  sendSms(from: string, to: string, body: string): Promise<SendSmsResult>;

  /**
   * Parse an inbound SMS webhook request body into a normalized format
   */
  parseInboundWebhook(body: Record<string, unknown>): InboundMessage;
}
