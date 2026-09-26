// Probe (Q331): 20260926034714_user_fks_q331_deletion_backstop.sql in real
// Postgres (PGlite). NOT a vitest test (pglite is not a dependency), so run by hand:
//
//   mkdir -p ~/.lh-pglite && cd ~/.lh-pglite && npm i @electric-sql/pglite
//   node scripts/probes/user-fks-q331.probe.mjs [migration.sql]
//
// Table shapes are prod's column lists (information_schema, read-only,
// 2026-09-26). Seeds a live user A, a user B deleted later, and orphan rows
// for a ghost id G, applies the migration THREE times (replay safety), then:
// orphans cleaned exactly as purge_user_data would (DELETE vs anonymise),
// user_bans / jobs.removed_by kept (no FK by design), a deletion that SKIPS the
// purge leaves no row naming B in any FK'd column, the purge-parity triggers
// redact (referral code, legal IP/UA, error_log UA), a new orphan insert is
// refused, and detect_suspicious_user_patterns neither errors nor pages
// (log_cron_defect) on a deleted report subject.
// RED proofs (2026-09-26): drop the pattern-2 EXISTS -> "no cron defect" fails;
// CASCADE -> NO ACTION -> the auth delete raises 23503; drop the code
// redaction -> both referral-code checks fail.
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
const MIG = readFileSync(
  process.argv[2] ?? new URL("../../supabase/migrations/20260926034714_user_fks_q331_deletion_backstop.sql", import.meta.url),
  "utf8",
);
const db = new PGlite();
const q = async (s) => (await db.query(s)).rows;
const one = async (s) => Object.values((await q(s))[0])[0];
let fails = 0;
const eq = (label, got, want) => { const ok = String(got) === String(want); if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${got}${ok ? "" : " (want " + want + ")"}`); };

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE, license_reviewed_by uuid, insurance_reviewed_by uuid);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, cancelled_by uuid, disputed_by uuid, removed_by uuid, status text, created_at timestamptz DEFAULT now(), cancelled_at timestamptz, title text, description text, parent_job_id uuid);
CREATE TABLE public.reports (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, reporter_id uuid, reported_type text NOT NULL, reported_id uuid NOT NULL, reason text NOT NULL, description text, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), assigned_to uuid);
CREATE TABLE public.user_violations (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, violation_type text NOT NULL, description text, job_id uuid, reported_by uuid, action_taken text NOT NULL DEFAULT 'warning', created_at timestamptz DEFAULT now());
CREATE TABLE public.user_bans (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, ban_type text NOT NULL DEFAULT 'temporary', reason text NOT NULL, banned_by uuid NOT NULL, expires_at timestamptz, created_at timestamptz DEFAULT now(), is_active boolean DEFAULT true);
CREATE TABLE public.referral_codes (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid UNIQUE, code text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.referral_credits (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, amount numeric NOT NULL DEFAULT 5, reason text NOT NULL, referral_code_id uuid REFERENCES public.referral_codes(id), referred_user_id uuid, redeemed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), redeemed_at timestamptz, stripe_transfer_id text);
CREATE TABLE public.referrals (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, referrer_id uuid, referred_id uuid NOT NULL UNIQUE, referral_code_id uuid NOT NULL REFERENCES public.referral_codes(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.job_checkins (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid NOT NULL, user_id uuid NOT NULL, type text NOT NULL, latitude numeric, longitude numeric, note text, created_at timestamptz DEFAULT now());
CREATE TABLE public.fraud_flags (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, job_id uuid, flag_type text NOT NULL, details text, resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.email_tracking (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, email_type text NOT NULL, event_type text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(), ip_address text, user_agent text);
CREATE TABLE public.login_history (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, ip_address text, user_agent text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.saved_jobs (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, job_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, job_id));
CREATE TABLE public.notification_logs (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, recipient_email text, category text NOT NULL, channel text NOT NULL, status text NOT NULL DEFAULT 'sent', subject text, job_id uuid, error_message text, message_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.admin_user_notes (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, admin_id uuid NOT NULL, note text NOT NULL, category text NOT NULL DEFAULT 'general', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.error_logs (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid, severity text NOT NULL DEFAULT 'error', message text NOT NULL, stack text, url text, user_agent text, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.analytics_events (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid, event text NOT NULL, properties jsonb NOT NULL DEFAULT '{}', url text, referrer text, platform text NOT NULL DEFAULT 'web', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.legal_acceptances (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid, terms_version text NOT NULL, privacy_version text NOT NULL, marketing_opted_in boolean NOT NULL DEFAULT false, ip_address text, user_agent text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.push_tokens (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, token text NOT NULL, platform text NOT NULL, device_id text, app_version text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, token));
CREATE TABLE public.saved_searches (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
CREATE TABLE public.notification_dedupe_suppressions (id bigserial PRIMARY KEY, user_id uuid NOT NULL, type text, title text, link text, suppressed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.dispute_settlement_claims (job_id uuid NOT NULL PRIMARY KEY, action text NOT NULL, claimed_by uuid, token uuid NOT NULL DEFAULT gen_random_uuid(), claimed_at timestamptz NOT NULL DEFAULT now(), money_step_at timestamptz);
CREATE TABLE public.job_completion_nudges (job_id uuid NOT NULL PRIMARY KEY, first_sent_at timestamptz, second_sent_at timestamptz, escalated_at timestamptz, resolved_at timestamptz, resolved_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cron_defects (msg text);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.cron_defects VALUES (c) $$;
`);

