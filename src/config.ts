import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  APP_ORIGIN: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  STRIPE_PRICE_STARTER: z.string().startsWith('price_').optional(),
  STRIPE_PRICE_PROFESSIONAL: z.string().startsWith('price_').optional(),
  STRIPE_PRICE_BUSINESS: z.string().startsWith('price_').optional(),
  STRIPE_PRICE_SCALE: z.string().startsWith('price_').optional()
});
export const config = schema.parse(process.env);
