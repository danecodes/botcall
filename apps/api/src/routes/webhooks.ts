import { Hono } from 'hono';
import { Webhook } from 'svix';
import { getDb, users, phoneNumbers, eq } from '@botcall/db';
import { createUserFromClerk, createApiKey } from '@botcall/core';
import { handleIncomingSms } from '@botcall/phone';

const app = new Hono();

/**
 * POST /webhooks/telnyx/sms
 * Receive incoming SMS from Telnyx
 */
app.post('/telnyx/sms', async (c) => {
  try {
    const payload = await c.req.json();

    // Telnyx wraps event data in payload.data
    const event = payload.data;
    if (event?.event_type !== 'message.received') {
      return c.json({ received: true });
    }

    const msg = event.payload;
    const from = msg?.from?.phone_number;
    const to = msg?.to?.[0]?.phone_number;
    const body = msg?.text || '';
    const messageSid = event.id || msg?.id || '';

    if (!from || !to) {
      return c.json({ error: 'Missing from/to' }, 400);
    }

    console.log(`📱 [Telnyx] Incoming SMS from ${from} to ${to}: '${body}'`);

    await handleIncomingSms({
      From: from,
      To: to,
      Body: body,
      MessageSid: messageSid,
      NumMedia: '0',
    });

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
  const body = await c.req.parseBody();

  console.log(`📱 [SignalWire] Incoming SMS from ${body['From']} to ${body['To']}`);

  await handleIncomingSms(body as Record<string, unknown>);

  return c.text(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, 200, { 'Content-Type': 'text/xml' });
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
  const body = await c.req.parseBody();

  console.log(`📱 [Twilio] Incoming SMS from ${body['From']} to ${body['To']}`);

  await handleIncomingSms(body as Record<string, unknown>);

  return c.text(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, 200, { 'Content-Type': 'text/xml' });
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

      const newUser = await createUserFromClerk({ clerkId: id, email: primaryEmail, name: name ?? undefined, imageUrl: image_url });
      const apiKey = await createApiKey(newUser.id, 'Default');

      console.log(`✅ User created: ${newUser.id} with API key ${apiKey.prefix}...`);
    }

    if (eventType === 'user.updated') {
      const { id, email_addresses, first_name, last_name, image_url } = event.data;
      const primaryEmail = email_addresses?.[0]?.email_address;
      const name = [first_name, last_name].filter(Boolean).join(' ') || null;

      console.log(`👤 Updating user: ${id}`);

      await getDb().update(users)
        .set({
          email: primaryEmail,
          name,
          imageUrl: image_url,
          updatedAt: new Date(),
        })
        .where(eq(users.clerkId, id));

      console.log(`✅ User updated: ${id}`);
    }

    if (eventType === 'user.deleted') {
      const { id } = event.data;

      console.log(`👤 Deleting user: ${id}`);

      await getDb().delete(users).where(eq(users.clerkId, id));

      console.log(`✅ User deleted: ${id}`);
    }

    return c.json({ received: true });
  } catch (error) {
    console.error(`❌ Error processing Clerk webhook:`, error);
    return c.json({ error: 'Processing failed' }, 500);
  }
});

export { app as webhookRoutes };
