import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrations, messageLogs } from '../db/schema.js';
import { connectIntegration, sendWhatsApp } from '../services/whatsapp/index.js';
import type { TwilioCredentials, MetaCredentials } from '../services/whatsapp/types.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const twilioBody = z.object({
  provider: z.literal('twilio'),
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  fromNumber: z.string().min(1),
});

const metaBody = z.object({
  provider: z.literal('meta'),
  accessToken: z.string().min(1),
  phoneNumberId: z.string().min(1),
  businessAccountId: z.string().optional(),
});

const connectBody = z.discriminatedUnion('provider', [twilioBody, metaBody]);

// E.164 — "+" followed by 7–15 digits
const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be a valid E.164 phone number');

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export default async function whatsappRoute(app: FastifyInstance) {
  // POST /whatsapp/integrations — connect or update provider credentials
  app.post('/whatsapp/integrations', async (req, reply) => {
    const body = connectBody.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten().fieldErrors });
    }

    // shopId must come from the authenticated session — here we read it from
    // the request body so merchants can self-serve from the dashboard.
    const { shopId } = req.body as { shopId?: string };
    if (!shopId) return reply.status(400).send({ error: 'shopId is required' });

    const { provider, ...creds } = body.data;
    const integration = await connectIntegration(
      shopId,
      provider,
      creds as TwilioCredentials | MetaCredentials,
    );

    return reply.status(201).send({
      id: integration.id,
      provider: integration.provider,
      status: integration.status,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    });
  });

  // GET /whatsapp/integrations/:shopId — current integration status (no credentials)
  app.get<{ Params: { shopId: string } }>(
    '/whatsapp/integrations/:shopId',
    async (req, reply) => {
      const [integration] = await db
        .select({
          id: integrations.id,
          provider: integrations.provider,
          status: integrations.status,
          createdAt: integrations.createdAt,
          updatedAt: integrations.updatedAt,
        })
        .from(integrations)
        .where(eq(integrations.shopId, req.params.shopId))
        .limit(1);

      if (!integration) return reply.status(404).send({ error: 'No integration found' });
      return reply.send(integration);
    },
  );

  // PATCH /whatsapp/integrations/:shopId/toggle — enable or disable
  app.patch<{ Params: { shopId: string } }>(
    '/whatsapp/integrations/:shopId/toggle',
    async (req, reply) => {
      const { enabled } = req.body as { enabled?: boolean };
      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({ error: '`enabled` boolean is required' });
      }

      const [existing] = await db
        .select()
        .from(integrations)
        .where(eq(integrations.shopId, req.params.shopId))
        .limit(1);

      if (!existing) return reply.status(404).send({ error: 'No integration found' });

      const [updated] = await db
        .update(integrations)
        .set({ status: enabled ? 'active' : 'inactive', updatedAt: new Date() })
        .where(eq(integrations.id, existing.id))
        .returning();

      return reply.send({ status: updated!.status });
    },
  );

  // DELETE /whatsapp/integrations/:shopId — disconnect
  app.delete<{ Params: { shopId: string } }>(
    '/whatsapp/integrations/:shopId',
    async (req, reply) => {
      const [existing] = await db
        .select()
        .from(integrations)
        .where(eq(integrations.shopId, req.params.shopId))
        .limit(1);

      if (!existing) return reply.status(404).send({ error: 'No integration found' });

      await db.delete(integrations).where(eq(integrations.id, existing.id));
      return reply.status(204).send();
    },
  );

  // POST /whatsapp/test — send a test message
  app.post('/whatsapp/test', async (req, reply) => {
    const schema = z.object({
      shopId: z.string().uuid(),
      to: e164,
      message: z.string().min(1).max(1600),
    });

    const body = schema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten().fieldErrors });
    }

    await sendWhatsApp(body.data.shopId, body.data.to, body.data.message);
    return reply.send({ ok: true });
  });

  // GET /whatsapp/logs/:shopId — paginated message logs (newest first)
  app.get<{ Params: { shopId: string }; Querystring: { limit?: string; offset?: string } }>(
    '/whatsapp/logs/:shopId',
    async (req, reply) => {
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
      const offset = parseInt(req.query.offset ?? '0', 10);

      const logs = await db
        .select()
        .from(messageLogs)
        .where(eq(messageLogs.shopId, req.params.shopId))
        .orderBy(desc(messageLogs.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.send({ logs, limit, offset });
    },
  );
}
