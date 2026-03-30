import { pgTable, text, timestamp, integer, jsonb, uuid } from 'drizzle-orm/pg-core';

// ============ USERS & AUTH ============

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').unique(),
  email: text('email').notNull().unique(),
  name: text('name'),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  name: text('name').notNull().default('Default'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============ BILLING ============

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull().unique(),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id'),
  plan: text('plan').notNull().default('inactive'), // inactive, starter, pro
  status: text('status').notNull().default('active'), // active, canceled, past_due
  currentPeriodEnd: timestamp('current_period_end'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  service: text('service').notNull(),
  action: text('action').notNull(), // sms_received, sms_sent, number_provisioned
  quantity: integer('quantity').notNull().default(1),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============ PHONE SERVICE ============

export const phoneNumbers = pgTable('phone_numbers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  number: text('number').notNull().unique(), // E.164 format
  provider: text('provider').notNull().default('telnyx'),
  providerSid: text('provider_sid').notNull(),
  capabilities: jsonb('capabilities').notNull().default({ sms: true, voice: true, mms: false }),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const smsMessages = pgTable('sms_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneNumberId: uuid('phone_number_id').references(() => phoneNumbers.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  from: text('from').notNull(),
  to: text('to').notNull(),
  body: text('body').notNull(),
  direction: text('direction').notNull(), // inbound, outbound
  status: text('status').notNull().default('received'),
  providerSid: text('provider_sid'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============ TYPES ============

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;
export type SmsMessage = typeof smsMessages.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
