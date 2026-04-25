import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { integrations, messageLogs } from '../../db/schema.js';
import { decrypt, encrypt } from './crypto.js';
import { TwilioProvider } from './twilio.js';
import { MetaProvider } from './meta.js';
import type { WhatsAppProvider, TwilioCredentials, MetaCredentials } from './types.js';

export { encrypt, decrypt } from './crypto.js';
export { renderTemplate } from './templates.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function getProvider(provider: string, credentials: unknown): WhatsAppProvider {
  switch (provider) {
    case 'twilio':
      return new TwilioProvider(credentials as TwilioCredentials);
    case 'meta':
      return new MetaProvider(credentials as MetaCredentials);
    default:
      throw new Error(`Unsupported WhatsApp provider: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// Connect / upsert an integration for a shop
// ---------------------------------------------------------------------------
export async function connectIntegration(
  shopId: string,
  provider: 'twilio' | 'meta',
  credentials: TwilioCredentials | MetaCredentials,
) {
  const encryptedCreds = encrypt(JSON.stringify(credentials));

  const [existing] = await db
    .select()
    .from(integrations)
    .where(eq(integrations.shopId, shopId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(integrations)
      .set({ provider, credentials: encryptedCreds, status: 'active', updatedAt: new Date() })
      .where(eq(integrations.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(integrations)
    .values({ shopId, provider, credentials: encryptedCreds })
    .returning();
  return created!;
}

// ---------------------------------------------------------------------------
// Send a WhatsApp message via the shop's active integration
// Logs every attempt; throws on failure (BullMQ handles retries)
// ---------------------------------------------------------------------------
export async function sendWhatsApp(
  shopId: string,
  to: string,
  message: string,
  opts?: { userId?: string },
): Promise<void> {
  const [integration] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.shopId, shopId), eq(integrations.status, 'active')))
    .limit(1);

  if (!integration) {
    throw new Error(`No active WhatsApp integration for shop ${shopId}`);
  }

  const credentials = JSON.parse(decrypt(integration.credentials));
  const provider = getProvider(integration.provider, credentials);

  const [log] = await db
    .insert(messageLogs)
    .values({
      shopId,
      userId: opts?.userId ?? null,
      integrationId: integration.id,
      channel: 'whatsapp',
      provider: integration.provider,
      recipient: to,
      message,
      status: 'pending',
    })
    .returning();

  try {
    await provider.sendMessage({ to, message });
    await db
      .update(messageLogs)
      .set({ status: 'sent' })
      .where(eq(messageLogs.id, log!.id));
  } catch (err) {
    await db
      .update(messageLogs)
      .set({ status: 'failed', error: (err as Error).message })
      .where(eq(messageLogs.id, log!.id));
    throw err;
  }
}
