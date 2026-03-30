// @ts-ignore - SignalWire types export isn't properly configured
import { RestClient } from '@signalwire/compatibility-api';
import type {
  SmsProvider,
  ProviderConfig,
  AvailableNumber,
  PurchasedNumber,
  InboundMessage,
  SearchNumbersOptions,
  SendSmsResult,
} from './types.js';

export interface SignalWireConfig extends ProviderConfig {
  /** SignalWire space URL (e.g., botcall.signalwire.com) */
  spaceUrl: string;
}

export class SignalWireProvider implements SmsProvider {
  readonly name = 'signalwire';
  private client: ReturnType<typeof RestClient>;
  private apiBase: string;
  private authHeader: string;
  private webhookBaseUrl: string;

  constructor(private config: SignalWireConfig) {
    this.client = RestClient(config.accountSid, config.authToken, {
      signalwireSpaceUrl: config.spaceUrl,
    });
    this.apiBase = `https://${config.spaceUrl}/api/relay/rest`;
    this.authHeader = 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
    this.webhookBaseUrl = config.webhookBaseUrl;
  }

  async searchNumbers(opts: SearchNumbersOptions = {}): Promise<AvailableNumber[]> {
    const { country = 'US', areaCode, smsEnabled = true, limit = 10 } = opts;

    const searchOpts: { smsEnabled: boolean; areaCode?: number; limit: number } = {
      smsEnabled,
      limit,
    };
    if (areaCode) {
      searchOpts.areaCode = parseInt(areaCode);
    }

    const numbers = await this.client.availablePhoneNumbers(country).local.list(searchOpts);

    return numbers.map((n: any) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality,
      region: n.region,
      capabilities: {
        sms: n.capabilities?.sms ?? true,
        mms: n.capabilities?.mms ?? false,
        voice: n.capabilities?.voice ?? true,
      },
    }));
  }

  async purchaseNumber(phoneNumber: string): Promise<PurchasedNumber> {
    const webhookUrl = this.webhookBaseUrl;

    // SignalWire Relay REST API for purchasing
    const purchaseRes = await fetch(`${this.apiBase}/phone_numbers`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        number: phoneNumber,
        call_handler: 'laml_webhooks',
        call_request_url: `${webhookUrl}/webhooks/signalwire/voice`,
        call_request_method: 'POST',
        message_handler: 'laml_webhooks',
        message_request_url: `${webhookUrl}/webhooks/signalwire/sms`,
        message_request_method: 'POST',
      }),
    });

    if (!purchaseRes.ok) {
      const errData = await purchaseRes.json().catch(() => ({}));
      console.error('SignalWire purchase error:', errData);
      throw new Error(`Failed to purchase number: ${errData.message || purchaseRes.statusText}`);
    }

    const purchaseData = await purchaseRes.json();
    const sid = purchaseData.data?.id;
    const purchasedNumber = purchaseData.data?.number || phoneNumber;

    // Configure webhook (SignalWire may not accept on purchase, so update separately)
    if (sid) {
      await this.updateWebhook(sid);
    }

    return {
      sid,
      phoneNumber: purchasedNumber,
      friendlyName: purchasedNumber,
      smsEnabled: true, // SignalWire doesn't guarantee SMS without campaign, but we requested it
    };
  }

  async updateWebhook(numberSid: string): Promise<void> {
    const webhookUrl = this.webhookBaseUrl;

    const updateRes = await fetch(`${this.apiBase}/phone_numbers/${numberSid}`, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        call_handler: 'laml_webhooks',
        call_request_url: `${webhookUrl}/webhooks/signalwire/voice`,
        call_request_method: 'POST',
        message_handler: 'laml_webhooks',
        message_request_url: `${webhookUrl}/webhooks/signalwire/sms`,
        message_request_method: 'POST',
      }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error('Failed to configure webhook:', errText);
      throw new Error(`Failed to configure webhook: ${updateRes.statusText}`);
    }

    console.log(`✓ Configured SignalWire webhook for ${numberSid}`);
  }

  async releaseNumber(numberSid: string): Promise<void> {
    const releaseRes = await fetch(`${this.apiBase}/phone_numbers/${numberSid}`, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader },
    });

    if (!releaseRes.ok) {
      const errText = await releaseRes.text();
      console.error('Failed to release number:', errText);
      throw new Error(`Failed to release number: ${releaseRes.statusText}`);
    }

    console.log(`✓ Released SignalWire number ${numberSid}`);
  }

  /**
   * Find the SignalWire SID for a phone number (needed for release if we only have the number)
   */
  async findNumberSid(phoneNumber: string): Promise<string | null> {
    const listRes = await fetch(`${this.apiBase}/phone_numbers`, {
      headers: { Authorization: this.authHeader },
    });

    if (!listRes.ok) {
      return null;
    }

    const listData = await listRes.json();
    const swNumber = listData.data?.find((n: any) => n.number === phoneNumber);
    return swNumber?.id || null;
  }

  async sendSms(from: string, to: string, body: string): Promise<SendSmsResult> {
    const message = await this.client.messages.create({
      from,
      to,
      body,
    });

    return {
      sid: message.sid || '',
      status: message.status || 'sent',
    };
  }

  parseInboundWebhook(body: Record<string, unknown>): InboundMessage {
    // SignalWire uses Twilio-compatible form fields
    const numMedia = parseInt(String(body.NumMedia || '0'), 10);
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = body[`MediaUrl${i}`];
      if (typeof url === 'string') {
        mediaUrls.push(url);
      }
    }

    return {
      messageSid: String(body.MessageSid || body.SmsSid || ''),
      from: String(body.From || ''),
      to: String(body.To || ''),
      body: String(body.Body || ''),
      numMedia,
      mediaUrls,
    };
  }
}
