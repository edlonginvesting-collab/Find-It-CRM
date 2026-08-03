import crypto from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import statik from '@fastify/static';
import Stripe from 'stripe';
import { join } from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { db } from './db/client.js';
import { createSession, createSessionWithClient, hashPassword, requireMembership, requireUser, verifyPassword } from './auth.js';

const app = Fastify({ logger: true, trustProxy: config.NODE_ENV === 'production', requestIdHeader: 'x-request-id', genReqId: () => crypto.randomUUID() });
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
  const status = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? Number((error as { statusCode: number }).statusCode) : 500;
  if (status >= 500) app.log.error(error);
  return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : (error as Error).message });
});
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  const rawBody = (body as Buffer).toString('utf8');
  (request as FastifyRequest & { rawBody?: string }).rawBody = rawBody;
  try { done(null, JSON.parse(rawBody)); } catch { done(new Error('Invalid JSON')); }
});
await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], baseUri: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"] } } });
await app.register(cookie, { secret: config.SESSION_SECRET, hook: 'onRequest' });
await app.register(cors, { origin: config.APP_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
await app.register(statik, { root: join(process.cwd(), 'public'), prefix: '/' });
const stripe = config.STRIPE_SECRET_KEY ? new Stripe(config.STRIPE_SECRET_KEY) : null;
const stripePriceByPlan = { starter: config.STRIPE_PRICE_STARTER, professional: config.STRIPE_PRICE_PROFESSIONAL, business: config.STRIPE_PRICE_BUSINESS, scale: config.STRIPE_PRICE_SCALE } as const;
const requireStripe = () => { if (!stripe) throw Object.assign(new Error('Stripe is not configured'), { statusCode: 503 }); return stripe; };
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const allowLoginAttempt = (key: string) => { const now = Date.now(); const current = loginAttempts.get(key); if (!current || current.resetAt <= now) { loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 }); return true; } if (current.count >= 10) return false; current.count += 1; return true; };

app.addHook('onRequest', async (request, reply) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin !== config.APP_ORIGIN) return reply.code(403).send({ error: 'Invalid origin' });
  }
});

app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));
app.get('/ready', async (_request, reply) => {
  try { await db.query('SELECT 1'); return { status: 'ready' }; }
  catch { return reply.code(503).send({ status: 'unavailable' }); }
});

