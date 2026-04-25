import { buildApp } from './app.js';
import { config } from './config.js';
import { startWebhookWorker } from './workers/webhook.worker.js';
import { startRewardWorker } from './workers/reward.worker.js';
import { startWhatsAppWorker } from './workers/whatsapp.worker.js';
import { startNotificationWorker } from './workers/notification.worker.js';

async function main() {
  const app = await buildApp();

  // Start BullMQ workers
  const webhookWorker = startWebhookWorker();
  const rewardWorker = startRewardWorker();
  const whatsappWorker = startWhatsAppWorker();
  const notificationWorker = startNotificationWorker();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal} — shutting down`);
    await Promise.all([
      app.close(),
      webhookWorker.close(),
      rewardWorker.close(),
      whatsappWorker.close(),
      notificationWorker.close(),
    ]);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`GRAY REFER backend listening on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
