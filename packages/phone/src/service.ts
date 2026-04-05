import { eq, and, desc, gte } from 'drizzle-orm';
import { getDb, phoneNumbers, smsMessages, usageRecords } from '@botcall/db';
import { createSmsProviderFromEnv, type SmsProvider, type InboundMessage } from '@botcall/sms-providers';

let provider: SmsProvider | null = null;

/**
 * Get the SMS provider (lazily initialized from env)
 */
export function getSmsProvider(): SmsProvider {
  if (!provider) {
    provider = createSmsProviderFromEnv();
  }
  return provider;
}

/**
 * Provision a new phone number for a user
 */
export async function provisionNumber(userId: string, options: {
  areaCode?: string;
  country?: string;
}) {
  const db = getDb();
  const sms = getSmsProvider();

  // Search for multiple available numbers (in case some get snagged)
  const available = await sms.searchNumbers({
    areaCode: options.areaCode,
    country: options.country,
    limit: 5,
  });

  if (available.length === 0) {
    throw new Error('No numbers available with those criteria');
  }

  // Try each number until one succeeds (handles race conditions)
  let lastError: Error | null = null;
  for (const candidate of available) {
    try {
      console.log(`📱 Attempting to purchase ${candidate.phoneNumber}...`);
      const result = await sms.purchaseNumber(candidate.phoneNumber);

      if (!result.sid || !result.phoneNumber) {
        console.error(`❌ Invalid purchase result:`, result);
        throw new Error('Purchase returned invalid result (missing sid or phoneNumber)');
      }

      console.log(`✅ Successfully purchased ${result.phoneNumber} (${result.sid})`);

      // Store in our database (transaction ensures both inserts succeed or neither does)
      // If DB fails, release the number back to the provider to avoid orphaned billing
      let phoneNumber;
      try {
        phoneNumber = await db.transaction(async (tx) => {
          const [pn] = await tx.insert(phoneNumbers).values({
            userId,
            number: result.phoneNumber,
            provider: sms.name,
            providerSid: result.sid,
            capabilities: { sms: result.smsEnabled, voice: true, mms: false },
            status: 'active',
          }).returning();

          await tx.insert(usageRecords).values({
            userId,
            service: 'phone',
            action: 'number_provisioned',
            quantity: 1,
            metadata: { phoneNumberId: pn.id },
          });

          return pn;
        });
      } catch (dbError) {
        console.error(`❌ DB insert failed after purchasing ${result.phoneNumber}, releasing number:`, dbError);
        try {
          await sms.releaseNumber(result.sid);
        } catch (releaseError) {
          console.error(`❌ CRITICAL: Failed to release orphaned number ${result.phoneNumber} (${result.sid}):`, releaseError);
        }
        throw dbError;
      }

      return phoneNumber;
    } catch (error) {
      console.error(`❌ Failed to purchase ${candidate.phoneNumber}:`, error);
      lastError = error as Error;
    }
  }

  throw new Error(`Failed to purchase any available number: ${lastError?.message || 'Unknown error'}`);
}

/**
 * List phone numbers for a user
 */
export async function listNumbers(userId: string) {
  const db = getDb();
  const provider = getSmsProvider().name;

  return db
    .select()
    .from(phoneNumbers)
    .where(and(
      eq(phoneNumbers.userId, userId),
      eq(phoneNumbers.status, 'active'),
      eq(phoneNumbers.provider, provider),
    ));
}

/**
 * Get a specific phone number
 */
export async function getNumber(userId: string, numberId: string) {
  const db = getDb();

  const result = await db
    .select()
    .from(phoneNumbers)
    .where(and(
      eq(phoneNumbers.id, numberId),
      eq(phoneNumbers.userId, userId)
    ))
    .limit(1);

  return result[0] || null;
}

/**
 * Release a phone number
 */
export async function releaseNumber(userId: string, numberId: string) {
  const db = getDb();
  const sms = getSmsProvider();

  const number = await getNumber(userId, numberId);
  if (!number) {
    throw new Error('Phone number not found');
  }

  // Release from provider (skip if no providerSid — number may not have been fully provisioned)
  if (number.providerSid) {
    await sms.releaseNumber(number.providerSid);
  } else {
    console.warn(`releaseNumber: no providerSid for number ${numberId}, skipping provider release`);
  }

  // Mark as released in our database
  await db
    .update(phoneNumbers)
    .set({ status: 'released' })
    .where(eq(phoneNumbers.id, numberId));

  return true;
}

