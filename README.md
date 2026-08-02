# CRM Platform

Operational CRM foundation. Run `copy .env.example .env`, `docker compose up -d`, `npm install`, `npm run db:migrate`, then `npm run dev`.

The application binds to loopback by default. Put its private origin behind a remotely managed Cloudflare Tunnel; never expose PostgreSQL or Redis publicly.

## Railway deployment

The repository includes `railway.toml`. Create one Railway project with the CRM service, PostgreSQL, and Redis services. Set `DATABASE_URL` and `REDIS_URL` from the service references, set `APP_ORIGIN` to the deployed HTTPS URL, and add the Stripe variables from `.env.example` through Railway's encrypted variables. The deploy command runs migrations before starting the service and exposes `/health` for Railway health checks.

## Revenue launch order

The product is designed around two revenue streams: recurring CRM subscriptions and exclusive marketplace lead purchases. The database now contains the plan catalog, trial credit grant, credit ledger, and atomic listing purchase flow.

Before accepting real money:

1. Apply migrations and verify the plan and credit tables.
2. Create matching Stripe Products and recurring Prices for the four plan IDs.
3. Implement Stripe Checkout, Customer Portal, and signed webhook processing. Webhooks—not browser redirects—must activate, renew, suspend, and cancel access.
4. Add an approved lead source and populate marketplace listings only after quality and compliance checks.
5. Test duplicate purchases, insufficient credits, webhook retries, refunds, cancellation, and failed payments in Stripe test mode.
6. Run `npm run release:verify` from a clean install before deployment.

Do not advertise lead volume, exclusivity, verified contact data, or guaranteed results until the source contracts, suppression process, and operational metrics support those claims.
