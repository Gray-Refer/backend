import type { WhatsAppProvider, MetaCredentials } from './types.js';

export class MetaProvider implements WhatsAppProvider {
  constructor(private creds: MetaCredentials) {}

  async sendMessage({ to, message }: { to: string; message: string }) {
    const url = `https://graph.facebook.com/v18.0/${this.creds.phoneNumberId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta ${res.status}: ${text}`);
    }
  }
}
