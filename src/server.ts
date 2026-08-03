import crypto from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import statik from '@fastify/static';
import { join } from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { cache, db } from './db/client.js';
import { createSession, hashPassword, requireMembership, requireUser, verifyPassword } from './auth.js';

const app = Fastify({ logger: true, trustProxy: config.NODE_ENV === 'production', requestIdHeader: 'x-request-id', genReqId: () => crypto.randomUUID() });
await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], baseUri: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"] } } });
await app.register(cookie, { secret: config.SESSION_SECRET, hook: 'onRequest' });
await app.register(cors, { origin: config.APP_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
await app.register(statik, { root: join(process.cwd(), 'public'), prefix: '/' });

app.addHook('onRequest', async (request, reply) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin !== config.APP_ORIGIN) return reply.code(403).send({ error: 'Invalid origin' });
  }
});

app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));
app.get('/ready', async (_request, reply) => {
  try { await db.query('SELECT 1'); await cache.ping(); return { status: 'ready' }; }
  catch { return reply.code(503).send({ status: 'unavailable' }); }
});

const credentials = z.object({ email: z.string().email().max(254).transform((v) => v.toLowerCase()), password: z.string().min(12).max(256), displayName: z.string().trim().min(1).max(120).optional(), organizationName: z.string().trim().min(2).max(120).optional() });
app.post('/api/auth/register', async (request, reply) => {
  const input = credentials.parse(request.body);
  if (!input.displayName) return reply.code(400).send({ error: 'Display name is required' });
  try {
    const { rows } = await db.query<{ id: string }>('INSERT INTO users (email,password_hash,display_name) VALUES ($1,$2,$3) RETURNING id', [input.email, await hashPassword(input.password), input.displayName]);
    const created = rows[0]; if (!created) throw new Error('User creation failed');
    const organization = await db.query<{ id: string }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [input.organizationName ?? `${input.displayName}'s workspace`]);
    const organizationId = organization.rows[0]?.id; if (!organizationId) throw new Error('Organization creation failed');
    await db.query('INSERT INTO memberships (organization_id,user_id,role) VALUES ($1,$2,\'owner\')', [organizationId, created.id]);
    await db.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [created.id]);
    const token = await createSession(created.id);
    reply.setCookie('session', token, { httpOnly: true, sameSite: 'strict', secure: config.NODE_ENV === 'production', path: '/', maxAge: 2_592_000 });
    return reply.code(201).send({ id: created.id, email: input.email, organizationId });
  } catch (error: unknown) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Email already exists' }); throw error; }
});
app.post('/api/auth/login', async (request, reply) => {
  const input = credentials.pick({ email: true, password: true }).parse(request.body);
  const { rows } = await db.query<{ id: string; password_hash: string }>('SELECT id,password_hash FROM users WHERE email=$1 AND disabled_at IS NULL', [input.email]);
  if (!rows[0] || !(await verifyPassword(input.password, rows[0].password_hash))) return reply.code(401).send({ error: 'Invalid credentials' });
  const account = rows[0]; if (!account) return reply.code(401).send({ error: 'Invalid credentials' }); const token = await createSession(account.id);
  reply.setCookie('session', token, { httpOnly: true, sameSite: 'strict', secure: config.NODE_ENV === 'production', path: '/', maxAge: 2_592_000 });
  return { id: account.id };
});
app.post('/api/auth/logout', async (request, reply) => { const user = await requireUser(request); await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash=$2', [user.id, crypto.createHash('sha256').update(request.cookies.session ?? '').digest('hex')]); reply.clearCookie('session', { path: '/' }); return reply.code(204).send(); });

const uuid = z.string().uuid();
const listQuery = z.object({ organizationId: uuid, limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().datetime().optional() });
app.get('/api/leads', async (request) => {
  const q = listQuery.parse(request.query);
  const user = await requireUser(request); await requireMembership(user.id, q.organizationId);
  const result = await db.query(
    `SELECT id, contact_id AS "contactId", property_id AS "propertyId", owner_id AS "ownerId", source, status, score, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM leads WHERE organization_id=$1 AND deleted_at IS NULL AND ($2::timestamptz IS NULL OR created_at < $2) ORDER BY created_at DESC LIMIT $3`,
    [q.organizationId, q.cursor ?? null, q.limit + 1]
  );
  const items = result.rows.slice(0, q.limit);
  return { items, nextCursor: result.rows.length > q.limit ? items.at(-1)?.createdAt : null };
});

const leadInput = z.object({ organizationId: uuid, contactId: uuid, propertyId: uuid.optional(), ownerId: uuid.optional(), source: z.string().trim().min(1).max(80), score: z.number().int().min(0).max(100).optional() });
app.post('/api/leads', async (request, reply) => {
  const input = leadInput.parse(request.body);
  const user = await requireUser(request); await requireMembership(user.id, input.organizationId);
  const result = await db.query(
    `INSERT INTO leads (organization_id,contact_id,property_id,owner_id,source,score) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status, created_at AS "createdAt"`,
    [input.organizationId, input.contactId, input.propertyId ?? null, input.ownerId ?? null, input.source, input.score ?? null]
  );
  await db.query(`INSERT INTO activities (organization_id, actor_id, entity_type, entity_id, kind, body) VALUES ($1,$2,'lead',$3,'created',$4)`, [input.organizationId, user.id, result.rows[0].id, JSON.stringify({ source: input.source })]);
  return reply.code(201).send(result.rows[0]);
});

const searchQuery = z.object({ organizationId: uuid, q: z.string().trim().min(2).max(120), limit: z.coerce.number().int().min(1).max(25).default(10) });
app.get('/api/search', async (request) => {
  const q = searchQuery.parse(request.query); const user = await requireUser(request); await requireMembership(user.id, q.organizationId);
  const term = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await db.query(
    `SELECT 'contact' AS type, id, COALESCE(NULLIF(concat_ws(' ',first_name,last_name),''),email::text,phone) AS label, email::text AS detail FROM contacts WHERE organization_id=$1 AND deleted_at IS NULL AND (concat_ws(' ',first_name,last_name) ILIKE $2 ESCAPE '\\' OR email::text ILIKE $2 ESCAPE '\\' OR phone ILIKE $2 ESCAPE '\\')
     UNION ALL
     SELECT 'property', id, address_line1, concat_ws(', ',city,region) FROM properties WHERE organization_id=$1 AND deleted_at IS NULL AND (address_line1 ILIKE $2 ESCAPE '\\' OR city ILIKE $2 ESCAPE '\\')
     UNION ALL
     SELECT 'lead', l.id, concat_ws(' ',c.first_name,c.last_name), l.source FROM leads l JOIN contacts c ON c.id=l.contact_id WHERE l.organization_id=$1 AND l.deleted_at IS NULL AND (concat_ws(' ',c.first_name,c.last_name) ILIKE $2 ESCAPE '\\' OR l.source ILIKE $2 ESCAPE '\\')
     LIMIT $3`, [q.organizationId, term, q.limit]
  );
  return { items: rows };
});

const activityQuery = z.object({ organizationId: uuid, entityType: z.enum(['contact','property','lead','deal']), entityId: uuid, limit: z.coerce.number().int().min(1).max(100).default(50) });
app.get('/api/activities', async (request) => {
  const q = activityQuery.parse(request.query); const user = await requireUser(request); await requireMembership(user.id, q.organizationId);
  const { rows } = await db.query(`SELECT a.id,a.kind,a.body,a.created_at AS "createdAt",u.display_name AS "actorName" FROM activities a LEFT JOIN users u ON u.id=a.actor_id WHERE a.organization_id=$1 AND a.entity_type=$2 AND a.entity_id=$3 ORDER BY a.created_at DESC LIMIT $4`, [q.organizationId,q.entityType,q.entityId,q.limit]);
  return { items: rows };
});

const analyticsQuery = z.object({ organizationId: uuid, from: z.string().date(), to: z.string().date() });
app.get('/api/analytics/overview', async (request) => {
  const q = analyticsQuery.parse(request.query); const user = await requireUser(request); await requireMembership(user.id, q.organizationId);
  const { rows } = await db.query<{ leads: string; qualified: string; offers: string; closed: string; revenue: string }>(
    `SELECT COALESCE(sum(leads_created),0)::text AS leads, COALESCE(sum(leads_qualified),0)::text AS qualified, COALESCE(sum(offers_sent),0)::text AS offers, COALESCE(sum(deals_closed),0)::text AS closed, COALESCE(sum(assignment_revenue),0)::text AS revenue FROM metric_daily WHERE organization_id=$1 AND day BETWEEN $2 AND $3`, [q.organizationId,q.from,q.to]
  );
  const summary = rows[0] ?? { leads: '0', qualified: '0', offers: '0', closed: '0', revenue: '0' };
  const leads = Number(summary.leads); const qualified = Number(summary.qualified); const offers = Number(summary.offers); const closed = Number(summary.closed);
  return { ...summary, conversion: { qualified: leads ? qualified / leads : 0, offers: leads ? offers / leads : 0, closed: leads ? closed / leads : 0 } };
});

const stageInput = z.object({ organizationId: uuid, stage: z.string().trim().min(1).max(80) });
app.patch('/api/deals/:id/stage', async (request, reply) => {
  const input = stageInput.parse(request.body); const dealId = uuid.parse((request.params as { id: string }).id); const user = await requireUser(request); await requireMembership(user.id, input.organizationId);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ stage: string }>('SELECT stage FROM deals WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE', [dealId,input.organizationId]);
    const deal = current.rows[0]; if (!deal) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Deal not found' }); }
    if (deal.stage !== input.stage) { await client.query('UPDATE deals SET stage=$1,updated_at=now() WHERE id=$2', [input.stage,dealId]); await client.query('INSERT INTO deal_stage_history (organization_id,deal_id,from_stage,to_stage,changed_by) VALUES ($1,$2,$3,$4,$5)', [input.organizationId,dealId,deal.stage,input.stage,user.id]); await client.query(`INSERT INTO activities (organization_id,actor_id,entity_type,entity_id,kind,body) VALUES ($1,$2,'deal',$3,'stage_changed',$4)`, [input.organizationId,user.id,dealId,JSON.stringify({ from: deal.stage, to: input.stage })]); }
    await client.query('COMMIT'); return { id: dealId, stage: input.stage };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

async function close() { await Promise.allSettled([db.end(), cache.quit()]); }
process.on('SIGTERM', () => void app.close().then(close));
process.on('SIGINT', () => void app.close().then(close));
await cache.connect();
await app.listen({ host: config.HOST, port: config.PORT });
