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
// Queue: send WhatsApp messages via the shop's connected provider
// ---------------------------------------------------------------------------
export interface WhatsAppMessageJobData {
  shopId: string;
  to: string;      // E.164 phone number, e.g. "+919876543210"
  message: string;
  event: 'POST_PURCHASE' | 'REFERRAL_LINK_CREATED' | 'REWARD_UNLOCKED';
}

export const whatsappQueue = new Queue<WhatsAppMessageJobData>('whatsapp_messages', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

// ---------------------------------------------------------------------------
// Queue: unified notification delivery (WhatsApp-first, email fallback)
// ---------------------------------------------------------------------------
export interface NotificationJobData {
  userId: string;
  shopId: string;
  event: 'POST_PURCHASE' | 'REWARD_UNLOCKED';
  discountCode?: string;
  rewardValue?: number;
}

export const notificationQueue = new Queue<NotificationJobData>('notifications', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
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
