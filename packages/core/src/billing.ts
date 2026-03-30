import Stripe from 'stripe';
import { eq, and, gte, sql } from 'drizzle-orm';
import { getDb, subscriptions, usageRecords, users, phoneNumbers } from '@botcall/db';

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not set');
    stripe = new Stripe(key);
  }
  return stripe;
}

// Plan limits
export const PLAN_LIMITS = {
  inactive: { phoneNumbers: 0, smsPerMonth: 0 },
  starter: { phoneNumbers: 1, smsPerMonth: 100 },
  pro: { phoneNumbers: 5, smsPerMonth: 500 },
};

// Plan definitions - price IDs read at runtime
export function getPlans() {
  return {
    starter: {
      name: 'Starter',
      price: 900, // $9 in cents
      priceId: process.env.STRIPE_STARTER_PRICE_ID || null,
      limits: PLAN_LIMITS.starter,
    },
    pro: {
      name: 'Pro',
      price: 2900, // $29 in cents
      priceId: process.env.STRIPE_PRO_PRICE_ID || null,
      limits: PLAN_LIMITS.pro,
    },
  };
}

// For backwards compat
export const PLANS = getPlans();

export type PlanId = 'inactive' | 'starter' | 'pro';

// Normalize legacy 'free' DB value to 'inactive'
function normalizePlan(plan: string | null | undefined): PlanId {
  if (!plan || plan === 'free') return 'inactive';
  return plan as PlanId;
}

/**
 * Create a Stripe checkout session for subscription
 */
export async function createCheckoutSession(userId: string, planId: 'starter' | 'pro', returnUrl: string): Promise<string> {
  const db = getDb();
  const s = getStripe();

  const plans = getPlans();
  const plan = plans[planId];
  if (!plan.priceId) throw new Error(`Invalid plan or missing price ID for ${planId}. STRIPE_STARTER_PRICE_ID=${process.env.STRIPE_STARTER_PRICE_ID}, STRIPE_PRO_PRICE_ID=${process.env.STRIPE_PRO_PRICE_ID}`);

  // Get or create Stripe customer
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  let customerId = sub?.stripeCustomerId;

  if (!customerId) {
    const customer = await s.customers.create({
      email: user.email,
      metadata: { userId },
    });
    customerId = customer.id;

    await db.insert(subscriptions)
      .values({ userId, stripeCustomerId: customerId, plan: 'inactive', status: 'active' })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: { stripeCustomerId: customerId },
      });
  }

  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: plan.priceId, quantity: 1 }],
    success_url: `${returnUrl}?success=true`,
    cancel_url: `${returnUrl}?canceled=true`,
    metadata: { userId, planId },
  });

  return session.url!;
}

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(payload: string, signature: string): Promise<void> {
  const s = getStripe();
  const db = getDb();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

  const event = s.webhooks.constructEvent(payload, signature, webhookSecret);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const planId = session.metadata?.planId as PlanId;

      if (userId && planId) {
        await db.update(subscriptions).set({
          stripeSubscriptionId: session.subscription as string,
          plan: planId,
          status: 'active',
        }).where(eq(subscriptions.userId, userId));
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const status = subscription.status === 'active' ? 'active'
        : subscription.status === 'past_due' ? 'past_due'
        : 'canceled';

      const periodEnd = (subscription as unknown as { current_period_end: number }).current_period_end;

      await db.update(subscriptions).set({
        status,
        currentPeriodEnd: new Date(periodEnd * 1000),
      }).where(eq(subscriptions.stripeCustomerId, customerId));
      break;
    }
  }
}

/**
 * Get user's current plan and usage
 */
export async function getUserPlanAndUsage(userId: string): Promise<{
  plan: PlanId;
  status: string;
  limits: { phoneNumbers: number; smsPerMonth: number };
  usage: { phoneNumbers: number; smsThisMonth: number };
  canProvision: boolean;
  canReceiveSms: boolean;
}> {
  const db = getDb();

  // Get subscription
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const plan = normalizePlan(sub?.plan);
  const limits = PLAN_LIMITS[plan];

  // Get current phone number count
  const phoneCountResult = await db.select({ count: sql<number>`COUNT(*)` })
    .from(phoneNumbers)
    .where(and(
      eq(phoneNumbers.userId, userId),
      eq(phoneNumbers.status, 'active')
    ));
  const phoneNumberCount = Number(phoneCountResult[0]?.count || 0);

  // Get SMS received this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const smsCount = await db.select({ count: sql<number>`COALESCE(SUM(quantity), 0)` })
    .from(usageRecords)
    .where(and(
      eq(usageRecords.userId, userId),
      eq(usageRecords.action, 'sms_received'),
      gte(usageRecords.createdAt, startOfMonth)
    ));
  const smsThisMonth = Number(smsCount[0]?.count || 0);

  return {
    plan,
    status: sub?.status ?? 'none',
    limits,
    usage: { phoneNumbers: phoneNumberCount, smsThisMonth },
    canProvision: phoneNumberCount < limits.phoneNumbers,
    canReceiveSms: smsThisMonth < limits.smsPerMonth,
  };
}

/**
 * Check if user can perform an action
 */
export async function checkUsageLimit(userId: string, action: 'provision' | 'receive_sms'): Promise<{ allowed: boolean; reason?: string }> {
  const usage = await getUserPlanAndUsage(userId);
  const { plan, status, limits, canProvision, canReceiveSms } = usage;

  if (plan === 'inactive') {
    return { allowed: false, reason: 'No active subscription. Please subscribe to a plan.' };
  }

  if (status === 'canceled' || status === 'past_due') {
    return { allowed: false, reason: 'Subscription is not active. Please update your billing.' };
  }

  if (action === 'provision' && !canProvision) {
    return { allowed: false, reason: `Phone number limit reached (${limits.phoneNumbers}). Upgrade your plan.` };
  }

  if (action === 'receive_sms' && !canReceiveSms) {
    return { allowed: false, reason: `Monthly SMS limit reached (${limits.smsPerMonth}). Upgrade your plan.` };
  }

  return { allowed: true };
}

/**
 * Create a billing portal session for managing subscription
 */
export async function createPortalSession(userId: string, returnUrl: string): Promise<string> {
  const db = getDb();
  const s = getStripe();

  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  if (!sub?.stripeCustomerId) throw new Error('No billing account');

  const session = await s.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}
