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

import { authMiddleware } from './middleware/auth.js';
import { phoneRoutes } from './routes/phone.js';
import { webhookRoutes } from './routes/webhooks.js';
import { userRoutes } from './routes/users.js';
import { billingRoutes, stripeWebhookHandler } from './routes/billing.js';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Landing page
app.get('/', (c) => {
  try {
    const htmlPath = join(__dirname, 'public', 'index.html');
    const html = readFileSync(htmlPath, 'utf-8');
    return c.html(html);
  } catch (e) {
    console.error('Landing page error:', e);
    return c.json({ name: 'botcall', status: 'ok' });
  }
});

// Dashboard
app.get('/dashboard', (c) => {
  try {
    const htmlPath = join(__dirname, 'public', 'dashboard.html');
    const html = readFileSync(htmlPath, 'utf-8');
    return c.html(html);
  } catch (e) {
    console.error('Dashboard error:', e);
    return c.redirect('/');
  }
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
