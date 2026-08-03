import { Pool } from 'pg';
import { createClient } from 'redis';
import { config } from '../config.js';

export const db = new Pool({ connectionString: config.DATABASE_URL, max: 20, idleTimeoutMillis: 30_000 });
export const cache = createClient({ url: config.REDIS_URL });