// Live users A (survives), B (deleted later), G = ghost id with no auth row.
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002", G = "99999999-0000-0000-0000-000000000009";
await db.exec(`
INSERT INTO auth.users VALUES ('${A}','a@x'),('${B}','b@x');
INSERT INTO public.profiles (user_id, license_reviewed_by, insurance_reviewed_by) VALUES ('${A}','${B}','${G}'),('${B}',NULL,NULL);
INSERT INTO public.jobs (customer_id, cancelled_by, disputed_by, removed_by) VALUES ('${A}','${B}','${G}','${G}');
-- CASCADE tables: one live-A row, one B row, orphans (G)
INSERT INTO public.notification_logs (user_id, category, channel) SELECT u,'c','in_app' FROM (VALUES ('${A}'::uuid),('${B}'),('${G}'),('${G}'),('${G}')) v(u);
INSERT INTO public.login_history (user_id, ip_address) SELECT u,'1.2.3.4' FROM (VALUES ('${A}'::uuid),('${B}'),('${G}'),('${G}')) v(u);
INSERT INTO public.notification_dedupe_suppressions (user_id) SELECT u FROM (VALUES ('${A}'::uuid),('${B}'),('${G}')) v(u);
INSERT INTO public.admin_user_notes (user_id, admin_id, note) VALUES ('${B}','${A}','n'),('${G}','${A}','orphan');
INSERT INTO public.fraud_flags (user_id, flag_type) VALUES ('${B}','x');
INSERT INTO public.push_tokens (user_id, token, platform) VALUES ('${B}','t','ios');
INSERT INTO public.saved_jobs (user_id, job_id) VALUES ('${B}', gen_random_uuid());
INSERT INTO public.saved_searches (user_id, name) VALUES ('${B}','s');
INSERT INTO public.email_tracking (user_id, email_type) VALUES ('${B}','w');
INSERT INTO public.job_checkins (job_id, user_id, type) VALUES (gen_random_uuid(),'${B}','arrive');
INSERT INTO public.user_violations (user_id, violation_type, reported_by) VALUES ('${B}','v',NULL),('${A}','v','${B}');
-- SET NULL tables
INSERT INTO public.analytics_events (user_id, event) SELECT u,'e' FROM (VALUES ('${A}'::uuid),('${B}'),('${G}'),('${G}')) v(u);
INSERT INTO public.error_logs (user_id, message, user_agent) VALUES ('${A}','m','ua'),('${B}','m','ua'),('${G}','m','ua');
INSERT INTO public.legal_acceptances (user_id, terms_version, privacy_version, ip_address, user_agent) VALUES ('${B}','1','1','ip','ua'),('${G}','1','1','ip','ua');
INSERT INTO public.referral_codes (id, user_id, code) VALUES ('c0000000-0000-0000-0000-00000000000a','${A}','AAA'),('c0000000-0000-0000-0000-00000000000b','${B}','BBB'),('c0000000-0000-0000-0000-00000000000c','${G}','GGG');
INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id) VALUES ('${B}','${A}','c0000000-0000-0000-0000-00000000000b');
INSERT INTO public.referral_credits (user_id, reason, referred_user_id) VALUES ('${A}','referrer_bonus','${B}'),('${B}','first_job_bonus','${A}');
INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_by) VALUES (gen_random_uuid(),'release','${B}');
INSERT INTO public.job_completion_nudges (job_id, resolved_by) VALUES (gen_random_uuid(),'${B}');
INSERT INTO public.user_bans (user_id, reason, banned_by) VALUES ('${G}','kept','${G}'),('${B}','kept','${A}');
-- 3 distinct reporters about the ghost and about A
INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) SELECT gen_random_uuid(),'user',s,'r' FROM (VALUES ('${G}'::uuid),('${G}'),('${G}'),('${A}'),('${A}'),('${A}')) v(s);
`);

