import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  SHOPIFY_API_KEY: z.string().optional(),
  SHOPIFY_API_SECRET: z.string().optional(),

  DEFAULT_REFERRAL_THRESHOLD: z.coerce.number().default(10),
  DEFAULT_REWARD_VALUE: z.coerce.number().default(1000),
  DEFAULT_VALIDATION_DELAY_DAYS: z.coerce.number().default(7),

  FRONTEND_URL: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  host: env.HOST,
  isDev: env.NODE_ENV === 'development',
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  shopify: {
    apiKey: env.SHOPIFY_API_KEY,
    apiSecret: env.SHOPIFY_API_SECRET,
  },
  defaults: {
    referralThreshold: env.DEFAULT_REFERRAL_THRESHOLD,
    rewardValue: env.DEFAULT_REWARD_VALUE,
    validationDelayDays: env.DEFAULT_VALIDATION_DELAY_DAYS,
  },
  frontendUrl: env.FRONTEND_URL,
} as const;
