import { Worker } from 'bullmq';
import { redis, notificationQueue } from '../queues/index.js';
import { approveReferral } from '../services/referral.service.js';
import { checkAndUnlockReward } from '../services/reward.service.js';
import { generateDiscountForReward } from '../services/discount.service.js';
import type { ValidateReferralJobData } from '../queues/index.js';

export function startRewardWorker() {
  const worker = new Worker<ValidateReferralJobData>(
    'rewards',
    async (job) => {
      const { referralId, referrerId } = job.data;

      // 1. Approve the referral (increments referral_count atomically)
      const referral = await approveReferral(referralId);
      if (referral.status !== 'approved') {
        // Already rejected (e.g. refund came in) — nothing to do
        return;
      }

      // 2. Check if referrer has hit the milestone threshold
      const reward = await checkAndUnlockReward(referrerId);
      if (!reward) return;

      // 3. Generate a Shopify discount code and persist it
      const discount = await generateDiscountForReward(reward.id);

      console.info(
        `[reward-worker] Unlocked reward ${reward.id} → discount code ${discount.code} for user ${referrerId}`,
      );

      // Queue REWARD_UNLOCKED notification (WhatsApp-first, email fallback)
      await notificationQueue
        .add('reward-unlocked', {
          userId: referrerId,
          shopId: reward.shopId,
          event: 'REWARD_UNLOCKED',
          discountCode: discount.code,
          rewardValue: reward.value,
        })
        .catch(() => { /* non-fatal */ });
    },
    {
      connection: redis,
      concurrency: 3,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[reward-worker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}