for (let i = 1; i <= 3; i++) { await db.exec(MIG); console.log(`applied ${i}x`); }

eq("FK count added", await one(`select count(*) from pg_constraint where contype='f' and confrelid='auth.users'::regclass and conname ~ '_(user_id|referred_user_id|reported_by|referrer_id|referred_id|cancelled_by|disputed_by|license_reviewed_by|insurance_reviewed_by|claimed_by|resolved_by)_fkey$' and conrelid <> 'public.profiles'::regclass or (conrelid='public.profiles'::regclass and conname ~ 'reviewed_by')`), 26);
eq("all validated", await one(`select count(*) from pg_constraint where contype='f' and not convalidated`), 0);
eq("orphan notification_logs deleted", await one(`select count(*) from notification_logs where user_id='${G}'`), 0);
eq("live notification_logs kept", await one(`select count(*) from notification_logs`), 2);
eq("orphan login_history deleted", await one(`select count(*) from login_history`), 2);
eq("orphan dedupe deleted", await one(`select count(*) from notification_dedupe_suppressions`), 2);
eq("orphan admin note deleted", await one(`select count(*) from admin_user_notes`), 1);
eq("orphan analytics anonymised (rows kept)", await one(`select count(*) filter (where user_id is null) || '/' || count(*) from analytics_events`), "2/4");
eq("orphan error_log: user_id+UA nulled", await one(`select count(*) from error_logs where user_id is null and user_agent is null`), 1);
eq("orphan legal acceptance: ip+UA nulled", await one(`select count(*) from legal_acceptances where user_id is null and ip_address is null and user_agent is null`), 1);
eq("orphan referral code redacted", await one(`select code from referral_codes where id='c0000000-0000-0000-0000-00000000000c'`), "REDACTED-c000000000000000000000000000000c");
eq("profile orphan reviewer nulled, live kept", await one(`select coalesce(license_reviewed_by::text,'null')||','||coalesce(insurance_reviewed_by::text,'null') from profiles where user_id='${A}'`), `${B},null`);
eq("jobs orphan disputed_by nulled, removed_by (no FK) kept", await one(`select coalesce(disputed_by::text,'null')||','||removed_by from jobs`), `null,${G}`);
eq("user_bans orphan kept (no FK)", await one(`select count(*) from user_bans where user_id='${G}'`), 1);

// detect_suspicious_user_patterns: ghost subject skipped, live subject flagged, no FK error.
eq("detect flags only the live subject", await one(`select public.detect_suspicious_user_patterns()`), 1);
eq("no cron defect logged (no 23503 on a deleted subject)", await one(`select count(*) from cron_defects`), 0);
eq("flag is on A", await one(`select count(*) from fraud_flags where user_id='${A}' and flag_type='multi_reporter_flag'`), 1);

// Account deletion that SKIPS purge: every row of B goes or loses B.
await db.exec(`DELETE FROM auth.users WHERE id='${B}'`);
const tables = await q(`select conrelid::regclass::text t, a.attname c from pg_constraint k join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1] where k.contype='f' and k.confrelid='auth.users'::regclass`);
let left = 0;
for (const { t, c } of tables) left += Number(await one(`select count(*) from ${t} where ${c}='${B}'`));
eq("rows still naming deleted B (all FK'd columns)", left, 0);
eq("B's user_bans row retained (no FK, by design)", await one(`select count(*) from user_bans where user_id='${B}'`), 1);
eq("B's referral code redacted", await one(`select code from referral_codes where id='c0000000-0000-0000-0000-00000000000b'`), "REDACTED-c000000000000000000000000000000b");
eq("A's referral credit kept, referred_user_id nulled", await one(`select count(*) from referral_credits where user_id='${A}' and referred_user_id is null`), 1);
eq("referral from B kept with referrer NULL", await one(`select count(*) from referrals where referrer_id is null`), 1);
eq("B's legal acceptance anonymised", await one(`select count(*) from legal_acceptances where ip_address is not null`), 0);
eq("A's error log UA untouched", await one(`select user_agent from error_logs where user_id='${A}'`), "ua");
eq("A's referral code untouched", await one(`select code from referral_codes where user_id='${A}'`), "AAA");

// A new orphan insert is now refused.
let refused = false;
try { await db.exec(`INSERT INTO public.login_history (user_id) VALUES ('${G}')`); } catch (e) { refused = /foreign key/.test(e.message); }
eq("orphan insert refused (23503)", refused, true);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
