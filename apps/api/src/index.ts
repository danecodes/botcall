import { createServer } from 'http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRequestListener } from '@hono/node-server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Startup env validation ───────────────────────────────────────────────────
// Fail fast before any connections are accepted so Railway keeps the previous
// healthy replica alive during a bad deploy.

const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: 'PostgreSQL connection string',
  CLERK_SECRET_KEY: 'Clerk secret key (sk_live_...)',
  CLERK_WEBHOOK_SECRET: 'Clerk webhook signing secret (whsec_...)',
  STRIPE_SECRET_KEY: 'Stripe secret key (sk_live_...)',
  STRIPE_WEBHOOK_SECRET: 'Stripe webhook signing secret (whsec_...)',
  STRIPE_STARTER_PRICE_ID: 'Stripe price ID for Starter plan',
  STRIPE_PRO_PRICE_ID: 'Stripe price ID for Pro plan',
};

const PROVIDER_ENV: Record<string, Record<string, string>> = {
  signalwire: {
    SIGNALWIRE_SPACE_URL: 'SignalWire space URL (e.g. yourspace.signalwire.com)',
    SIGNALWIRE_PROJECT_ID: 'SignalWire project ID',
    SIGNALWIRE_API_TOKEN: 'SignalWire API token',
  },
  telnyx: {
    TELNYX_API_KEY: 'Telnyx API key',
    TELNYX_MESSAGING_PROFILE_ID: 'Telnyx messaging profile ID',
  },
  twilio: {
    TWILIO_ACCOUNT_SID: 'Twilio account SID',
    TWILIO_AUTH_TOKEN: 'Twilio auth token',
  },
};

function validateEnv() {
  const missing: string[] = [];

  for (const [key, description] of Object.entries(REQUIRED_ENV)) {
    if (!process.env[key]) {
      missing.push(`  ${key}: ${description}`);
    }
  }

  const provider = process.env.SMS_PROVIDER || 'telnyx';
  const providerVars = PROVIDER_ENV[provider];
  if (providerVars) {
    for (const [key, description] of Object.entries(providerVars)) {
      if (!process.env[key]) {
        missing.push(`  ${key}: ${description} (required for SMS_PROVIDER=${provider})`);
      }
    }
  }

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(m => console.error(m));
    console.error('\nSet these variables in Railway before deploying.');
    process.exit(1);
  }

  console.log(`✅ Environment validated (SMS_PROVIDER=${provider})`);
}

// Only validate in production — dev may run with partial env
if (process.env.NODE_ENV === 'production') {
  validateEnv();
}

// ── App ──────────────────────────────────────────────────────────────────────

import { authMiddleware } from './middleware/auth.js';
import { phoneRoutes } from './routes/phone.js';
import { webhookRoutes } from './routes/webhooks.js';
import { userRoutes } from './routes/users.js';
import { billingRoutes, stripeWebhookHandler } from './routes/billing.js';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://botcall.io', 'https://www.botcall.io']
    : '*',
}));

// Liveness probe (always succeeds — process is alive)
app.get('/health', (c) => c.json({ status: 'ok' }));

// Readiness probe (checks DB connectivity — used for Railway deploy health gate)
app.get('/health/ready', async (c) => {
  try {
    const { getDb } = await import('@botcall/db');
    const db = getDb();
    await db.execute('SELECT 1' as any);
    return c.json({ status: 'ready' });
  } catch (error) {
    console.error('Readiness check failed:', error);
    return c.json({ status: 'not ready', error: (error as Error).message }, 503);
  }
});

// Static HTML cache — read once at startup, serve from memory
const htmlCache = new Map<string, string>();
function serveHtml(file: string): string | null {
  if (!htmlCache.has(file)) {
    try {
      htmlCache.set(file, readFileSync(join(__dirname, 'public', file), 'utf-8'));
    } catch {
      return null;
    }
  }
  return htmlCache.get(file)!;
}

app.get('/', (c) => {
  const html = serveHtml('index.html');
  return html ? c.html(html) : c.json({ name: 'botcall', status: 'ok' });
});

app.get('/dashboard', (c) => {
  const html = serveHtml('dashboard.html');
  return html ? c.html(html) : c.redirect('/');
});

app.get('/terms', (c) => {
  const html = serveHtml('terms.html');
  return html ? c.html(html) : c.redirect('/');
});

app.get('/privacy', (c) => {
  const html = serveHtml('privacy.html');
  return html ? c.html(html) : c.redirect('/');
});

// Install script
app.get('/install.sh', (c) => {
  try {
    const scriptPath = join(__dirname, 'public', 'install.sh');
    const script = readFileSync(scriptPath, 'utf-8');
    return c.text(script);
  } catch (e) {
    console.error('Install script error:', e);
    return c.text('# Error: install script not found', 404);
  }
});

// Public routes (webhooks don't need auth)
app.route('/webhooks', webhookRoutes);
app.route('/webhooks', stripeWebhookHandler);

// Protected routes
app.use('/v1/*', authMiddleware);
app.route('/v1/phone', phoneRoutes);
app.route('/v1/users', userRoutes);
app.route('/v1/billing', billingRoutes);

// Error handling
app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
    },
  }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested endpoint does not exist',
    },
  }, 404);
});

const port = parseInt(process.env.PORT || '3000', 10);

console.log(`🚀 botcall API starting on port ${port}`);

const server = createServer(getRequestListener(app.fetch));

server.listen(port, () => {
  console.log(`✅ Server listening on http://localhost:${port}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});
