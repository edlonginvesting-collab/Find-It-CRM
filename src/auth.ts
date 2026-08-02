import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import { db } from './db/client.js';

const scrypt = promisify(crypto.scrypt);
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string) { const salt = crypto.randomBytes(16).toString('hex'); const derived = await scrypt(password, salt, 64) as Buffer; return `${salt}:${derived.toString('hex')}`; }
export async function verifyPassword(password: string, encoded: string) { const [salt, hash] = encoded.split(':'); if (!salt || !hash) return false; const derived = await scrypt(password, salt, 64) as Buffer; const actual = derived.toString('hex'); return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(actual, 'hex')); }
export async function createSession(userId: string) { const token = crypto.randomBytes(32).toString('base64url'); await db.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,now()+interval \'30 days\')', [userId, hashToken(token)]); return token; }
export async function requireUser(request: FastifyRequest) {
  const raw = request.cookies.session;
  if (!raw) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  const { rows } = await db.query<{ id: string; email: string }>('SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.disabled_at IS NULL', [hashToken(raw)]);
  if (!rows[0]) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  return rows[0];
}
export async function requireMembership(userId: string, organizationId: string) { const { rows } = await db.query<{ role: string }>('SELECT role FROM memberships WHERE user_id=$1 AND organization_id=$2', [userId, organizationId]); if (!rows[0]) throw Object.assign(new Error('Organization access denied'), { statusCode: 403 }); return rows[0]; }
