import { Hono } from 'hono';
import { Webhook } from 'svix';
import { createVerify, createHmac, timingSafeEqual } from 'crypto';
import { getDb, users, phoneNumbers, smsMessages, usageRecords, apiKeys, subscriptions, eq, and } from '@botcall/db';
import { createUserFromClerk, createApiKey, cancelSubscription } from '@botcall/core';
import { handleIncomingSms } from '@botcall/phone';
import { parseTelnyxInbound, parseTwilioInbound, parseSignalWireInbound } from '@botcall/sms-providers';
import type { InboundMessage } from '@botcall/sms-providers';

const app = new Hono();

// Twilio-compatible HMAC-SHA1 signature verification (used by SignalWire and Twilio)
function verifyTwilioSignature(authToken: string, signature: string, url: string, params: Record<string, string>): boolean {
  const sortedParams = Object.keys(params).sort().reduce((str, key) => str + key + params[key], '');
  const expected = createHmac('sha1', authToken).update(url + sortedParams).digest('base64');
  // Timing-safe comparison to prevent oracle attacks
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Shared handler for Twilio-compatible webhooks (SignalWire + Twilio).
 * Both use the same signature format and form-encoded body.
 */
async function handleTwilioCompatibleWebhook(
  c: any,
  provider: { name: string; headerName: string; envTokenKey: string; webhookPath: string; parse: (body: Record<string, unknown>) => InboundMessage }
) {
  try {
    const authToken = process.env[provider.envTokenKey];
    const sig = c.req.header(provider.headerName);
    const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;

    if (authToken) {
      if (!sig) {
        console.error(`❌ [${provider.name}] Missing ${provider.headerName} header`);
        return c.text('Forbidden', 403);
      }

      if (!webhookBaseUrl) {
        console.error(`❌ WEBHOOK_BASE_URL not set — cannot verify ${provider.name} signature`);
        return c.json({ error: 'Webhook misconfigured' }, 500);
      }

      const body = await c.req.parseBody() as Record<string, string>;
      const webhookUrl = `${webhookBaseUrl}${provider.webhookPath}`;

      if (!verifyTwilioSignature(authToken, sig, webhookUrl, body)) {
        console.error(`❌ [${provider.name}] Invalid signature`);
        return c.text('Forbidden', 403);
      }

      console.log(`📱 [${provider.name}] Incoming SMS from ${body['From']} to ${body['To']}`);
      const parsed = provider.parse(body as Record<string, unknown>);
      await handleIncomingSms(parsed);
    } else if (process.env.NODE_ENV === 'production') {
      console.error(`❌ ${provider.envTokenKey} not set in production`);
      return c.json({ error: 'Webhook not configured' }, 500);
    } else {
      console.warn(`⚠️ ${provider.envTokenKey} not set — skipping signature verification (dev only)`);
      const body = await c.req.parseBody() as Record<string, string>;
      console.log(`📱 [${provider.name}] Incoming SMS from ${body['From']} to ${body['To']}`);
      const parsed = provider.parse(body as Record<string, unknown>);
      await handleIncomingSms(parsed);
    }

    return c.text(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`, 200, { 'Content-Type': 'text/xml' });
  } catch (error) {
    console.error(`${provider.name} SMS webhook error:`, error);
    return c.json({ error: 'Processing failed' }, 500);
  }
}

/**
 * POST /webhooks/telnyx/sms
 * Receive incoming SMS from Telnyx
 */
app.post('/telnyx/sms', async (c) => {
  try {
    const rawBody = await c.req.text();
    const publicKey = process.env.TELNYX_PUBLIC_KEY;
    const telnyxTimestamp = c.req.header('telnyx-timestamp');
    const telnyxSignature = c.req.header('telnyx-signature-ed25519-signature');

    if (publicKey) {
      if (!telnyxTimestamp || !telnyxSignature) {
        return c.json({ error: 'Missing signature headers' }, 400);
      }

      // Reject stale webhooks (replay attack protection — 5 minute window)
      const webhookAge = Math.abs(Date.now() - parseInt(telnyxTimestamp) * 1000);
      if (webhookAge > 5 * 60 * 1000) {
        return c.json({ error: 'Webhook timestamp too old' }, 400);
      }

      const signedPayload = `${telnyxTimestamp}|${rawBody}`;
      const verify = createVerify('Ed25519');
      verify.update(signedPayload);
      const isValid = verify.verify(
        { key: publicKey, format: 'pem' },
        Buffer.from(telnyxSignature, 'base64')
      );
      if (!isValid) {
        return c.json({ error: 'Invalid signature' }, 400);
      }
    } else if (process.env.NODE_ENV === 'production') {
      return c.json({ error: 'Webhook not configured' }, 500);
    } else {
      console.warn('⚠️ TELNYX_PUBLIC_KEY not set — skipping in development');
    }

    const payload = JSON.parse(rawBody);

    if (payload.data?.event_type !== 'message.received') {
      return c.json({ received: true });
    }

    console.log(`📱 [Telnyx] Incoming SMS: ${JSON.stringify(payload.data?.payload?.from)} → ${JSON.stringify(payload.data?.payload?.to)}`);

    // Use Telnyx-specific parser (not the global SMS_PROVIDER)
    const parsed = parseTelnyxInbound(payload);
    await handleIncomingSms(parsed);

    return c.json({ received: true });
  } catch (error) {
    console.error('Telnyx SMS webhook error:', error);
    return c.json({ error: 'Processing failed' }, 500);
  }
});

/**
 * POST /webhooks/signalwire/sms
 * Receive incoming SMS/MMS from SignalWire
 */
app.post('/signalwire/sms', (c) =>
  handleTwilioCompatibleWebhook(c, {
    name: 'SignalWire',
    headerName: 'x-signalwire-signature',
    envTokenKey: 'SIGNALWIRE_API_TOKEN',
    webhookPath: '/webhooks/signalwire/sms',
    parse: parseSignalWireInbound,
  })
);

/**
 * POST /webhooks/signalwire/voice
 * Handle incoming voice calls from SignalWire
 */
app.post('/signalwire/voice', async (c) => {
  return c.text(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>This number is not configured to receive calls.</Say>
  <Hangup/>
</Response>`, 200, { 'Content-Type': 'text/xml' });
});

/**
 * POST /webhooks/twilio/sms
 * Receive incoming SMS/MMS from Twilio
 */
app.post('/twilio/sms', (c) =>
  handleTwilioCompatibleWebhook(c, {
    name: 'Twilio',
    headerName: 'x-twilio-signature',
    envTokenKey: 'TWILIO_AUTH_TOKEN',
    webhookPath: '/webhooks/twilio/sms',
    parse: parseTwilioInbound,
  })
);

/**
 * POST /webhooks/twilio/voice
 * Handle incoming voice calls from Twilio
 */
app.post('/twilio/voice', async (c) => {
  return c.text(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>This number is not configured to receive calls.</Say>
  <Hangup/>
</Response>`, 200, { 'Content-Type': 'text/xml' });
});

/**
 * POST /webhooks/clerk
 * Handle Clerk user events (signup, update, delete)
 */
app.post('/clerk', async (c) => {
  const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!CLERK_WEBHOOK_SECRET) {
    console.error('❌ CLERK_WEBHOOK_SECRET not set');
    return c.json({ error: 'Webhook secret not configured' }, 500);
  }

  const svixId = c.req.header('svix-id');
  const svixTimestamp = c.req.header('svix-timestamp');
  const svixSignature = c.req.header('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error('❌ Missing svix headers');
    return c.json({ error: 'Missing headers' }, 400);
  }

  const rawBody = await c.req.text();

  const wh = new Webhook(CLERK_WEBHOOK_SECRET);
  let event: any;

  try {
    event = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
  } catch (err) {
    console.error('❌ Webhook verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  const eventType = event.type;
  console.log(`📨 Clerk webhook: ${eventType}`);

  try {
    if (eventType === 'user.created') {
      const { id, email_addresses, primary_email_address_id, first_name, last_name, image_url } = event.data;

      let primaryEmail = null;
      if (email_addresses && email_addresses.length > 0) {
        const primary = email_addresses.find((e: any) => e.id === primary_email_address_id);
        primaryEmail = primary?.email_address || email_addresses[0]?.email_address;
      }

      if (!primaryEmail) {
        console.error('❌ No email found in Clerk webhook data');
        return c.json({ error: 'No email in user data' }, 400);
      }

      const name = [first_name, last_name].filter(Boolean).join(' ') || null;

      console.log(`👤 Creating user: ${primaryEmail} (clerk_id: ${id})`);

      try {
        const newUser = await createUserFromClerk({ clerkId: id, email: primaryEmail, name: name ?? undefined, imageUrl: image_url });
        const apiKey = await createApiKey(newUser.id, 'Default');
        console.log(`✅ User created: ${newUser.id} with API key ${apiKey.prefix}...`);
      } catch (err: any) {
        // Idempotency: ignore duplicate Clerk ID (provider retry on transient error)
        if (err?.message?.includes('unique') || err?.code === '23505') {
          console.log(`ℹ️ User ${id} already exists — skipping (idempotent retry)`);
        } else {
          throw err;
        }
      }
    }

    if (eventType === 'user.updated') {
      const { id, email_addresses, primary_email_address_id, first_name, last_name, image_url } = event.data;

      // Find primary email using primary_email_address_id (not just [0])
      let primaryEmail: string | undefined;
      if (email_addresses && email_addresses.length > 0) {
        const primary = email_addresses.find((e: any) => e.id === primary_email_address_id);
        primaryEmail = primary?.email_address || email_addresses[0]?.email_address;
      }

      const name = [first_name, last_name].filter(Boolean).join(' ') || null;

      console.log(`👤 Updating user: ${id}`);

      await getDb().update(users)
        .set({
          ...(primaryEmail && { email: primaryEmail }),
          name,
          imageUrl: image_url,
          updatedAt: new Date(),
        })
        .where(eq(users.clerkId, id));

      console.log(`✅ User updated: ${id}`);
    }

    if (eventType === 'user.deleted') {
      const { id } = event.data;
      const db = getDb();

      console.log(`👤 Deleting user: ${id}`);

      // Look up the internal user ID
      const [user] = await db.select().from(users).where(eq(users.clerkId, id)).limit(1);

      if (!user) {
        console.log(`ℹ️ User ${id} not found — already deleted`);
        return c.json({ received: true });
      }

      // Cancel Stripe subscription before deleting DB records
      const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
      if (sub?.stripeSubscriptionId) {
        try {
          await cancelSubscription(sub.stripeSubscriptionId);
          console.log(`✅ Canceled Stripe subscription ${sub.stripeSubscriptionId}`);
        } catch (stripeErr) {
          console.error(`⚠️ Failed to cancel Stripe subscription:`, stripeErr);
          // Continue with deletion — don't block on Stripe failure
        }
      }

      // Release phone numbers from provider before deleting DB records
      const activeNumbers = await db.select().from(phoneNumbers)
        .where(and(eq(phoneNumbers.userId, user.id), eq(phoneNumbers.status, 'active')));

      for (const num of activeNumbers) {
        try {
          const { createSmsProviderFromEnv } = await import('@botcall/sms-providers');
          const sms = createSmsProviderFromEnv();
          await sms.releaseNumber(num.providerSid);
          console.log(`✅ Released ${num.number} from provider`);
        } catch (releaseErr) {
          console.error(`⚠️ Failed to release ${num.number} from provider:`, releaseErr);
          // Continue — don't block deletion on provider failure
        }
      }

      // Delete in FK-safe order within a transaction
      await db.transaction(async (tx) => {
        await tx.delete(smsMessages).where(eq(smsMessages.userId, user.id));
        await tx.delete(usageRecords).where(eq(usageRecords.userId, user.id));
        await tx.delete(apiKeys).where(eq(apiKeys.userId, user.id));
        await tx.delete(phoneNumbers).where(eq(phoneNumbers.userId, user.id));
        await tx.delete(subscriptions).where(eq(subscriptions.userId, user.id));
        await tx.delete(users).where(eq(users.id, user.id));
      });

      console.log(`✅ User deleted: ${id}`);
    }

    return c.json({ received: true });
  } catch (error) {
    console.error(`❌ Error processing Clerk webhook:`, error);
    return c.json({ error: 'Processing failed' }, 500);
  }
});

export { app as webhookRoutes };
