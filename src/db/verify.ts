import { db } from './client.js';
const required = ['organizations','users','memberships','contacts','properties','leads','deals','deal_stage_history','activities','audit_events','sessions','tasks','buyers','buyer_matches','sequences','sequence_enrollments','metric_daily'];
const { rows } = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
const actual = new Set(rows.map((row) => row.tablename));
for (const table of required) if (!actual.has(table)) throw new Error(`Missing required table: ${table}`);
await db.end();
