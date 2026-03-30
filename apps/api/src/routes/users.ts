import { Hono } from 'hono';
import { createApiKey, listApiKeys, revokeApiKey } from '@botcall/core';
import type { Variables } from '../types.js';

const app = new Hono<{ Variables: Variables }>();

/**
 * GET /v1/users/me
 * Get current user info
 */
app.get('/me', async (c) => {
  const user = c.get('user');

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
  });
});

/**
 * GET /v1/users/me/api-keys
 * List user's API keys
 */
app.get('/me/api-keys', async (c) => {
  const userId = c.get('userId');

  const keys = await listApiKeys(userId);

  return c.json({
    success: true,
    data: keys.map(k => ({
      id: k.id,
      prefix: k.prefix,
      name: k.name,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    })),
  });
});

/**
 * POST /v1/users/me/api-keys
 * Create a new API key
 */
app.post('/me/api-keys', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));

  const result = await createApiKey(userId, body.name || 'Default');

  return c.json({
    success: true,
    data: {
      id: result.id,
      key: result.key, // Only shown once!
      prefix: result.prefix,
      name: result.name,
      createdAt: result.createdAt,
    },
    warning: 'Save this API key - it will not be shown again.',
  }, 201);
});

/**
 * DELETE /v1/users/me/api-keys/:id
 * Revoke an API key
 */
app.delete('/me/api-keys/:id', async (c) => {
  const userId = c.get('userId');
  const keyId = c.req.param('id');

  const deleted = await revokeApiKey(keyId, userId);

  if (!deleted) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'API key not found',
      },
    }, 404);
  }

  return c.json({ success: true });
});

export { app as userRoutes };
