import type { FastifyPluginAsync } from 'fastify';
import { webhookQueue } from '../queues/index.js';
import { verifyShopifyWebhook } from '../services/shopify.js';
import { db } from '../db/index.js';
import { shops } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const SUPPORTED_TOPICS = new Set(['orders/create', 'orders/updated']);

const webhooksRoute: FastifyPluginAsync = async (fastify) => {
  // Shopify sends raw body for HMAC verification — we must read it as a buffer
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  fastify.post<{ Params: { topic: string } }>(
    '/webhooks/:topic',
    async (req, reply) => {
      const rawBody = req.body as Buffer;
      const topic = req.params.topic.replace('_', '/'); // orders_create → orders/create
      const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string | undefined;
      const shopDomain = req.headers['x-shopify-shop-domain'] as string | undefined;

      if (!hmacHeader || !shopDomain) {
        return reply.status(400).send({ error: 'Missing Shopify headers' });
      }

      if (!SUPPORTED_TOPICS.has(topic)) {
        return reply.status(200).send({ ok: true }); // Shopify expects 200 even for ignored topics
      }

      // Fetch shop's webhook secret for verification
      const [shop] = await db
        .select({ webhookSecret: shops.webhookSecret })
        .from(shops)
        .where(eq(shops.domain, shopDomain))
        .limit(1);

      // Fall back to global Shopify API secret if shop-level secret not set
      const secret = shop?.webhookSecret ?? process.env.SHOPIFY_API_SECRET;
      if (!secret) {
        req.log.warn({ shopDomain }, 'No webhook secret configured for shop');
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      if (!verifyShopifyWebhook(rawBody, hmacHeader, secret)) {
        return reply.status(401).send({ error: 'HMAC verification failed' });
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString('utf-8')) as Record<string, unknown>;
      } catch {
        return reply.status(400).send({ error: 'Invalid JSON body' });
      }

      await webhookQueue.add(topic, {
        topic,
        shopDomain,
        payload,
        receivedAt: new Date().toISOString(),
      });

      return reply.status(200).send({ queued: true });
    },
  );
};

export default webhooksRoute;