const credentials = z.object({ email: z.string().email().max(254).transform((v) => v.toLowerCase()), password: z.string().min(12).max(256), displayName: z.string().trim().min(1).max(120).optional(), organizationName: z.string().trim().min(2).max(120).optional() });
app.post('/api/auth/register', async (request, reply) => {
  const input = credentials.parse(request.body);
  if (!input.displayName) return reply.code(400).send({ error: 'Display name is required' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>('INSERT INTO users (email,password_hash,display_name) VALUES ($1,$2,$3) RETURNING id', [input.email, await hashPassword(input.password), input.displayName]);
    const created = rows[0]; if (!created) throw new Error('User creation failed');
    const organization = await client.query<{ id: string }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [input.organizationName ?? `${input.displayName}'s workspace`]);
    const organizationId = organization.rows[0]?.id; if (!organizationId) throw new Error('Organization creation failed');
    await client.query('INSERT INTO memberships (organization_id,user_id,role) VALUES ($1,$2,\'owner\')', [organizationId, created.id]);
    const plan = await client.query<{ included_credits: number }>('SELECT included_credits FROM plans WHERE id=\'starter\'');
    await client.query('INSERT INTO credit_accounts (organization_id,balance) VALUES ($1,$2)', [organizationId, plan.rows[0]?.included_credits ?? 25]);
    await client.query('INSERT INTO credit_ledger (organization_id,amount,reason) VALUES ($1,$2,\'trial_grant\')', [organizationId, plan.rows[0]?.included_credits ?? 25]);
    await client.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [created.id]);
    const token = await createSessionWithClient(client, created.id);
    await client.query('COMMIT');
    reply.setCookie('session', token, { httpOnly: true, sameSite: 'strict', secure: config.NODE_ENV === 'production', path: '/', maxAge: 2_592_000 });
    return reply.code(201).send({ id: created.id, email: input.email, organizationId });
  } catch (error: unknown) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Email already exists' }); throw error; } finally { client.release(); }
});
app.post('/api/auth/login', async (request, reply) => {
  const input = credentials.pick({ email: true, password: true }).parse(request.body);
  if (!allowLoginAttempt(`${request.ip}:${input.email}`)) return reply.code(429).send({ error: 'Too many login attempts. Try again later.' });
  const { rows } = await db.query<{ id: string; password_hash: string }>('SELECT id,password_hash FROM users WHERE email=$1 AND disabled_at IS NULL', [input.email]);
  if (!rows[0] || !(await verifyPassword(input.password, rows[0].password_hash))) return reply.code(401).send({ error: 'Invalid credentials' });
  const account = rows[0]; if (!account) return reply.code(401).send({ error: 'Invalid credentials' }); const token = await createSession(account.id);
  reply.setCookie('session', token, { httpOnly: true, sameSite: 'strict', secure: config.NODE_ENV === 'production', path: '/', maxAge: 2_592_000 });
  return { id: account.id };
});
app.post('/api/auth/logout', async (request, reply) => { const user = await requireUser(request); await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash=$2', [user.id, crypto.createHash('sha256').update(request.cookies.session ?? '').digest('hex')]); reply.clearCookie('session', { path: '/' }); return reply.code(204).send(); });

const uuid = z.string().uuid();
app.get('/api/plans', async () => {
  const { rows } = await db.query('SELECT id,name,monthly_price_cents AS "monthlyPriceCents",included_credits AS "includedCredits",max_users AS "maxUsers",features FROM plans WHERE active=true ORDER BY monthly_price_cents');
  return { items: rows };
});

app.get('/api/billing/summary', async (request) => {
  const organizationId = uuid.parse((request.query as { organizationId?: string }).organizationId);
  const user = await requireUser(request); await requireMembership(user.id, organizationId);
  const { rows } = await db.query('SELECT o.id,o.plan_id AS "planId",o.billing_status AS "billingStatus",o.trial_ends_at AS "trialEndsAt",p.name,p.monthly_price_cents AS "monthlyPriceCents",ca.balance FROM organizations o JOIN plans p ON p.id=o.plan_id JOIN credit_accounts ca ON ca.organization_id=o.id WHERE o.id=$1', [organizationId]);
  return rows[0] ?? { error: 'Organization not found' };
});

app.post('/api/billing/checkout', async (request, reply) => {
  const input = z.object({ organizationId: uuid, planId: z.enum(['starter','professional','business','scale']) }).parse(request.body);
  const user = await requireUser(request); await requireMembership(user.id, input.organizationId);
  const client = requireStripe(); const price = stripePriceByPlan[input.planId];
  if (!price) return reply.code(503).send({ error: `Stripe price is not configured for ${input.planId}` });
  const org = await db.query<{ name: string; stripe_customer_id: string | null }>('SELECT name,stripe_customer_id FROM organizations WHERE id=$1', [input.organizationId]);
  const record = org.rows[0]; if (!record) return reply.code(404).send({ error: 'Organization not found' });
  const customer = record.stripe_customer_id ? record.stripe_customer_id : (await client.customers.create({ name: record.name, metadata: { organizationId: input.organizationId } })).id;
  if (!record.stripe_customer_id) await db.query('UPDATE organizations SET stripe_customer_id=$1 WHERE id=$2', [customer,input.organizationId]);
  const session = await client.checkout.sessions.create({ mode: 'subscription', customer, line_items: [{ price, quantity: 1 }], success_url: `${config.APP_ORIGIN}/?billing=success`, cancel_url: `${config.APP_ORIGIN}/?billing=cancelled`, metadata: { organizationId: input.organizationId, planId: input.planId }, subscription_data: { metadata: { organizationId: input.organizationId, planId: input.planId } } });
  return { url: session.url };
});

app.post('/api/billing/portal', async (request, reply) => {
  const input = z.object({ organizationId: uuid }).parse(request.body); const user = await requireUser(request); await requireMembership(user.id, input.organizationId);
  const client = requireStripe(); const { rows } = await db.query<{ stripe_customer_id: string | null }>('SELECT stripe_customer_id FROM organizations WHERE id=$1', [input.organizationId]);
  if (!rows[0]?.stripe_customer_id) return reply.code(409).send({ error: 'No Stripe customer exists yet' });
  const session = await client.billingPortal.sessions.create({ customer: rows[0].stripe_customer_id, return_url: config.APP_ORIGIN }); return { url: session.url };
});

app.post('/api/billing/webhook', async (request, reply) => {
  if (!stripe || !config.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: 'Stripe webhook is not configured' });
  const signature = request.headers['stripe-signature']; const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
  if (!signature || !rawBody) return reply.code(400).send({ error: 'Missing Stripe signature' });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET); } catch { return reply.code(400).send({ error: 'Invalid Stripe signature' }); }
  const claimed = await db.query('INSERT INTO stripe_webhook_events (id,event_type) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [event.id,event.type]);
  if (claimed.rowCount === 0) return { received: true, duplicate: true };
  const subscription = event.data.object as Stripe.Subscription;
  try {
    if (event.type.startsWith('customer.subscription.') && subscription.metadata.organizationId) {
      const status = subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : subscription.status === 'past_due' ? 'past_due' : 'cancelled';
      const planId = subscription.metadata.planId;
      await db.query('UPDATE organizations SET billing_status=$1,stripe_subscription_id=$2,plan_id=COALESCE($3,plan_id) WHERE id=$4', [status, subscription.id, planId || null, subscription.metadata.organizationId]);
    }
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (customerId) await db.query('UPDATE organizations SET billing_status=\'past_due\' WHERE stripe_customer_id=$1', [customerId]);
    }
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (customerId) {
        const org = await db.query<{ id: string; plan_id: string }>('SELECT id,plan_id FROM organizations WHERE stripe_customer_id=$1', [customerId]);
        const plan = org.rows[0] ? await db.query<{ included_credits: number }>('SELECT included_credits FROM plans WHERE id=$1', [org.rows[0].plan_id]) : { rows: [] };
        if (org.rows[0] && plan.rows[0]) {
          await db.query('UPDATE credit_accounts SET balance=balance+$1,updated_at=now() WHERE organization_id=$2', [plan.rows[0].included_credits,org.rows[0].id]);
          await db.query('INSERT INTO credit_ledger (organization_id,amount,reason,reference_id) VALUES ($1,$2,\'subscription_renewal\',$3)', [org.rows[0].id,plan.rows[0].included_credits,event.id]);
        }
      }
    }
    await db.query('UPDATE stripe_webhook_events SET processed_at=now() WHERE id=$1', [event.id]);
    return { received: true };
  } catch (error) {
    await db.query('UPDATE stripe_webhook_events SET error=$2 WHERE id=$1', [event.id,(error as Error).message]);
    throw error;
  }
});

