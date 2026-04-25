import type { FastifyPluginAsync } from 'fastify';
import { redis } from '../queues/index.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (_req, reply) => {
    const checks = await Promise.allSettled([
      db.execute(sql`SELECT 1`),
      redis.ping(),
    ]);

    const dbOk = checks[0].status === 'fulfilled';
    const redisOk = checks[1].status === 'fulfilled';
    const healthy = dbOk && redisOk;

    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      ts: new Date().toISOString(),
    });
  });
};

export default healthRoute;
