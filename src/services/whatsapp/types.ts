export interface WhatsAppProvider {
  sendMessage(params: { to: string; message: string }): Promise<void>;
}

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  fromNumber: string; // e.g. "whatsapp:+14155238886" or "+14155238886"
}

export interface MetaCredentials {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string;
}
