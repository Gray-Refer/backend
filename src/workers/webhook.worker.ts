import { Worker } from 'bullmq';
import { redis, rewardQueue } from '../queues/index.js';
import { getActiveShop, upsertUser, createPendingReferral, getUserByReferralCode } from '../services/referral.service.js';
import { markDiscountUsed } from '../services/discount.service.js';
import type { WebhookJobData } from '../queues/index.js';

export function startWebhookWorker() {
  const worker = new Worker<WebhookJobData>(
    'webhooks',
    async (job) => {
      const { topic, shopDomain, payload } = job.data;

      if (topic === 'orders/create') {
        await handleOrderCreate(shopDomain, payload);
      }
      // orders/updated covers refund events via refunds[] array
      if (topic === 'orders/updated') {
        await handleOrderUpdated(shopDomain, payload);
      }
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[webhook-worker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}

// ---------------------------------------------------------------------------
// orders/create
// ---------------------------------------------------------------------------
async function handleOrderCreate(
  shopDomain: string,
  payload: Record<string, unknown>,
) {
  const shop = await getActiveShop(shopDomain);

  const customer = payload.customer as Record<string, unknown> | undefined;
  const email = (customer?.email ?? payload.email) as string | undefined;
  if (!email) return;

  const shopifyCustomerId = customer?.id ? String(customer.id) : undefined;

  // 1. Ensure the purchaser exists as a user (so they can refer later)
  const purchaser = await upsertUser(shop.id, email, shopifyCustomerId);
  void purchaser; // used below if they're the referrer

  // 2. Check if this order was referred
  const noteAttributes = payload.note_attributes as { name: string; value: string }[] | undefined;
  const refCode = noteAttributes?.find(
    (a) => a.name === 'ref' || a.name === 'referral_code',
  )?.value;

  if (!refCode) return;

  const referrer = await getUserByReferralCode(refCode);
  if (!referrer || referrer.shopId !== shop.id) return;

  const orderId = String(payload.id);
  const totalPriceStr = (payload.total_price ?? '0') as string;
  const amountPaise = Math.round(parseFloat(totalPriceStr) * 100);

  let referral;
  try {
    referral = await createPendingReferral({
      referrerId: referrer.id,
      shopId: shop.id,
      referredEmail: email,
      referredOrderId: orderId,
      referredOrderAmountPaise: amountPaise,
      ipAddress: undefined,
    });
  } catch (err) {
    // Self-referral or duplicate — not a fatal error
    console.warn(`[webhook-worker] skipping referral: ${(err as Error).message}`);
    return;
  }

  // 3. Schedule validation job after the shop's delay window
  const delayMs = shop.validationDelayDays * 24 * 60 * 60 * 1000;
  await rewardQueue.add(
    'validate-referral',
    { referralId: referral.id, referrerId: referrer.id },
    { delay: delayMs },
  );

  // 4. Track if a GRAY-REFER coupon was redeemed on this order
  const discountCodes = payload.discount_codes as { code: string }[] | undefined;
  for (const d of discountCodes ?? []) {
    if (d.code.startsWith('REFER-')) {
      await markDiscountUsed(d.code);
    }
  }
}

// ---------------------------------------------------------------------------
// orders/updated — check for refund that would invalidate a referral
// ---------------------------------------------------------------------------
async function handleOrderUpdated(
  shopDomain: string,
  payload: Record<string, unknown>,
) {
  const refunds = payload.refunds as unknown[] | undefined;
  if (!refunds?.length) return;

  const { eq } = await import('drizzle-orm');
  const { db } = await import('../db/index.js');
  const { referrals } = await import('../db/schema.js');

  const orderId = String(payload.id);
  const [referral] = await db
    .select()
    .from(referrals)
    .where(eq(referrals.referredOrderId, orderId))
    .limit(1);

  if (!referral || referral.status !== 'pending') return;

  // Fully refunded order → reject referral
  const totalPrice = parseFloat((payload.total_price ?? '0') as string);
  const totalRefunded = (refunds as { transactions?: { amount: string }[] }[]).reduce(
    (sum, r) =>
      sum +
      (r.transactions ?? []).reduce((s, t) => s + parseFloat(t.amount ?? '0'), 0),
    0,
  );

  if (totalRefunded >= totalPrice) {
    const { rejectReferral } = await import('../services/referral.service.js');
    await rejectReferral(referral.id);
  }
}
