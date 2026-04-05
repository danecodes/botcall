import { Context, Next } from 'hono';
import { verifyToken, createClerkClient } from '@clerk/backend';
import { validateApiKey, getUserByClerkId, getUserByEmail, createUserFromClerk, createApiKey } from '@botcall/core';
import { getDb, users, eq } from '@botcall/db';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing Authorization header',
      },
    }, 401);
  }

  // Support both "Bearer <key>" and just "<key>"
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  // Try API key first
  if (token.startsWith('bs_live_')) {
    const user = await validateApiKey(token);

    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
      }, 401);
    }

    c.set('user', user);
    c.set('userId', user.id);
    c.set('authMethod', 'apiKey');

    await next();
    return;
  }

  // Try Clerk JWT
  try {
    // @clerk/backend v3 requires authorizedParties when the JWT has an azp claim.
    // Without it, verifyToken throws "Invalid JWT Authorized party claim (azp)".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
      authorizedParties: ['botcall.io', 'https://botcall.io'],
    }) as any;

    const sub: string | undefined = payload?.sub ?? payload?.data?.sub;

    if (!sub) {
      throw new Error('No subject in token');
    }

    // Get user from our database by Clerk ID
    let user = await getUserByClerkId(sub);

    // Just-in-time provisioning: if Clerk token is valid but no DB row exists
    if (!user) {
      try {
        const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
        const clerkUser = await clerk.users.getUser(sub);
        const primaryEmail = clerkUser.emailAddresses.find(
          e => e.id === clerkUser.primaryEmailAddressId
        )?.emailAddress || clerkUser.emailAddresses[0]?.emailAddress;

        if (primaryEmail) {
          const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || undefined;

          const existing = await getUserByEmail(primaryEmail);
          if (existing) {
            await getDb().update(users).set({ clerkId: clerkUser.id }).where(eq(users.id, existing.id));
            user = { ...existing, clerkId: clerkUser.id };
            console.log(`✅ JIT linked clerkId to existing user ${user.id} (${primaryEmail})`);
          } else {
            user = await createUserFromClerk({ clerkId: clerkUser.id, email: primaryEmail, name, imageUrl: clerkUser.imageUrl || undefined });
            await createApiKey(user.id, 'Default');
            console.log(`✅ JIT provisioned user ${user.id} (${primaryEmail})`);
          }
        }
      } catch (provisionErr) {
        console.error('JIT provisioning failed:', provisionErr);
      }

      if (!user) {
        return c.json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found. Please sign up first.' },
        }, 404);
      }
    }

    c.set('user', user);
    c.set('userId', user.id);
    c.set('authMethod', 'clerk');

    await next();
  } catch (err) {
    console.error('Auth error:', (err as any)?.reason || (err as any)?.message || err);
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid token',
      },
    }, 401);
  }
}
