# CRM Platform

Operational CRM foundation. Run `copy .env.example .env`, `docker compose up -d`, `npm install`, `npm run db:migrate`, then `npm run dev`.

The application binds to loopback by default. Put its private origin behind a remotely managed Cloudflare Tunnel; never expose PostgreSQL or Redis publicly.
