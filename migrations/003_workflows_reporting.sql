CREATE TABLE buyers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), contact_id uuid NOT NULL REFERENCES contacts(id),
  markets text[] NOT NULL DEFAULT '{}', minimum_price numeric(14,2), maximum_price numeric(14,2), criteria jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX buyers_org_active_idx ON buyers(organization_id) WHERE deleted_at IS NULL;
CREATE TABLE buyer_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), deal_id uuid NOT NULL REFERENCES deals(id), buyer_id uuid NOT NULL REFERENCES buyers(id),
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100), status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','contacted','interested','declined','assigned')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (deal_id,buyer_id)
);
CREATE TABLE sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, active boolean NOT NULL DEFAULT true,
  steps jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,name)
);
CREATE TABLE sequence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), sequence_id uuid NOT NULL REFERENCES sequences(id), lead_id uuid NOT NULL REFERENCES leads(id),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','completed','cancelled')), next_step_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (sequence_id,lead_id)
);
CREATE INDEX sequence_enrollments_due_idx ON sequence_enrollments(organization_id,next_step_at) WHERE state='active';
CREATE TABLE metric_daily (
  organization_id uuid NOT NULL REFERENCES organizations(id), day date NOT NULL, source text NOT NULL DEFAULT '', leads_created integer NOT NULL DEFAULT 0,
  leads_qualified integer NOT NULL DEFAULT 0, offers_sent integer NOT NULL DEFAULT 0, deals_closed integer NOT NULL DEFAULT 0, assignment_revenue numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id,day,source)
);
