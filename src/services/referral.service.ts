import { eq, and, sql } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { db } from '../db/index.js';
import { users, referrals, shops } from '../db/schema.js';
import type { User, Referral } from '../db/schema.js';

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 10);

// ---------------------------------------------------------------------------
// Resolve shop by domain — throws if not found / inactive
// ---------------------------------------------------------------------------
export async function getActiveShop(shopDomain: string) {
  const [shop] = await db
    .select()
    .from(shops)
    .where(and(eq(shops.domain, shopDomain), eq(shops.isActive, true)))
    .limit(1);

  if (!shop) throw new Error(`Shop not found or inactive: ${shopDomain}`);
  return shop;
}

// ---------------------------------------------------------------------------
// Create or fetch user for a shop + email pair
// ---------------------------------------------------------------------------
export async function upsertUser(
  shopId: string,
  email: string,
  shopifyCustomerId?: string,
  phone?: string,
): Promise<User> {
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.shopId, shopId), eq(users.email, email)))
    .limit(1);

  if (existing) {
    const needsUpdate =
      (shopifyCustomerId && existing.shopifyCustomerId !== shopifyCustomerId) ||
      (phone && existing.phone !== phone);

    if (needsUpdate) {
      const [updated] = await db
        .update(users)
        .set({
          ...(shopifyCustomerId ? { shopifyCustomerId } : {}),
          ...(phone ? { phone } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated!;
    }
    return existing;
  }

  const [created] = await db
    .insert(users)
    .values({
      shopId,
      email,
      shopifyCustomerId,
      phone,
      referralCode: generateCode(),
    })
    .returning();

  return created!;
}

// ---------------------------------------------------------------------------
// Get user by referral code
// ---------------------------------------------------------------------------
export async function getUserByReferralCode(code: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.referralCode, code))
    .limit(1);

  return user ?? null;
}

// ---------------------------------------------------------------------------
// Create a pending referral record
// ---------------------------------------------------------------------------
export interface TrackReferralInput {
  referrerId: string;
  shopId: string;
  referredEmail: string;
  referredOrderId: string;
  referredOrderAmountPaise: number;
  ipAddress?: string;
}

export async function createPendingReferral(input: TrackReferralInput): Promise<Referral> {
  // Guard: no self-referral
  const [referrer] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.referrerId))
    .limit(1);

  if (referrer?.email === input.referredEmail) {
    throw new Error('Self-referral detected');
  }

  // Guard: same order can't be attributed twice
  const [existingReferral] = await db
    .select()
    .from(referrals)
    .where(eq(referrals.referredOrderId, input.referredOrderId))
    .limit(1);

  if (existingReferral) {
    throw new Error(`Order ${input.referredOrderId} already attributed`);
  }

  const [referral] = await db
    .insert(referrals)
    .values({
      referrerId: input.referrerId,
      shopId: input.shopId,
      referredEmail: input.referredEmail,
      referredOrderId: input.referredOrderId,
      referredOrderAmount: input.referredOrderAmountPaise,
      ipAddress: input.ipAddress ?? null,
      status: 'pending',
    })
    .returning();

  return referral!;
}

// ---------------------------------------------------------------------------
// Approve a referral and atomically increment referrer's count
// ---------------------------------------------------------------------------
export async function approveReferral(referralId: string): Promise<Referral> {
  const [referral] = await db
    .select()
    .from(referrals)
    .where(eq(referrals.id, referralId))
    .limit(1);

  if (!referral) throw new Error(`Referral ${referralId} not found`);
  if (referral.status !== 'pending') return referral;

  const [updated] = await db.transaction(async (tx: typeof db) => {
    const [updated] = await tx
      .update(referrals)
      .set({ status: 'approved', validatedAt: new Date() })
      .where(eq(referrals.id, referralId))
      .returning();

    await tx
      .update(users)
      .set({
        referralCount: sql`${users.referralCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, referral.referrerId));

    return [updated!];
  });

  return updated!;
}

// ---------------------------------------------------------------------------
// Reject a referral (refund / fraud)
// ---------------------------------------------------------------------------
export async function rejectReferral(referralId: string): Promise<void> {
  await db
    .update(referrals)
    .set({ status: 'rejected', validatedAt: new Date() })
    .where(eq(referrals.id, referralId));
}

// ---------------------------------------------------------------------------
// Get current referral progress for a user
// ---------------------------------------------------------------------------
export async function getReferralProgress(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User ${userId} not found`);

  const [shop] = await db.select().from(shops).where(eq(shops.id, user.shopId)).limit(1);
  const threshold = shop?.referralThreshold ?? 10;
  const rewardValue = shop?.rewardValue ?? 1000;

  return {
    user,
    referralCount: user.referralCount,
    threshold,
    rewardValue,
    progressPercent: Math.min(100, Math.floor((user.referralCount / threshold) * 100)),
    referralLink: `${process.env.FRONTEND_URL}/r/${user.referralCode}`,
  };
}
