import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
});

// ---------------------------------------------------------------------------
// Queue: process incoming Shopify webhooks
// ---------------------------------------------------------------------------
export interface WebhookJobData {
  topic: string;       // e.g. "orders/create"
  shopDomain: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}

export const webhookQueue = new Queue<WebhookJobData>('webhooks', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

// ---------------------------------------------------------------------------
// Queue: validate a referral after the delay window has passed
// ---------------------------------------------------------------------------
export interface ValidateReferralJobData {
  referralId: string;
  referrerId: string;
}

export const rewardQueue = new Queue<ValidateReferralJobData>('rewards', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});
