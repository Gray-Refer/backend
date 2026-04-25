import { Worker } from 'bullmq';
import { redis } from '../queues/index.js';
import { sendNotification } from '../services/notification.js';
import type { NotificationJobData } from '../queues/index.js';

export function startNotificationWorker() {
  const worker = new Worker<NotificationJobData>(
    'notifications',
    async (job) => {
      const { userId, shopId, event, discountCode, rewardValue } = job.data;
      await sendNotification(userId, shopId, event, { discountCode, rewardValue });
    },
    {
      connection: redis,
      concurrency: 10,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[notification-worker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}
