import { customAlphabet } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { discounts, rewards, shops, users } from '../db/schema.js';
import { createShopifyDiscountCode } from './shopify.js';
import type { Discount } from '../db/schema.js';

const generateSuffix = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', 6);

// ---------------------------------------------------------------------------
// Generate a Shopify discount code for an unlocked reward and persist it
// ---------------------------------------------------------------------------
export async function generateDiscountForReward(rewardId: string): Promise<Discount> {
  const [reward] = await db.select().from(rewards).where(eq(rewards.id, rewardId)).limit(1);
  if (!reward) throw new Error(`Reward ${rewardId} not found`);
  if (reward.status !== 'unlocked') throw new Error(`Reward ${rewardId} is not unlocked`);

  // Idempotency: return existing discount if already generated
  const [existing] = await db
    .select()
    .from(discounts)
    .where(eq(discounts.rewardId, rewardId))
    .limit(1);
  if (existing) return existing;

  const [shop] = await db.select().from(shops).where(eq(shops.id, reward.shopId)).limit(1);
  if (!shop) throw new Error(`Shop ${reward.shopId} not found`);

  const [user] = await db.select().from(users).where(eq(users.id, reward.userId)).limit(1);
  if (!user) throw new Error(`User ${reward.userId} not found`);

  const code = `REFER-${generateSuffix()}`;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

  const { discountId } = await createShopifyDiscountCode(
    shop.domain,
    shop.accessToken,
    code,
    reward.value,
    expiresAt,
  );

  const [discount] = await db
    .insert(discounts)
    .values({
      rewardId,
      userId: reward.userId,
      shopId: reward.shopId,
      code,
      shopifyDiscountId: discountId,
      value: reward.value,
      status: 'active',
      expiresAt,
    })
    .returning();

  return discount!;
}

// ---------------------------------------------------------------------------
// Mark a discount code as used (webhook: orders/create with discount applied)
// ---------------------------------------------------------------------------
export async function markDiscountUsed(code: string): Promise<void> {
  const [discount] = await db
    .select()
    .from(discounts)
    .where(eq(discounts.code, code))
    .limit(1);

  if (!discount || discount.status !== 'active') return;

  await db
    .update(discounts)
    .set({ status: 'used', usedAt: new Date() })
    .where(eq(discounts.id, discount.id));
}