const marketplaceQuery = z.object({ organizationId: uuid, limit: z.coerce.number().int().min(1).max(50).default(25) });
app.get('/api/marketplace/listings', async (request) => {
  const q = marketplaceQuery.parse(request.query); const user = await requireUser(request); await requireMembership(user.id, q.organizationId);
  const { rows } = await db.query(`SELECT ml.id,ml.price_credits AS "priceCredits",ml.quality_score AS "qualityScore",ml.source_date AS "sourceDate",ml.created_at AS "createdAt",l.source,l.score,c.first_name AS "firstName",c.last_name AS "lastName",p.city,p.region FROM marketplace_listings ml JOIN leads l ON l.id=ml.lead_id JOIN contacts c ON c.id=l.contact_id LEFT JOIN properties p ON p.id=l.property_id WHERE ml.status='available' AND (ml.expires_at IS NULL OR ml.expires_at>now()) ORDER BY ml.created_at DESC LIMIT $1`, [q.limit]);
  return { items: rows };
});

app.post('/api/marketplace/listings/:id/purchase', async (request, reply) => {
  const listingId = uuid.parse((request.params as { id: string }).id); const user = await requireUser(request);
  const input = z.object({ organizationId: uuid }).parse(request.body); await requireMembership(user.id, input.organizationId);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const listing = await client.query<{ lead_id: string; price_credits: number }>('SELECT lead_id,price_credits FROM marketplace_listings WHERE id=$1 AND status=\'available\' AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE', [listingId]);
    if (!listing.rows[0]) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Listing is no longer available' }); }
    const item = listing.rows[0];
    const account = await client.query<{ balance: number }>('SELECT balance FROM credit_accounts WHERE organization_id=$1 FOR UPDATE', [input.organizationId]);
    if (!account.rows[0] || account.rows[0].balance < item.price_credits) { await client.query('ROLLBACK'); return reply.code(402).send({ error: 'Insufficient credits' }); }
    await client.query('UPDATE credit_accounts SET balance=balance-$1,updated_at=now() WHERE organization_id=$2', [item.price_credits,input.organizationId]);
    await client.query('INSERT INTO credit_ledger (organization_id,amount,reason,reference_id) VALUES ($1,$2,\'marketplace_purchase\',$3)', [input.organizationId,-item.price_credits,listingId]);
    await client.query('UPDATE marketplace_listings SET status=\'sold\',sold_at=now() WHERE id=$1', [listingId]);
    await client.query('INSERT INTO marketplace_purchases (listing_id,buyer_organization_id,buyer_user_id,price_credits) VALUES ($1,$2,$3,$4)', [listingId,input.organizationId,user.id,item.price_credits]);
    await client.query('COMMIT'); return reply.code(201).send({ listingId, leadId: item.lead_id, priceCredits: item.price_credits });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

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

async function close() { await db.end(); }
process.on('SIGTERM', () => void app.close().then(close));
process.on('SIGINT', () => void app.close().then(close));
// Railway's public service is configured for port 3000. Keep the application
// listener aligned with that published port so an injected platform PORT
// value cannot make the public domain return a 502.
await app.listen({ host: config.HOST, port: 3000 });
