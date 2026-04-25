import type { WhatsAppProvider, TwilioCredentials } from './types.js';

export class TwilioProvider implements WhatsAppProvider {
  constructor(private creds: TwilioCredentials) {}

  async sendMessage({ to, message }: { to: string; message: string }) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.creds.accountSid}/Messages.json`;
    const token = Buffer.from(
      `${this.creds.accountSid}:${this.creds.authToken}`,
    ).toString('base64');

    const from = this.creds.fromNumber.startsWith('whatsapp:')
      ? this.creds.fromNumber
      : `whatsapp:${this.creds.fromNumber}`;
    const toWa = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    const body = new URLSearchParams({ From: from, To: toWa, Body: message });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio ${res.status}: ${text}`);
    }
  }
}
