import { Hono } from 'hono';
import * as phoneService from '@botcall/phone';
import { checkUsageLimit } from '@botcall/core';
import type { Variables } from '../types.js';

const app = new Hono<{ Variables: Variables }>();

// Simple per-user poll concurrency guard (single instance — sufficient for Railway single-process)
const activePollers = new Set<string>();

/**
 * GET /v1/phone/numbers
 * List user's phone numbers
 */
app.get('/numbers', async (c) => {
  const userId = c.get('userId');

  const numbers = await phoneService.listNumbers(userId);

  return c.json({
    success: true,
    data: numbers.map(n => ({
      id: n.id,
      number: n.number,
      capabilities: n.capabilities,
      status: n.status,
      createdAt: n.createdAt,
    })),
  });
});

/**
 * POST /v1/phone/numbers
 * Provision a new phone number
 */
app.post('/numbers', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();

  // Check usage limits
  const limitCheck = await checkUsageLimit(userId, 'provision');
  if (!limitCheck.allowed) {
    return c.json({
      success: false,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: limitCheck.reason,
      },
    }, 403);
  }

  try {
    const number = await phoneService.provisionNumber(userId, {
      areaCode: body.areaCode,
      country: body.country,
    });

    return c.json({
      success: true,
      data: {
        id: number.id,
        number: number.number,
        capabilities: number.capabilities,
        status: number.status,
        createdAt: number.createdAt,
      },
    }, 201);
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'PROVISION_FAILED',
        message: (error as Error).message,
      },
    }, 400);
  }
});

/**
 * DELETE /v1/phone/numbers/:id
 * Release a phone number
 */
app.delete('/numbers/:id', async (c) => {
  const userId = c.get('userId');
  const numberId = c.req.param('id');

  try {
    await phoneService.releaseNumber(userId, numberId);
    return c.json({ success: true });
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'RELEASE_FAILED',
        message: (error as Error).message,
      },
    }, 400);
  }
});

/**
 * GET /v1/phone/messages
 * Get user's messages
 */
app.get('/messages', async (c) => {
  const userId = c.get('userId');
  const limitParam = parseInt(c.req.query('limit') || '50', 10);
  const limit = isNaN(limitParam) ? 50 : Math.min(limitParam, 100);
  const phoneNumberId = c.req.query('numberId');

  const messages = await phoneService.getMessages(userId, { limit, phoneNumberId });

  return c.json({
    success: true,
    data: messages.map(m => ({
      id: m.id,
      from: m.from,
      to: m.to,
      body: m.body,
      direction: m.direction,
      status: m.status,
      receivedAt: m.receivedAt,
      code: phoneService.extractCode(m.body), // Auto-extract code
    })),
  });
});

/**
 * POST /v1/phone/messages
 * Send an SMS
 */
app.post('/messages', async (c) => {
  const userId = c.get('userId');

  // Check subscription is active before sending (costs real money)
  const limitCheck = await checkUsageLimit(userId, 'send_sms');
  if (!limitCheck.allowed) {
    return c.json({
      success: false,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: limitCheck.reason,
      },
    }, 403);
  }

  const body = await c.req.json();

  if (!body.to || !body.body) {
    return c.json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Missing required fields: to, body',
      },
    }, 400);
  }

  try {
    const message = await phoneService.sendSms(userId, body.to, body.body, body.fromNumberId);

    return c.json({
      success: true,
      data: {
        id: message.id,
        from: message.from,
        to: message.to,
        body: message.body,
        status: message.status,
      },
    }, 201);
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'SEND_FAILED',
        message: (error as Error).message,
      },
    }, 400);
  }
});

/**
 * GET /v1/phone/messages/poll
 * Long-poll for new messages (for get-code functionality)
 */
app.get('/messages/poll', async (c) => {
  const userId = c.get('userId');

  const timeoutParam = parseInt(c.req.query('timeout') || '30', 10);
  const timeoutSecs = isNaN(timeoutParam) ? 30 : timeoutParam;
  const since = c.req.query('since'); // ISO timestamp

  const limitCheck = await checkUsageLimit(userId, 'receive_sms');
  if (!limitCheck.allowed) {
    return c.json({
      success: false,
      error: { code: 'LIMIT_EXCEEDED', message: limitCheck.reason },
    }, 403);
  }

  // One concurrent poll per user — prevents DB pool exhaustion
  if (activePollers.has(userId)) {
    return c.json({
      success: false,
      error: { code: 'POLL_CONFLICT', message: 'Another poll is already active for this account' },
    }, 429);
  }

  const numberId = c.req.query('numberId');
  const startTime = Date.now();
  const timeoutMs = Math.min(timeoutSecs, 30) * 1000; // Max 30 seconds

  activePollers.add(userId);
  try {
    while (Date.now() - startTime < timeoutMs) {
      // Push since filter into DB query instead of filtering in memory
      const messages = await phoneService.getMessages(userId, {
        limit: 50,
        phoneNumberId: numberId,
        since,
      });

      if (messages.length > 0) {
        const latest = messages[0];
        const code = phoneService.extractCode(latest.body);

        return c.json({
          success: true,
          data: {
            message: {
              id: latest.id,
              from: latest.from,
              to: latest.to,
              body: latest.body,
              receivedAt: latest.receivedAt,
            },
            code, // null if no code found
          },
        });
      }

      // Wait 2 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally {
    activePollers.delete(userId);
  }

  return c.json({
    success: false,
    error: {
      code: 'TIMEOUT',
      message: 'No new messages received within timeout',
    },
  }, 408);
});

export { app as phoneRoutes };
