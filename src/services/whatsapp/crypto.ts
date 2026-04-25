import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../../config.js';

const ALGO = 'aes-256-gcm';

function key() {
  return Buffer.from(config.encryptionKey, 'hex');
}

// Output layout: iv(12 bytes) | auth tag(16 bytes) | ciphertext — all base64-encoded
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
