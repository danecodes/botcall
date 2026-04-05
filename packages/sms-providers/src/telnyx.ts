import type {
  SmsProvider,
  AvailableNumber,
  PurchasedNumber,
  InboundMessage,
  SearchNumbersOptions,
  SendSmsResult,
} from './types.js';

export interface TelnyxConfig {
  apiKey: string;
  messagingProfileId: string;
  /** Base URL for webhooks (e.g., https://api.botcall.io) */
  webhookBaseUrl: string;
}

const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

export class TelnyxProvider implements SmsProvider {
  readonly name = 'telnyx';
  private authHeader: string;
  private messagingProfileId: string;
  private webhookBaseUrl: string;

  constructor(private config: TelnyxConfig) {
    this.authHeader = `Bearer ${config.apiKey}`;
    this.messagingProfileId = config.messagingProfileId;
    this.webhookBaseUrl = config.webhookBaseUrl;
  }

  async searchNumbers(opts: SearchNumbersOptions = {}): Promise<AvailableNumber[]> {
    const { country = 'US', areaCode, limit = 10 } = opts;

    const params = new URLSearchParams({
      country_code: country,
      features: 'sms',
      limit: String(limit),
    });

    if (areaCode) {
      params.set('npa', areaCode);
    }

    const res = await fetch(`${TELNYX_API_BASE}/available_phone_numbers?${params}`, {
      headers: { Authorization: this.authHeader },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Telnyx search failed: ${(err as any).errors?.[0]?.detail || res.statusText}`);
    }

    const data = await res.json() as { data: any[] };

    return data.data.map((n: any) => ({
      phoneNumber: n.phone_number,
      friendlyName: n.phone_number,
      locality: n.locality,
      region: n.region,
      capabilities: {
        sms: n.features?.includes('sms') ?? true,
        mms: n.features?.includes('mms') ?? false,
        voice: n.features?.includes('voice') ?? true,
      },
    }));
  }

  async purchaseNumber(phoneNumber: string): Promise<PurchasedNumber> {
    const res = await fetch(`${TELNYX_API_BASE}/phone_numbers`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: phoneNumber,
        messaging_profile_id: this.messagingProfileId,
        connection_id: undefined, // Use messaging profile for SMS routing
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Telnyx purchase failed: ${(err as any).errors?.[0]?.detail || res.statusText}`);
    }

    const data = await res.json() as { data: any };
    const num = data.data;

    // Configure webhook via messaging profile (already set up), but also set inbound webhook
    try {
      await this.updateWebhook(num.id);
    } catch (e) {
      console.warn(`Warning: could not update webhook for ${num.id}:`, e);
    }

    return {
      sid: num.id,
      phoneNumber: num.phone_number,
      friendlyName: num.phone_number,
      smsEnabled: true,
    };
  }

  async updateWebhook(numberSid: string): Promise<void> {
    // Telnyx uses messaging profiles for webhook routing
    // Update the messaging profile's webhook URL
    const webhookUrl = `${this.webhookBaseUrl}/webhooks/telnyx/sms`;

    const res = await fetch(`${TELNYX_API_BASE}/messaging_profiles/${this.messagingProfileId}`, {
      method: 'PATCH',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhook_url: webhookUrl,
        webhook_failover_url: '',
        webhook_api_version: '2',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to update Telnyx messaging profile webhook: ${errText}`);
    }

    console.log(`✓ Configured Telnyx webhook → ${webhookUrl}`);
  }

  async releaseNumber(numberSid: string): Promise<void> {
    const res = await fetch(`${TELNYX_API_BASE}/phone_numbers/${numberSid}`, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to release Telnyx number: ${errText}`);
    }

    console.log(`✓ Released Telnyx number ${numberSid}`);
  }

  async sendSms(from: string, to: string, body: string): Promise<SendSmsResult> {
    const res = await fetch(`${TELNYX_API_BASE}/messages`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        text: body,
        messaging_profile_id: this.messagingProfileId,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Telnyx send SMS failed: ${(err as any).errors?.[0]?.detail || res.statusText}`);
    }

    const data = await res.json() as { data: any };

    return {
      sid: data.data.id,
      status: data.data.to?.[0]?.status || 'queued',
    };
  }

  parseInboundWebhook(body: Record<string, unknown>): InboundMessage {
    return parseTelnyxInbound(body);
  }
}

/** Stateless Telnyx inbound webhook parser */
export function parseTelnyxInbound(body: Record<string, unknown>): InboundMessage {
  const event = body as any;
  const payload = event?.data?.payload || event?.payload || event;

  const from = payload?.from?.phone_number || payload?.from || '';
  const toArr = payload?.to;
  const to = Array.isArray(toArr) ? toArr[0]?.phone_number : (payload?.to || '');
  const text = payload?.text || payload?.body || '';
  const messageId = event?.data?.id || payload?.id || '';

  const mediaUrls: string[] = [];
  if (Array.isArray(payload?.media)) {
    for (const m of payload.media) {
      if (m?.url) mediaUrls.push(m.url);
    }
  }

  return {
    messageSid: String(messageId),
    from: String(from),
    to: String(to),
    body: String(text),
    numMedia: mediaUrls.length,
    mediaUrls,
  };
}
