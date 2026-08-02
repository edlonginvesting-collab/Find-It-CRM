CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  currency char(3) NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','admin','manager','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  first_name text, last_name text, email citext, phone text, owner_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX contacts_org_email_unique ON contacts(organization_id, email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX contacts_org_owner_idx ON contacts(organization_id, owner_id) WHERE deleted_at IS NULL;

CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  address_line1 text NOT NULL, city text NOT NULL, region text NOT NULL, postal_code text NOT NULL,
  arv numeric(14,2), repairs numeric(14,2), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX properties_org_address_unique ON properties(organization_id, address_line1, city, region, postal_code) WHERE deleted_at IS NULL;

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  contact_id uuid NOT NULL REFERENCES contacts(id), property_id uuid REFERENCES properties(id), owner_id uuid REFERENCES users(id),
  source text NOT NULL, status text NOT NULL DEFAULT 'new', score integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX leads_org_status_owner_idx ON leads(organization_id, status, owner_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  lead_id uuid REFERENCES leads(id), property_id uuid REFERENCES properties(id), owner_id uuid REFERENCES users(id),
  stage text NOT NULL DEFAULT 'lead', offer_amount numeric(14,2), mao numeric(14,2), assignment_fee numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX deals_org_stage_owner_idx ON deals(organization_id, stage, owner_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE deal_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), deal_id uuid NOT NULL REFERENCES deals(id),
  from_stage text, to_stage text NOT NULL, changed_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_stage_history_deal_idx ON deal_stage_history(deal_id, created_at DESC);

CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), actor_id uuid REFERENCES users(id),
  entity_type text NOT NULL, entity_id uuid NOT NULL, kind text NOT NULL, body jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_org_entity_idx ON activities(organization_id, entity_type, entity_id, created_at DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id), actor_id uuid REFERENCES users(id),
  action text NOT NULL, entity_type text NOT NULL, entity_id uuid, before jsonb, after jsonb, request_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_created_idx ON audit_events(organization_id, created_at DESC);
