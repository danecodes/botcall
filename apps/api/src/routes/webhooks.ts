import { Hono } from 'hono';
import { Webhook } from 'svix';
import { createVerify, createHmac, timingSafeEqual } from 'crypto';
import { getDb, users, phoneNumbers, smsMessages, usageRecords, apiKeys, subscriptions, eq, and } from '@botcall/db';
import { createUserFromClerk, createApiKey } from '@botcall/core';
import { handleIncomingSms, getSmsProvider } from '@botcall/phone';

const app = new Hono();

// Twilio-compatible HMAC-SHA1 signature verification (used by SignalWire)
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

    // Parse using the Telnyx provider parser explicitly
    const sms = getSmsProvider();
    const parsed = sms.parseInboundWebhook(payload);
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
app.post('/signalwire/sms', async (c) => {
  try {
    const authToken = process.env.SIGNALWIRE_API_TOKEN;
    const sig = c.req.header('x-signalwire-signature');
    const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;

    if (authToken) {
      // Signature header is mandatory when auth token is configured
      if (!sig) {
        console.error('❌ [SignalWire] Missing x-signalwire-signature header');
        return c.text('Forbidden', 403);
      }

      if (!webhookBaseUrl) {
        console.error('❌ WEBHOOK_BASE_URL not set — cannot verify SignalWire signature');
        return c.json({ error: 'Webhook misconfigured' }, 500);
      }

      const body = await c.req.parseBody() as Record<string, string>;
      const webhookUrl = `${webhookBaseUrl}/webhooks/signalwire/sms`;

      if (!verifyTwilioSignature(authToken, sig, webhookUrl, body)) {
        console.error('❌ [SignalWire] Invalid signature');
        return c.text('Forbidden', 403);
      }

      console.log(`📱 [SignalWire] Incoming SMS from ${body['From']} to ${body['To']}`);

      const sms = getSmsProvider();
      const parsed = sms.parseInboundWebhook(body as Record<string, unknown>);
      await handleIncomingSms(parsed);
    } else {
      // No auth token — only allow in non-production
      if (process.env.NODE_ENV === 'production') {
        console.error('❌ SIGNALWIRE_API_TOKEN not set in production');
        return c.json({ error: 'Webhook not configured' }, 500);
      }

      console.warn('⚠️ SIGNALWIRE_API_TOKEN not set — skipping signature verification (dev only)');
      const body = await c.req.parseBody() as Record<string, string>;
      console.log(`📱 [SignalWire] Incoming SMS from ${body['From']} to ${body['To']}`);

      const sms = getSmsProvider();
      const parsed = sms.parseInboundWebhook(body as Record<string, unknown>);
      await handleIncomingSms(parsed);
    }

    return c.text(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`, 200, { 'Content-Type': 'text/xml' });
  } catch (error) {
    console.error('SignalWire SMS webhook error:', error);
    return c.json({ error: 'Processing failed' }, 500);
  }
});

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
app.post('/twilio/sms', async (c) => {
  try {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const sig = c.req.header('x-twilio-signature');
    const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;

    if (authToken) {
      if (!sig) {
        console.error('❌ [Twilio] Missing x-twilio-signature header');
        return c.text('Forbidden', 403);
      }

      if (!webhookBaseUrl) {
        console.error('❌ WEBHOOK_BASE_URL not set — cannot verify Twilio signature');
        return c.json({ error: 'Webhook misconfigured' }, 500);
      }

      const body = await c.req.parseBody() as Record<string, string>;
      const webhookUrl = `${webhookBaseUrl}/webhooks/twilio/sms`;

      if (!verifyTwilioSignature(authToken, sig, webhookUrl, body)) {
        console.error('❌ [Twilio] Invalid signature');
        return c.text('Forbidden', 403);
      }

      console.log(`📱 [Twilio] Incoming SMS from ${body['From']} to ${body['To']}`);
      const sms = getSmsProvider();
      const parsed = sms.parseInboundWebhook(body as Record<string, unknown>);
      await handleIncomingSms(parsed);
    } else if (process.env.NODE_ENV === 'production') {
      console.error('❌ TWILIO_AUTH_TOKEN not set in production');
      return c.json({ error: 'Webhook not configured' }, 500);
    } else {
      console.warn('⚠️ TWILIO_AUTH_TOKEN not set — skipping signature verification (dev only)');
      const body = await c.req.parseBody() as Record<string, string>;
      console.log(`📱 [Twilio] Incoming SMS from ${body['From']} to ${body['To']}`);
      const sms = getSmsProvider();
      const parsed = sms.parseInboundWebhook(body as Record<string, unknown>);
      await handleIncomingSms(parsed);
    }

    return c.text(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`, 200, { 'Content-Type': 'text/xml' });
  } catch (error) {
    console.error('Twilio SMS webhook error:', error);
    return c.json({ error: 'Processing failed' }, 500);
  }
});

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

      // Delete in FK-safe order: messages → usage → keys → phone numbers → subscriptions → user
      await db.delete(smsMessages).where(eq(smsMessages.userId, user.id));
      await db.delete(usageRecords).where(eq(usageRecords.userId, user.id));
      await db.delete(apiKeys).where(eq(apiKeys.userId, user.id));
      // Mark phone numbers released before deleting (provider already billed; skip API call here)
      await db.update(phoneNumbers).set({ status: 'released' }).where(eq(phoneNumbers.userId, user.id));
      await db.delete(phoneNumbers).where(eq(phoneNumbers.userId, user.id));
      await db.delete(subscriptions).where(eq(subscriptions.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));

      console.log(`✅ User deleted: ${id}`);
    }

    return c.json({ received: true });
  } catch (error) {
    console.error(`❌ Error processing Clerk webhook:`, error);
    return c.json({ error: 'Processing failed' }, 500);
  }
});

export { app as webhookRoutes };
