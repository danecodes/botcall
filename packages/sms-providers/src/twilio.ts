import Twilio from 'twilio';
import type {
  SmsProvider,
  ProviderConfig,
  AvailableNumber,
  PurchasedNumber,
  InboundMessage,
  SearchNumbersOptions,
  SendSmsResult,
} from './types.js';

export class TwilioProvider implements SmsProvider {
  readonly name = 'twilio';
  private client: ReturnType<typeof Twilio>;
  private webhookBaseUrl: string;

  constructor(private config: ProviderConfig) {
    this.client = Twilio(config.accountSid, config.authToken);
    this.webhookBaseUrl = config.webhookBaseUrl;
  }

  async searchNumbers(opts: SearchNumbersOptions = {}): Promise<AvailableNumber[]> {
    const { country = 'US', areaCode, smsEnabled = true, limit = 10 } = opts;

    const searchOpts: {
      smsEnabled?: boolean;
      areaCode?: number;
      limit?: number;
    } = {
      smsEnabled,
      limit,
    };
    if (areaCode) {
      searchOpts.areaCode = parseInt(areaCode);
    }

    const numbers = await this.client.availablePhoneNumbers(country).local.list(searchOpts);

    return numbers.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality,
      region: n.region,
      capabilities: {
        sms: n.capabilities.sms ?? false,
        mms: n.capabilities.mms ?? false,
        voice: n.capabilities.voice ?? false,
      },
    }));
  }

  async purchaseNumber(phoneNumber: string): Promise<PurchasedNumber> {
    const webhookUrl = this.webhookBaseUrl;

    // Twilio allows setting webhook on purchase
    const number = await this.client.incomingPhoneNumbers.create({
      phoneNumber,
      smsUrl: `${webhookUrl}/webhooks/twilio/sms`,
      smsMethod: 'POST',
      voiceUrl: `${webhookUrl}/webhooks/twilio/voice`,
      voiceMethod: 'POST',
    });

    return {
      sid: number.sid,
      phoneNumber: number.phoneNumber,
      friendlyName: number.friendlyName,
      smsEnabled: number.capabilities.sms ?? false,
    };
  }

  async updateWebhook(numberSid: string): Promise<void> {
    const webhookUrl = this.webhookBaseUrl;

    await this.client.incomingPhoneNumbers(numberSid).update({
      smsUrl: `${webhookUrl}/webhooks/twilio/sms`,
      smsMethod: 'POST',
      voiceUrl: `${webhookUrl}/webhooks/twilio/voice`,
      voiceMethod: 'POST',
    });

    console.log(`✓ Configured Twilio webhook for ${numberSid}`);
  }

  async releaseNumber(numberSid: string): Promise<void> {
    await this.client.incomingPhoneNumbers(numberSid).remove();
    console.log(`✓ Released Twilio number ${numberSid}`);
  }

  /**
   * Find the Twilio SID for a phone number
   */
  async findNumberSid(phoneNumber: string): Promise<string | null> {
    const numbers = await this.client.incomingPhoneNumbers.list({
      phoneNumber,
      limit: 1,
    });

    return numbers[0]?.sid || null;
  }

  async sendSms(from: string, to: string, body: string): Promise<SendSmsResult> {
    const message = await this.client.messages.create({
      from,
      to,
      body,
    });

    return {
      sid: message.sid,
      status: message.status,
    };
  }

  parseInboundWebhook(body: Record<string, unknown>): InboundMessage {
    // Twilio sends form-encoded POST with these fields
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