/**
 * Handle incoming SMS (accepts pre-parsed InboundMessage from webhook handler)
 */
export async function handleIncomingSms(data: InboundMessage) {
  const db = getDb();

  // Find the phone number in our DB
  const [phoneNumber] = await db
    .select()
    .from(phoneNumbers)
    .where(and(
      eq(phoneNumbers.number, data.to),
      eq(phoneNumbers.status, 'active'),
    ))
    .limit(1);

  if (!phoneNumber) {
    console.error(`Received SMS for unknown number: ${data.to}`);
    return null;
  }

  // Store message + usage in a transaction; skip on duplicate providerSid (idempotent)
  const message = await db.transaction(async (tx) => {
    const inserted = await tx.insert(smsMessages).values({
      phoneNumberId: phoneNumber.id,
      userId: phoneNumber.userId,
      from: data.from,
      to: data.to,
      body: data.body,
      direction: 'inbound',
      status: 'received',
      providerSid: data.messageSid || null,
      receivedAt: new Date(),
    })
    .onConflictDoNothing({ target: smsMessages.providerSid })
    .returning();

    if (inserted.length === 0) {
      // Duplicate webhook — already processed
      console.log(`[SMS] Duplicate webhook for providerSid ${data.messageSid}, skipping`);
      return null;
    }

    await tx.insert(usageRecords).values({
      userId: phoneNumber.userId,
      service: 'phone',
      action: 'sms_received',
      quantity: 1,
      metadata: { messageId: inserted[0].id },
    });

    return inserted[0];
  });

  return message;
}

/**
 * Get messages for a user
 */
export async function getMessages(userId: string, options: {
  phoneNumberId?: string;
  direction?: 'inbound' | 'outbound';
  limit?: number;
  since?: string;
}) {
  const db = getDb();

  const conditions: ReturnType<typeof eq>[] = [eq(smsMessages.userId, userId)];

  if (options.phoneNumberId) {
    conditions.push(eq(smsMessages.phoneNumberId, options.phoneNumberId));
  }

  if (options.since) {
    const sinceDate = new Date(options.since);
    if (!isNaN(sinceDate.getTime())) {
      conditions.push(gte(smsMessages.receivedAt, sinceDate));
    }
  }

  return db
    .select()
    .from(smsMessages)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(desc(smsMessages.receivedAt))
    .limit(options.limit || 50);
}

/**
 * Send SMS
 */
export async function sendSms(userId: string, to: string, body: string, fromNumberId?: string) {
  const db = getDb();
  const sms = getSmsProvider();

  // Get the from number
  let fromNumber;
  if (fromNumberId) {
    fromNumber = await getNumber(userId, fromNumberId);
  } else {
    const numbers = await listNumbers(userId);
    fromNumber = numbers[0];
  }

  if (!fromNumber) {
    throw new Error('No phone number available to send from');
  }

  // Send via provider
  const result = await sms.sendSms(fromNumber.number, to, body);

  // Store message + usage in a transaction
  const message = await db.transaction(async (tx) => {
    const [msg] = await tx.insert(smsMessages).values({
      phoneNumberId: fromNumber.id,
      userId,
      from: fromNumber.number,
      to,
      body,
      direction: 'outbound',
      status: result.status,
      providerSid: result.sid || null,
      receivedAt: new Date(),
    }).returning();

    await tx.insert(usageRecords).values({
      userId,
      service: 'phone',
      action: 'sms_sent',
      quantity: 1,
      metadata: { messageId: msg.id },
    });

    return msg;
  });

  return message;
}

/**
 * Extract verification code from message
 */
export function extractCode(text: string): string | null {
  const patterns = [
    /(?:code|pin|otp|passcode)[:\s]+(\d{4,8})/i,  // "code: 123456", "PIN: 8472"
    /is[:\s]+(\d{4,8})/i,                          // "is 123456"
    /\b(\d{6})\b/,                                 // 6 digits
    /\b(\d{4})\b/,                                 // 4 digits
    /\b(\d{5})\b/,                                 // 5 digits
    /\b(\d{8})\b/,                                 // 8 digits
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}
