import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getReferralProgress, getUserByReferralCode } from '../services/referral.service.js';
import { getUserRewards } from '../services/reward.service.js';
import { db } from '../db/index.js';
import { discounts, referralClicks } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const referralRoute: FastifyPluginAsync = async (fastify) => {

  // GET /referral/code/:code?src=whatsapp — resolve referral code + log the click
  fastify.get<{
    Params: { code: string };
    Querystring: { src?: string };
  }>(
    '/referral/code/:code',
    async (req, reply) => {
      const user = await getUserByReferralCode(req.params.code);
      if (!user) return reply.status(404).send({ error: 'Invalid referral code' });

      const validSources = ['whatsapp', 'email', 'direct'] as const;
      type Source = typeof validSources[number];
      const rawSrc = req.query.src ?? 'direct';
      const source: Source | 'unknown' = (validSources as readonly string[]).includes(rawSrc)
        ? (rawSrc as Source)
        : 'unknown';

      // Fire-and-forget — never block the redirect on a logging failure
      db.insert(referralClicks)
        .values({ shopId: user.shopId, referralCode: user.referralCode, source })
        .catch(() => { /* non-fatal */ });

      return {
        referralCode: user.referralCode,
        shopId: user.shopId,
      };
    },
  );

  // GET /referral/progress/:userId — full progress for customer dashboard
  fastify.get<{ Params: { userId: string } }>(
    '/referral/progress/:userId',
    async (req, reply) => {
      try {
        const progress = await getReferralProgress(req.params.userId);
        const rewards = await getUserRewards(req.params.userId);

        const userDiscounts = await db
          .select()
          .from(discounts)
          .where(eq(discounts.userId, req.params.userId));

        return {
          ...progress,
          rewards,
          discounts: userDiscounts,
        };
      } catch (err) {
        return reply.status(404).send({ error: (err as Error).message });
      }
    },
  );

  // POST /referral/register — called after a purchase to register the purchaser
  // (also called by the Shopify webhook, but this allows direct calls from a theme)
  const RegisterSchema = z.object({
    shopDomain: z.string().min(1),
    email: z.string().email(),
    shopifyCustomerId: z.string().optional(),
  });

  fastify.post('/referral/register', async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { shopDomain, email, shopifyCustomerId } = parsed.data;

    const { getActiveShop, upsertUser } = await import('../services/referral.service.js');
    const shop = await getActiveShop(shopDomain).catch(() => null);
    if (!shop) return reply.status(404).send({ error: 'Shop not found' });

    const user = await upsertUser(shop.id, email, shopifyCustomerId);
    const progress = await getReferralProgress(user.id);

    return {
      userId: user.id,
      referralCode: user.referralCode,
      referralLink: progress.referralLink,
      referralCount: user.referralCount,
      threshold: progress.threshold,
      progressPercent: progress.progressPercent,
    };
  });
};

export default referralRoute;
