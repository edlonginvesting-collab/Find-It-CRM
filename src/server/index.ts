// Public-site deployment entrypoint. The authenticated CRM API remains a separate
// Node service; the published company site is served by the platform asset binding.
export default {
  async fetch(request: Request, env: { ASSETS: { fetch: (request: Request) => Promise<Response> }; DB: { prepare: (sql: string) => { run: () => Promise<unknown>; bind: (...values: string[]) => { run: () => Promise<unknown> } } } }) {
    const url = new URL(request.url);
    if (url.pathname === '/api/walkthrough' && request.method === 'POST') {
      const body = await request.json() as { displayName?: string; email?: string; organizationName?: string };
      const displayName = body.displayName?.trim();
      const email = body.email?.trim().toLowerCase();
      const organizationName = body.organizationName?.trim();
      if (!displayName || !email || !organizationName || !email.includes('@')) {
        return new Response(JSON.stringify({ error: 'Please complete all fields.' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS walkthrough_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL, email TEXT NOT NULL, organization_name TEXT NOT NULL, created_at TEXT NOT NULL)').run();
      await env.DB.prepare('INSERT INTO walkthrough_requests (display_name,email,organization_name,created_at) VALUES (?,?,?,?)').bind(displayName, email, organizationName, new Date().toISOString()).run();
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    return env.ASSETS.fetch(request);
  }
};
