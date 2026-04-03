import { createHash, randomBytes } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { getDb, apiKeys, users, type User } from '@botcall/db';

/**
 * Generate a new API key
 * Returns the full key (only shown once) and the key data
 */
export async function createApiKey(userId: string, name: string = 'Default') {
  const db = getDb();

  // Generate a random key: bs_live_xxxxxxxxxxxxxxxxxxxx
  const randomPart = randomBytes(24).toString('base64url');
  const fullKey = `bs_live_${randomPart}`;
  const keyPrefix = fullKey.slice(0, 12);
  const keyHash = hashApiKey(fullKey);

  const [apiKey] = await db.insert(apiKeys).values({
    userId,
    keyHash,
    keyPrefix,
    name,
  }).returning();

  return {
    key: fullKey, // Only returned once!
    id: apiKey.id,
    prefix: keyPrefix,
    name: apiKey.name,
    createdAt: apiKey.createdAt,
  };
}

/**
 * Validate an API key and return the user
 */
export async function validateApiKey(key: string): Promise<User | null> {
  const db = getDb();

  if (!key.startsWith('bs_live_')) {
    return null;
  }

  const keyHash = hashApiKey(key);

  const result = await db
    .select()
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  // Update last used timestamp
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.keyHash, keyHash));

  return result[0].users;
}

/**
 * List API keys for a user (without revealing the full key)
 */
export async function listApiKeys(userId: string) {
  const db = getDb();

  return db
    .select({
      id: apiKeys.id,
      prefix: apiKeys.keyPrefix,
      name: apiKeys.name,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId));
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyId: string, userId: string) {
  const db = getDb();

  const result = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning();

  return result.length > 0;
}

/**
 * Hash an API key for storage
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
