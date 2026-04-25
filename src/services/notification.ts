import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { sendWhatsApp, renderTemplate } from './whatsapp/index.js';
import { sendEmail } from './email.js';
import { config } from '../config.js';

export type NotificationEvent = 'POST_PURCHASE' | 'REWARD_UNLOCKED';

interface NotificationOpts {
  discountCode?: string;
  rewardValue?: number;
}

interface MessageContent {
  text: string;          // WhatsApp plain text
  emailSubject: string;
  emailHtml: string;
}

// ---------------------------------------------------------------------------
// Build message content for each event type
// ---------------------------------------------------------------------------
function buildContent(
  event: NotificationEvent,
  user: { referralCode: string; email: string },
  src: string,
  opts: NotificationOpts,
): MessageContent {
  const referralLink = `${config.frontendUrl}/r/${user.referralCode}?src=${src}`;

  if (event === 'POST_PURCHASE') {
    const text = renderTemplate(
      'Thanks for your order! Refer friends and earn rewards: {{link}}',
      { link: referralLink },
    );
    return {
      text,
      emailSubject: 'Thanks for your order — share your link and earn rewards!',
      emailHtml: `
        <p>Thanks for your purchase!</p>
        <p>Share your referral link and earn rewards when your friends buy:</p>
        <p><a href="${referralLink}">${referralLink}</a></p>
      `,
    };
  }

  // REWARD_UNLOCKED
  const value = opts.rewardValue ?? 0;
  const code = opts.discountCode ?? '';
  const text = `Congrats! You've earned a ₹${value} reward. Use code: ${code} 🎉`;
  return {
    text,
    emailSubject: "You've unlocked a referral reward 🎉",
    emailHtml: `
      <p>Congratulations!</p>
      <p>You've earned a <strong>₹${value}</strong> reward for referring friends.</p>
      <p>Use this code at checkout: <strong>${code}</strong></p>
    `,
  };
}

// ---------------------------------------------------------------------------
// Main entry point — WhatsApp first, email fallback
// ---------------------------------------------------------------------------
export async function sendNotification(
  userId: string,
  shopId: string,
  event: NotificationEvent,
  opts: NotificationOpts = {},
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;

  // Try WhatsApp
  if (user.phone) {
    const content = buildContent(event, user, 'whatsapp', opts);
    try {
      await sendWhatsApp(shopId, user.phone, content.text, { userId });
      return;
    } catch {
      // WhatsApp failed — fall through to email
    }
  }

  // Email fallback
  if (user.email) {
    const content = buildContent(event, user, 'email', opts);
    await sendEmail({
      to: user.email,
      subject: content.emailSubject,
      html: content.emailHtml,
      shopId,
      userId,
    });
  }
}
