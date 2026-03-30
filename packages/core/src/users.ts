import { eq } from 'drizzle-orm';
import { getDb, users, subscriptions, type User } from '@botcall/db';

/**
 * Create a new user from Clerk data
 */
export async function createUserFromClerk(data: {
  clerkId: string;
  email: string;
  name?: string;
  imageUrl?: string;
}): Promise<User> {
  const db = getDb();

  const [user] = await db.insert(users).values({
    clerkId: data.clerkId,
    email: data.email.toLowerCase(),
    name: data.name || null,
    imageUrl: data.imageUrl || null,
  }).returning();

  // Create inactive subscription (becomes active after Stripe checkout)
  await db.insert(subscriptions).values({
    userId: user.id,
    stripeCustomerId: '',
    plan: 'inactive',
    status: 'active',
  });

  return user;
}

/**
 * Get user by Clerk ID
 */
export async function getUserByClerkId(clerkId: string): Promise<User | null> {
  const db = getDb();

  const result = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getDb();

  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  return result[0] || null;
}

/**
 * Get user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  const db = getDb();

  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return result[0] || null;
}

/**
 * Update user from Clerk data
 */
export async function updateUserFromClerk(clerkId: string, data: {
  email?: string;
  name?: string;
  imageUrl?: string;
}): Promise<User | null> {
  const db = getDb();

  const [user] = await db.update(users)
    .set({
      ...(data.email && { email: data.email.toLowerCase() }),
      ...(data.name !== undefined && { name: data.name }),
      ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, clerkId))
    .returning();

  return user || null;
}

/**
 * Delete user by Clerk ID
 */
export async function deleteUserByClerkId(clerkId: string): Promise<boolean> {
  const db = getDb();

  const result = await db.delete(users)
    .where(eq(users.clerkId, clerkId))
    .returning();

  return result.length > 0;
}
