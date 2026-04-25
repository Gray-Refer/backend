import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { config } from './config.js';
import { redis } from './queues/index.js';

import healthRoute from './routes/health.js';
import webhooksRoute from './routes/webhooks.js';
import referralRoute from './routes/referral.js';
import authRoute from './routes/auth.js';
import shopsRoute from './routes/shops.js';
import whatsappRoute from './routes/whatsapp.js';
import analyticsRoute from './routes/analytics.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.isDev ? 'debug' : 'info',
      ...(config.isDev
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
    trustProxy: true,
  });

  // ---------------------------------------------------------------------------
  // Security & rate limiting
  // ---------------------------------------------------------------------------
  await app.register(helmet, { global: true });

  await app.register(cors, {
    origin: config.isDev ? true : [config.frontendUrl],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis,
  });

  await app.register(cookie);

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------
  await app.register(healthRoute);
  await app.register(authRoute);
  await app.register(shopsRoute);
  await app.register(webhooksRoute);
  await app.register(referralRoute);
  await app.register(whatsappRoute);
  await app.register(analyticsRoute);

  // ---------------------------------------------------------------------------
  // Global error handler
  // ---------------------------------------------------------------------------
  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    const status = err.statusCode ?? 500;
    return reply.status(status).send({
      error: status >= 500 ? 'Internal server error' : err.message,
    });
  });

  return app;
}
