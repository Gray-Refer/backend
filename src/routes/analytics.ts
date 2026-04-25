import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getAnalyticsOverview,
  getTopSources,
  getTimeseries,
} from '../services/analytics.js';

const shopIdQuery = z.object({ shopId: z.string().uuid() });

export default async function analyticsRoute(app: FastifyInstance) {

  // GET /analytics/overview?shopId=...
  app.get<{ Querystring: { shopId: string } }>(
    '/analytics/overview',
    async (req, reply) => {
      const parsed = shopIdQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
      }
      const data = await getAnalyticsOverview(parsed.data.shopId);
      return reply.send(data);
    },
  );

  // GET /analytics/sources?shopId=...
  app.get<{ Querystring: { shopId: string } }>(
    '/analytics/sources',
    async (req, reply) => {
      const parsed = shopIdQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
      }
      const sources = await getTopSources(parsed.data.shopId);
      return reply.send(sources);
    },
  );

  // GET /analytics/timeseries?shopId=...&days=30
  app.get<{ Querystring: { shopId: string; days?: string } }>(
    '/analytics/timeseries',
    async (req, reply) => {
      const parsed = shopIdQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
      }
      const days = Math.min(parseInt(req.query.days ?? '30', 10), 365);
      const series = await getTimeseries(parsed.data.shopId, days);
      return reply.send(series);
    },
  );
}
