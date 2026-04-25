import { eq, and, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, rewards, shops } from '../db/schema.js';
import type { Reward } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Check if a user has hit the referral threshold; if so, unlock a reward.
// Each threshold crossing unlocks exactly one reward (tier-based).
// Returns the newly unlocked Reward or null if threshold not yet reached.
// ---------------------------------------------------------------------------
export async function checkAndUnlockReward(userId: string): Promise<Reward | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User ${userId} not found`);

  const [shop] = await db.select().from(shops).where(eq(shops.id, user.shopId)).limit(1);
  if (!shop) throw new Error(`Shop ${user.shopId} not found`);

  const approvedCount = user.referralCount;
  if (approvedCount < shop.referralThreshold) return null;

  const tier = Math.floor(approvedCount / shop.referralThreshold);

  // Count existing rewards for this user to determine current tier
  const [{ value: issuedCount }] = await db
    .select({ value: count() })
    .from(rewards)
    .where(and(eq(rewards.userId, userId), eq(rewards.shopId, user.shopId)));

  if (issuedCount >= tier) return null; // already issued for this tier

  const [reward] = await db
    .insert(rewards)
    .values({
      userId,
      shopId: user.shopId,
      type: 'discount',
      value: shop.rewardValue,
      status: 'unlocked',
      unlockedAt: new Date(),
    })
    .returning();

  return reward!;
}

// ---------------------------------------------------------------------------
// Mark a reward as redeemed (called when Shopify confirms coupon used)
// ---------------------------------------------------------------------------
export async function markRewardRedeemed(rewardId: string): Promise<void> {
  await db
    .update(rewards)
    .set({ status: 'redeemed', redeemedAt: new Date() })
    .where(eq(rewards.id, rewardId));
}

// ---------------------------------------------------------------------------
// Fetch all rewards for a user (for the customer dashboard)
// ---------------------------------------------------------------------------
export async function getUserRewards(userId: string): Promise<Reward[]> {
  return db.select().from(rewards).where(eq(rewards.userId, userId));
}
