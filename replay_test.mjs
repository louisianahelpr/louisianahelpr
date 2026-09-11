// Migration replay-safety test using PGlite
// Tests all migrations in order on a clean DB with Supabase stubs

const { PGlite } = await import('/tmp/pglite-test/node_modules/@electric-sql/pglite/dist/index.js');
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = '/home/user/louisianahelpr/supabase/migrations';

const BOOTSTRAP_SQL = `
-- Schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS supabase_functions;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS pgmq;
CREATE SCHEMA IF NOT EXISTS pg_catalog_ext;

-- Roles that Supabase pre-creates
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres SUPERUSER;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashboard_user') THEN
    CREATE ROLE dashboard_user;
  END IF;
END $$;

-- uuid-ossp compat
CREATE OR REPLACE FUNCTION public.uuid_generate_v4() RETURNS uuid
LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
CREATE OR REPLACE FUNCTION extensions.uuid_generate_v4() RETURNS uuid
LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;

-- auth schema
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text DEFAULT 'authenticated',
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token text,
  confirmation_sent_at timestamptz,
  recovery_token text,
  recovery_sent_at timestamptz,
  email_change_token_new text,
  email_change text,
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb DEFAULT '{}',
  raw_user_meta_data jsonb DEFAULT '{}',
  is_super_admin boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  phone text,
  phone_confirmed_at timestamptz,
  phone_change text,
  phone_change_token text,
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz,
  email_change_token_current text,
  email_change_confirm_status smallint DEFAULT 0,
  banned_until timestamptz,
  reauthentication_token text,
  reauthentication_sent_at timestamptz,
  is_sso_user boolean DEFAULT false,
  deleted_at timestamptz,
  is_anonymous boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS auth.identities (
  provider_id text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL DEFAULT '{}',
  provider text NOT NULL,
  last_sign_in_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  email text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  factor_id uuid,
  aal text,
  not_after timestamptz,
  refreshed_at timestamptz,
  user_agent text,
  ip inet,
  tag text
);

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  friendly_name text,
  factor_type text,
  status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  secret text
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT 'test@example.com'::text $$;

-- storage schema
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz,
  metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version text,
  owner_id text,
  user_metadata jsonb
);

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT string_to_array(name, '/')
$$;

CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;

CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT (string_to_array(storage.filename(name), '.'))[array_length(string_to_array(storage.filename(name), '.'), 1)]
$$;

-- net schema (pg_net stubs)
CREATE TABLE IF NOT EXISTS net._http_response (
  id bigint,
  status_code integer,
  headers jsonb,
  body text,
  timed_out boolean,
  error_msg text,
  created timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT NULL, headers jsonb DEFAULT NULL, timeout_milliseconds integer DEFAULT 2000)
RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;

CREATE OR REPLACE FUNCTION net.http_get(url text, headers jsonb DEFAULT NULL, timeout_milliseconds integer DEFAULT 2000)
RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;

-- vault stubs
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text DEFAULT '',
  secret text,
  key_id uuid,
  nonce bytea,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO vault.secrets(id, name, description, secret, key_id, created_at, updated_at)
  VALUES (v_id, new_name, COALESCE(new_description, ''), new_secret, new_key_id, now(), now())
  ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret, updated_at = now();
  RETURN v_id;
END;
$$;

-- cron schema (pg_cron stubs)
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text,
  command text,
  nodename text DEFAULT 'localhost',
  nodeport integer DEFAULT 5432,
  database text DEFAULT 'postgres',
  username text DEFAULT 'postgres',
  active boolean DEFAULT true,
  jobname text UNIQUE
);

CREATE TABLE IF NOT EXISTS cron.job_run_details (
  jobid bigint,
  runid bigserial PRIMARY KEY,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);

CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text)
RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES(job_name, schedule, command)
  ON CONFLICT(jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid
$$;

CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text)
RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)
RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobname = job_name;
  SELECT true
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(jobid bigint)
RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_s text := schedule; v_c text := command; v_a boolean := active;
BEGIN
  UPDATE cron.job SET
    schedule = COALESCE(v_s, cron.job.schedule),
    command  = COALESCE(v_c, cron.job.command),
    active   = COALESCE(v_a, cron.job.active)
  WHERE jobid = job_id;
END;
$$;

-- pgmq stubs
CREATE OR REPLACE FUNCTION pgmq.create(queue_name text)
RETURNS void LANGUAGE sql AS $$ SELECT NULL $$;

CREATE OR REPLACE FUNCTION pgmq.send(queue_name text, msg jsonb, delay integer DEFAULT 0)
RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;

CREATE OR REPLACE FUNCTION pgmq.read(queue_name text, vt integer, qty integer)
RETURNS TABLE(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
LANGUAGE sql AS $$ SELECT NULL::bigint, NULL::integer, NULL::timestamptz, NULL::timestamptz, NULL::jsonb WHERE false $$;

CREATE OR REPLACE FUNCTION pgmq.delete(queue_name text, msg_id bigint)
RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

-- supabase_functions stubs
CREATE TABLE IF NOT EXISTS supabase_functions.hooks (
  id bigserial PRIMARY KEY,
  hook_table_id integer,
  hook_name text,
  created_at timestamptz DEFAULT now(),
  request_id bigint
);

CREATE OR REPLACE FUNCTION supabase_functions.http_request()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END;
$$;

-- realtime stubs
CREATE TABLE IF NOT EXISTS realtime.messages (
  id bigserial PRIMARY KEY,
  topic text,
  extension text,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  inserted_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS realtime.subscription (
  id bigserial PRIMARY KEY,
  subscription_id uuid,
  entity text,
  filters text[],
  claims jsonb,
  claims_role text,
  created_at timestamptz DEFAULT now()
);

-- realtime.topic() function
CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT ''::text $$;

-- Supabase Realtime publication
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- vault.decrypted_secrets view
CREATE TABLE IF NOT EXISTS vault._secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text DEFAULT '',
  secret text,
  key_id uuid,
  nonce bytea,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret AS decrypted_secret, key_id, nonce, created_at, updated_at
  FROM vault.secrets;
`;

