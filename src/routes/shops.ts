import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { shops } from '../db/schema.js';

const shopsRoute: FastifyPluginAsync = async (fastify) => {

  // GET /shops/:shopId — fetch shop config (for dashboard settings form)
  fastify.get<{ Params: { shopId: string } }>('/shops/:shopId', async (req, reply) => {
    const [shop] = await db
      .select({
        id: shops.id,
        domain: shops.domain,
        referralThreshold: shops.referralThreshold,
        rewardValue: shops.rewardValue,
        validationDelayDays: shops.validationDelayDays,
        isActive: shops.isActive,
        createdAt: shops.createdAt,
      })
      .from(shops)
      .where(eq(shops.id, req.params.shopId))
      .limit(1);

    if (!shop) return reply.status(404).send({ error: 'Shop not found' });
    return shop;
  });

  // PATCH /shops/:shopId/settings — update reward config from dashboard
  const SettingsSchema = z.object({
    referralThreshold: z.number().int().min(1).max(100).optional(),
    rewardValue: z.number().int().min(1).optional(),           // INR
    validationDelayDays: z.number().int().min(0).max(30).optional(),
  });

  fastify.patch<{ Params: { shopId: string } }>(
    '/shops/:shopId/settings',
    async (req, reply) => {
      const parsed = SettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const [shop] = await db
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.id, req.params.shopId))
        .limit(1);

      if (!shop) return reply.status(404).send({ error: 'Shop not found' });

      const updates: Partial<typeof shops.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (parsed.data.referralThreshold !== undefined)
        updates.referralThreshold = parsed.data.referralThreshold;
      if (parsed.data.rewardValue !== undefined)
        updates.rewardValue = parsed.data.rewardValue;
      if (parsed.data.validationDelayDays !== undefined)
        updates.validationDelayDays = parsed.data.validationDelayDays;

      const [updated] = await db
        .update(shops)
        .set(updates)
        .where(eq(shops.id, req.params.shopId))
        .returning({
          id: shops.id,
          referralThreshold: shops.referralThreshold,
          rewardValue: shops.rewardValue,
          validationDelayDays: shops.validationDelayDays,
        });

      return updated;
    },
  );
};

export default shopsRoute;
