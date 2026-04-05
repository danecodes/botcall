import { Hono } from 'hono';
import { createCheckoutSession, createPortalSession, upgradeSubscription, getUserPlanAndUsage, handleStripeWebhook, PLANS } from '@botcall/core';
import type { Variables } from '../types.js';

const app = new Hono<{ Variables: Variables }>();

/**
 * GET /v1/billing/plans
 * List available plans
 */
app.get('/plans', (c) => {
  return c.json({
    success: true,
    data: {
      starter: {
        name: PLANS.starter.name,
        price: PLANS.starter.price / 100,
        limits: PLANS.starter.limits,
      },
      pro: {
        name: PLANS.pro.name,
        price: PLANS.pro.price / 100,
        limits: PLANS.pro.limits,
      },
    },
  });
});

/**
 * GET /v1/billing/usage
 * Get current plan and usage
 */
app.get('/usage', async (c) => {
  const userId = c.get('userId');

  const data = await getUserPlanAndUsage(userId);

  return c.json({
    success: true,
    data,
  });
});

/**
 * POST /v1/billing/checkout
 * Create checkout session for a plan
 */
app.post('/checkout', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const planId = body.plan;

  if (!planId || !['starter', 'pro'].includes(planId)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_PLAN', message: 'Plan must be starter or pro' },
    }, 400);
  }

  const returnUrl = body.returnUrl || 'https://botcall.io';

  try {
    const url = await createCheckoutSession(userId, planId, returnUrl);
    return c.json({ success: true, data: { url } });
  } catch (error) {
    return c.json({
      success: false,
      error: { code: 'CHECKOUT_FAILED', message: (error as Error).message },
    }, 500);
  }
});

/**
 * POST /v1/billing/upgrade
 * Upgrade existing subscription to a higher plan (avoids duplicate subscriptions)
 */
app.post('/upgrade', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const planId = body.plan;

  if (planId !== 'pro') {
    return c.json({
      success: false,
      error: { code: 'INVALID_PLAN', message: 'Only upgrades to pro are supported' },
    }, 400);
  }

  try {
    await upgradeSubscription(userId, planId);
    return c.json({ success: true });
  } catch (error) {
    return c.json({
      success: false,
      error: { code: 'UPGRADE_FAILED', message: (error as Error).message },
    }, 500);
  }
});

/**
 * POST /v1/billing/portal
 * Create billing portal session
 */
app.post('/portal', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const returnUrl = body.returnUrl || 'https://botcall.io';

  try {
    const url = await createPortalSession(userId, returnUrl);
    return c.json({ success: true, data: { url } });
  } catch (error) {
    return c.json({
      success: false,
      error: { code: 'PORTAL_FAILED', message: (error as Error).message },
    }, 500);
  }
});

export { app as billingRoutes };

// Webhook handler (not authenticated)
export const stripeWebhookHandler = new Hono();

stripeWebhookHandler.post('/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400);
  }

  let payload: string;
  try {
    payload = await c.req.text();
  } catch (error) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  try {
    await handleStripeWebhook(payload, signature);
    return c.json({ received: true });
  } catch (error: any) {
    console.error('Stripe webhook error:', error);
    // Signature verification errors → 400 (don't retry)
    // Processing errors (DB, network) → 500 (Stripe retries)
    const isSignatureError = error?.type === 'StripeSignatureVerificationError'
      || error?.message?.includes('signature');
    return c.json({ error: 'Webhook failed' }, isSignatureError ? 400 : 500);
  }
});
