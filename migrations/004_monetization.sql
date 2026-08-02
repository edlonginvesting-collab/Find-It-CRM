CREATE TABLE plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  monthly_price_cents integer NOT NULL CHECK (monthly_price_cents >= 0),
  included_credits integer NOT NULL DEFAULT 0 CHECK (included_credits >= 0),
  max_users integer NOT NULL CHECK (max_users > 0),
  features jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true
);

INSERT INTO plans (id,name,monthly_price_cents,included_credits,max_users,features) VALUES
  ('starter','Starter',2900,25,1,'{"automation":false,"analytics":false,"api":false}'),
  ('professional','Professional',7900,100,3,'{"automation":true,"analytics":true,"api":false}'),
  ('business','Business',17900,300,12,'{"automation":true,"analytics":true,"api":false,"prioritySupport":true}'),
  ('scale','Scale',39900,750,50,'{"automation":true,"analytics":true,"api":true,"prioritySupport":true,"customFeeds":true}')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_id text NOT NULL DEFAULT 'starter' REFERENCES plans(id);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'trial' CHECK (billing_status IN ('trial','active','past_due','cancelled','suspended'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days');
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE TABLE credit_accounts (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount <> 0), reason text NOT NULL, reference_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_org_created_idx ON credit_ledger(organization_id,created_at DESC);

CREATE TABLE marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  lead_id uuid NOT NULL REFERENCES leads(id), price_credits integer NOT NULL CHECK (price_credits > 0),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','withdrawn')), quality_score integer CHECK (quality_score BETWEEN 0 AND 100),
  source_date date, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), sold_at timestamptz
);
CREATE UNIQUE INDEX marketplace_one_active_lead_idx ON marketplace_listings(lead_id) WHERE status IN ('available','sold');
CREATE INDEX marketplace_available_idx ON marketplace_listings(status,created_at DESC) WHERE status='available';

CREATE TABLE marketplace_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL UNIQUE REFERENCES marketplace_listings(id),
  buyer_organization_id uuid NOT NULL REFERENCES organizations(id), buyer_user_id uuid NOT NULL REFERENCES users(id),
  price_credits integer NOT NULL CHECK (price_credits > 0), created_at timestamptz NOT NULL DEFAULT now()
);
