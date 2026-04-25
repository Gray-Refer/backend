import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { shops } from '../db/schema.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Scopes required by GRAY REFER
// ---------------------------------------------------------------------------
const SCOPES = 'read_orders,write_discounts,read_customers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildShopifyInstallUrl(shopDomain: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: config.shopify.apiKey,
    scope: SCOPES,
    redirect_uri: `${config.frontendUrl}/auth/callback`,
    state: nonce,
    'grant_options[]': 'per-user',
  });
  return `https://${shopDomain}/admin/oauth/authorize?${params}`;
}

function validateHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const authRoute: FastifyPluginAsync = async (fastify) => {

  // GET /auth/install?shop=mystore.myshopify.com
  // Brand visits this URL to start the OAuth flow
  fastify.get<{ Querystring: { shop?: string } }>('/auth/install', async (req, reply) => {
    const shop = req.query.shop?.trim().toLowerCase();
    if (!shop || !shop.endsWith('.myshopify.com')) {
      return reply.status(400).send({ error: 'Invalid shop domain' });
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    // Store nonce in a short-lived cookie for CSRF protection
    reply.setCookie('gray_nonce', nonce, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 300, // 5 minutes
      path: '/',
    });

    const installUrl = buildShopifyInstallUrl(shop, nonce);
    return reply.redirect(installUrl);
  });

  // GET /auth/callback?code=...&shop=...&hmac=...&state=...
  // Shopify redirects here after the brand approves the app
  fastify.get<{
    Querystring: { code?: string; shop?: string; hmac?: string; state?: string };
  }>('/auth/callback', async (req, reply) => {
    const { code, shop, hmac, state } = req.query;

    if (!code || !shop || !hmac || !state) {
      return reply.status(400).send({ error: 'Missing OAuth params' });
    }

    // Validate CSRF nonce
    const storedNonce = req.cookies?.gray_nonce;
    if (!storedNonce || storedNonce !== state) {
      return reply.status(403).send({ error: 'Invalid state (CSRF check failed)' });
    }

    // Validate HMAC from Shopify
    if (!validateHmac(req.query as Record<string, string>, config.shopify.apiSecret)) {
      return reply.status(403).send({ error: 'HMAC validation failed' });
    }

    // Exchange code for permanent access token
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.shopify.apiKey,
        client_secret: config.shopify.apiSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      req.log.error({ shop }, 'Token exchange failed');
      return reply.status(502).send({ error: 'Token exchange failed' });
    }

    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // Generate a webhook secret for this shop (used to verify future webhooks)
    const webhookSecret = crypto.randomBytes(32).toString('hex');

    // Upsert shop record
    const [existingShop] = await db
      .select()
      .from(shops)
      .where(eq(shops.domain, shop))
      .limit(1);

    let shopId: string;

    if (existingShop) {
      await db
        .update(shops)
        .set({ accessToken: access_token, isActive: true, updatedAt: new Date() })
        .where(eq(shops.id, existingShop.id));
      shopId = existingShop.id;
    } else {
      const [created] = await db
        .insert(shops)
        .values({
          domain: shop,
          accessToken: access_token,
          webhookSecret,
          // Defaults from DB schema: threshold=10, rewardValue=1000, validationDelayDays=7
        })
        .returning();
      shopId = created!.id;

      // Register webhooks automatically on first install
      await registerShopifyWebhooks(shop, access_token);
    }

    reply.clearCookie('gray_nonce', { path: '/' });

    // Redirect brand to their dashboard
    return reply.redirect(`${config.frontendUrl}/dashboard?shopId=${shopId}`);
  });
};

// ---------------------------------------------------------------------------
// Auto-register webhooks after install
// ---------------------------------------------------------------------------
async function registerShopifyWebhooks(shopDomain: string, accessToken: string) {
  const BACKEND_URL = process.env.BACKEND_PUBLIC_URL ?? `http://localhost:${config.port}`;

  const topics = [
    { topic: 'ORDERS_CREATE', endpoint: `${BACKEND_URL}/webhooks/orders_create` },
    { topic: 'ORDERS_UPDATED', endpoint: `${BACKEND_URL}/webhooks/orders_updated` },
  ];

  const mutation = /* GraphQL */ `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }
  `;

  for (const { topic, endpoint } of topics) {
    await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          topic,
          webhookSubscription: {
            callbackUrl: endpoint,
            format: 'JSON',
          },
        },
      }),
    });
  }
}

export default authRoute;
