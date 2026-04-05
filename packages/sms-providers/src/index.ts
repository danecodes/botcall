export * from './types.js';
export { SignalWireProvider, type SignalWireConfig } from './signalwire.js';
export { TwilioProvider } from './twilio.js';
export { TelnyxProvider, type TelnyxConfig } from './telnyx.js';

import type { SmsProvider, ProviderConfig } from './types.js';
import { SignalWireProvider, type SignalWireConfig } from './signalwire.js';
import { TwilioProvider } from './twilio.js';
import { TelnyxProvider } from './telnyx.js';

export type SmsProviderName = 'telnyx' | 'signalwire' | 'twilio';

// Stateless inbound webhook parsers — one per provider format.
// These don't need credentials, just the raw webhook body.
import { parseTelnyxInbound } from './telnyx.js';
import { parseTwilioInbound } from './twilio.js';
import { parseSignalWireInbound } from './signalwire.js';
export { parseTelnyxInbound, parseTwilioInbound, parseSignalWireInbound };

/**
 * Create an SMS provider instance by name
 */
export function createSmsProvider(
  name: SmsProviderName,
  config: any
): SmsProvider {
  switch (name) {
    case 'telnyx':
      return new TelnyxProvider(config);

    case 'signalwire':
      if (!('spaceUrl' in config)) {
        throw new Error('SignalWire requires spaceUrl in config');
      }
      return new SignalWireProvider(config as SignalWireConfig);

    case 'twilio':
      return new TwilioProvider(config);

    default:
      throw new Error(`Unknown SMS provider: ${name}`);
  }
}

/**
 * Create an SMS provider from environment variables
 */
export function createSmsProviderFromEnv(): SmsProvider {
  const providerName = (process.env.SMS_PROVIDER || 'telnyx') as SmsProviderName;
  const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || 'https://api.botcall.io';

  switch (providerName) {
    case 'telnyx': {
      const apiKey = process.env.TELNYX_API_KEY;
      const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID;

      if (!apiKey || !messagingProfileId) {
        throw new Error('Telnyx requires TELNYX_API_KEY and TELNYX_MESSAGING_PROFILE_ID');
      }

      return new TelnyxProvider({ apiKey, messagingProfileId, webhookBaseUrl });
    }

    case 'signalwire': {
      const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
      const accountSid = process.env.SIGNALWIRE_PROJECT_ID;
      const authToken = process.env.SIGNALWIRE_API_TOKEN;

      if (!spaceUrl || !accountSid || !authToken) {
        throw new Error('SignalWire requires SIGNALWIRE_SPACE_URL, SIGNALWIRE_PROJECT_ID, and SIGNALWIRE_API_TOKEN');
      }

      return new SignalWireProvider({ spaceUrl, accountSid, authToken, webhookBaseUrl });
    }

    case 'twilio': {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;

      if (!accountSid || !authToken) {
        throw new Error('Twilio requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
      }

      return new TwilioProvider({ accountSid, authToken, webhookBaseUrl });
    }

    default:
      throw new Error(`Unknown SMS provider: ${providerName}. Set SMS_PROVIDER to 'telnyx', 'signalwire', or 'twilio'`);
  }
}
