import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { messageLogs } from '../db/schema.js';
import { config } from '../config.js';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  shopId: string;
  userId?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const { to, subject, html, shopId, userId } = opts;

  const [log] = await db
    .insert(messageLogs)
    .values({
      shopId,
      userId: userId ?? null,
      channel: 'email',
      provider: 'resend',
      recipient: to,
      message: subject,
      status: 'pending',
    })
    .returning();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resend.fromEmail,
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    await db
      .update(messageLogs)
      .set({ status: 'failed', error: `Resend ${res.status}: ${text}` })
      .where(eq(messageLogs.id, log!.id));
    throw new Error(`Resend ${res.status}: ${text}`);
  }

  await db
    .update(messageLogs)
    .set({ status: 'sent' })
    .where(eq(messageLogs.id, log!.id));
}