// Preprocess SQL to skip unavailable extensions
function preprocessSQL(sql) {
  // Replace CREATE EXTENSION and COMMENT ON EXTENSION for unsupported ones.
  // Use a single regex (not two sequential ones) to avoid re-matching the
  // comment text we just inserted on a second pass.
  const unsupportedExts = ['pg_cron', 'pg_net', 'supabase_vault', 'pgmq', 'pgcrypto', '"uuid-ossp"', 'uuid-ossp', 'pgjwt', 'pg_stat_statements', 'postgis'];
  let processed = sql;
  for (const ext of unsupportedExts) {
    const escaped = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // CREATE EXTENSION (with or without IF NOT EXISTS)
    const reCreate = new RegExp(`CREATE\\s+EXTENSION(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${escaped}[^;]*;`, 'gi');
    processed = processed.replace(reCreate, `-- skipped: CREATE EXTENSION ${ext}`);
    // COMMENT ON EXTENSION (pg_cron etc. not registered as real extensions in PGlite)
    const reComment = new RegExp(`COMMENT\\s+ON\\s+EXTENSION\\s+${escaped}[^;]*;`, 'gis');
    processed = processed.replace(reComment, `-- skipped: COMMENT ON EXTENSION ${ext}`);
  }
  return processed;
}

async function main() {
  const db = new PGlite();

  try {
    await db.exec(BOOTSTRAP_SQL);
    console.log('Bootstrap: OK');
  } catch (e) {
    console.error('Bootstrap FAILED:', e.message);
    process.exit(1);
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Testing ${files.length} migrations...`);

  const failures = [];
  let passed = 0;

  for (const file of files) {
    const filePath = join(MIGRATIONS_DIR, file);
    const rawSql = readFileSync(filePath, 'utf8');
    const sql = preprocessSQL(rawSql);

    try {
      await db.exec(sql);
      passed++;
    } catch (e) {
      failures.push({ file, error: e.message });
      console.error(`FAIL [${file}]: ${e.message.substring(0, 300)}`);
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Passed: ${passed}/${files.length}`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log('\nFailed migrations:');
    for (const f of failures) {
      console.log(`  ${f.file}`);
      console.log(`    ${f.error.substring(0, 400)}`);
    }
  }

  await db.close();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
