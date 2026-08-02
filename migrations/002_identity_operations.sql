CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE TABLE user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, timezone text NOT NULL DEFAULT 'UTC', currency char(3) NOT NULL DEFAULT 'USD', reduced_motion boolean NOT NULL DEFAULT false,
  notifications jsonb NOT NULL DEFAULT '{"email":true,"inApp":true}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), assignee_id uuid REFERENCES users(id), entity_type text, entity_id uuid,
  title text NOT NULL, due_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX tasks_org_assignee_due_idx ON tasks(organization_id, assignee_id, due_at) WHERE completed_at IS NULL AND deleted_at IS NULL;
CREATE TABLE saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL REFERENCES users(id), resource text NOT NULL,
  name text NOT NULL, filters jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, user_id, resource, name)
);
CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
