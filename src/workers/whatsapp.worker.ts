import { Worker } from 'bullmq';
import { redis } from '../queues/index.js';
import { sendWhatsApp } from '../services/whatsapp/index.js';
import type { WhatsAppMessageJobData } from '../queues/index.js';

export function startWhatsAppWorker() {
  const worker = new Worker<WhatsAppMessageJobData>(
    'whatsapp_messages',
    async (job) => {
      const { shopId, to, message } = job.data;
      await sendWhatsApp(shopId, to, message);
    },
    {
      connection: redis,
      concurrency: 10,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[whatsapp-worker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}
