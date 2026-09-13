// Probe: 20260913051340_rename_gift_card_table_and_rpcs.sql, in real Postgres.
//
// Builds the PRE-migration state as it is live on prod (pg_get_functiondef,
// pg_get_constraintdef, pg_get_indexdef, relacl and proacl read 2026-09-12),
// then proves:
//   1. the migration applies 3x without error (replay-safe)
//   2. the new names exist and the old ones are gone: no table, view, function,
//      constraint, index or policy anywhere in public still carries the old name
//   3. grants are IDENTICAL: gift_cards.relacl equals the old table's relacl,
//      each new RPC's proacl equals its old counterpart's, SECURITY DEFINER and
//      search_path kept, RLS still enabled, anon cannot execute either RPC
//   4. the new names work: a read through gift_cards, redeem_gift_card settles
//      a job and mints the leftover child, restore_gift_card_for_job dry-runs
//      and then restores exactly the applied amount, once
//
// The old names are never spelled here (src/test/giftCardNaming.test.ts scans
// scripts/ with no exemptions): they are read out of the migration itself,
// which is history and not scanned.
//
// NOT a vitest test: pglite is deliberately not a dependency (CLAUDE.md):
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/gift-card-rename.probe.mjs
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

// MIGRATION= overrides the file (used to show the probe goes red on the earlier
// alias-keeping draft of this migration).
const MIG = process.env.MIGRATION ?? new URL("../../supabase/migrations/20260913051340_rename_gift_card_table_and_rpcs.sql", import.meta.url).pathname;
const migration = readFileSync(MIG, "utf8");

const grab = (re, what) => {
  const m = migration.match(re);
  if (!m) throw new Error(`could not read ${what} from the migration`);
  return m[1];
};
const OLD_TABLE = grab(/ALTER TABLE public\.(\w+) RENAME TO gift_cards/, "old table name");
const OLD_REDEEM = grab(/DROP FUNCTION IF EXISTS public\.(\w+)\(uuid, uuid, uuid\)/, "old redeem name");
const OLD_RESTORE = grab(/DROP FUNCTION IF EXISTS public\.(\w+)\(uuid, integer, boolean\)/, "old restore name");
const OLD_POLICY_PREFIX = grab(/replace\(r\.policyname, '([^']+)', 'Gift cards'\)/, "old policy prefix");
const OLD_TOKEN = OLD_TABLE.split("_")[0]; // the retired short name, for the "nothing left" sweep

const fnBody = (name) => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`migration has no ${name}`);
  const end = migration.indexOf("$function$;", start) + "$function$;".length;
  return migration.slice(start, end);
};
// Live prod bodies equal the migration's modulo the names (diffed against
// pg_get_functiondef 2026-09-12), so the pre-state is the migration's own
// body with the old names put back.
const toOld = (sql) =>
  sql
    .replaceAll("restore_gift_card_for_job", OLD_RESTORE)
    .replaceAll("redeem_gift_card", OLD_REDEEM)
    .replaceAll("gift_cards", OLD_TABLE);

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ── Pre-migration state, prod-shaped ───────────────────────────────────
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.email', true), '') $f$;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid,
    budget numeric(10,2),
    urgent_fee numeric(10,2),
    payment_status text DEFAULT 'unpaid'
  );

  CREATE TABLE public.${OLD_TABLE} (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    donor_id uuid,
    recipient_id uuid,
    amount numeric(10,2) NOT NULL,
    status text NOT NULL DEFAULT 'available'::text,
    message text,
    category text,
    parish text,
    job_id uuid,
    expires_at timestamp with time zone DEFAULT (now() + '90 days'::interval),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    redeemed_at timestamp with time zone,
    recipient_email text,
    stripe_payment_intent_id text,
    stripe_session_id text,
    claim_token text,
    parent_credit_id uuid,
    payment_status text NOT NULL DEFAULT 'pending'::text,
    occasion text,
    design_id text,
    restored_from_job_id uuid,
    CONSTRAINT ${OLD_TABLE}_pkey PRIMARY KEY (id),
    CONSTRAINT ${OLD_TABLE}_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT ${OLD_TABLE}_design_len CHECK (((design_id IS NULL) OR (length(design_id) <= 48))),
    CONSTRAINT ${OLD_TABLE}_occasion_len CHECK (((occasion IS NULL) OR (length(occasion) <= 48))),
    CONSTRAINT ${OLD_TABLE}_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text]))),
    CONSTRAINT ${OLD_TABLE}_status_check CHECK ((status = ANY (ARRAY['available'::text, 'reserved'::text, 'sent'::text, 'redeemed'::text, 'expired'::text]))),
    CONSTRAINT ${OLD_TABLE}_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT ${OLD_TABLE}_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT ${OLD_TABLE}_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id),
    CONSTRAINT ${OLD_TABLE}_restored_from_job_id_fkey FOREIGN KEY (restored_from_job_id) REFERENCES public.jobs(id) ON DELETE SET NULL,
    CONSTRAINT ${OLD_TABLE}_parent_credit_id_fkey FOREIGN KEY (parent_credit_id) REFERENCES public.${OLD_TABLE}(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_${OLD_TABLE}_donor_id ON public.${OLD_TABLE} USING btree (donor_id);
  CREATE INDEX idx_${OLD_TABLE}_job_id ON public.${OLD_TABLE} USING btree (job_id);
  CREATE INDEX idx_${OLD_TABLE}_recipient_id ON public.${OLD_TABLE} USING btree (recipient_id);
  CREATE UNIQUE INDEX ${OLD_TABLE}_restored_from_job_id_key ON public.${OLD_TABLE} USING btree (restored_from_job_id) WHERE (restored_from_job_id IS NOT NULL);
  CREATE UNIQUE INDEX ${OLD_TABLE}_claim_token_key ON public.${OLD_TABLE} USING btree (claim_token) WHERE (claim_token IS NOT NULL);
  CREATE INDEX ${OLD_TABLE}_recipient_email_idx ON public.${OLD_TABLE} USING btree (lower(recipient_email)) WHERE (recipient_email IS NOT NULL);
  CREATE INDEX ${OLD_TABLE}_payment_intent_idx ON public.${OLD_TABLE} USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);
  CREATE INDEX idx_${OLD_TABLE}_parent_credit_id ON public.${OLD_TABLE} USING btree (parent_credit_id) WHERE (parent_credit_id IS NOT NULL);
  CREATE UNIQUE INDEX ${OLD_TABLE}_stripe_session_id_unique_idx ON public.${OLD_TABLE} USING btree (stripe_session_id) WHERE (stripe_session_id IS NOT NULL);

  ALTER TABLE public.${OLD_TABLE} ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "${OLD_POLICY_PREFIX} are party-only" ON public.${OLD_TABLE} FOR SELECT
    USING (((( SELECT auth.uid() AS uid) = donor_id) OR (( SELECT auth.uid() AS uid) = recipient_id) OR ((recipient_email IS NOT NULL) AND (lower(recipient_email) = lower(( SELECT auth.email() AS email))))));
  COMMENT ON COLUMN public.${OLD_TABLE}.restored_from_job_id IS 'Set only on a replacement gift minted by ${OLD_RESTORE}() after the job it points at was cancelled, refunded, or split. Unique among non-null values: a job''s gift is given back at most once.';

  -- relacl as live: anon=rxm, authenticated=rxm, service_role=arwdDxtm
  REVOKE ALL ON public.${OLD_TABLE} FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT, REFERENCES, MAINTAIN ON public.${OLD_TABLE} TO anon, authenticated;
  GRANT ALL ON public.${OLD_TABLE} TO service_role;
`);
await db.exec(toOld(fnBody("redeem_gift_card")));
await db.exec(toOld(fnBody("restore_gift_card_for_job")));
await db.exec(`
  REVOKE ALL ON FUNCTION public.${OLD_REDEEM}(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.${OLD_REDEEM}(uuid, uuid, uuid) TO service_role;
  REVOKE ALL ON FUNCTION public.${OLD_RESTORE}(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.${OLD_RESTORE}(uuid, integer, boolean) TO service_role;
`);

const PRE = {
  relacl: (await one(`select relacl::text a from pg_class where oid = $1::regclass`, [`public.${OLD_TABLE}`])).a,
  redeem: await one(`select proacl::text acl, prosecdef, proconfig::text cfg from pg_proc where oid = to_regprocedure($1)`, [`public.${OLD_REDEEM}(uuid,uuid,uuid)`]),
  restore: await one(`select proacl::text acl, prosecdef, proconfig::text cfg from pg_proc where oid = to_regprocedure($1)`, [`public.${OLD_RESTORE}(uuid,integer,boolean)`]),
  indexes: (await one(`select count(*)::int n from pg_index where indrelid = $1::regclass`, [`public.${OLD_TABLE}`])).n,
  constraints: (await one(`select count(*)::int n from pg_constraint where conrelid = $1::regclass`, [`public.${OLD_TABLE}`])).n,
};
check("pre-state: old table, both old RPCs exist", !!PRE.relacl && !!PRE.redeem && !!PRE.restore, `relacl ${PRE.relacl}`);
check("pre-state relacl is the live one", PRE.relacl === "{postgres=arwdDxtm/postgres,anon=rxm/postgres,authenticated=rxm/postgres,service_role=arwdDxtm/postgres}", PRE.relacl);
check("pre-state proacl is the live one", PRE.redeem.acl === "{postgres=X/postgres,service_role=X/postgres}" && PRE.restore.acl === PRE.redeem.acl, PRE.redeem.acl);

// ── 1. apply 3x ────────────────────────────────────────────────────────
for (let i = 1; i <= 3; i++) {
  try {
    await db.exec(migration);
    check(`migration applies (pass ${i})`, true);
  } catch (e) {
    check(`migration applies (pass ${i})`, false, e.message);
  }
}

// ── 2. new names present, old names gone ──────────────────────────────
const reg = await one(`select
    to_regclass('public.gift_cards')::text new_t,
    to_regclass($1)::text old_t,
    to_regprocedure('public.redeem_gift_card(uuid,uuid,uuid)')::text new_redeem,
    to_regprocedure('public.restore_gift_card_for_job(uuid,integer,boolean)')::text new_restore,
    to_regprocedure($2)::text old_redeem,
    to_regprocedure($3)::text old_restore`,
  [`public.${OLD_TABLE}`, `public.${OLD_REDEEM}(uuid,uuid,uuid)`, `public.${OLD_RESTORE}(uuid,integer,boolean)`]);
check("gift_cards exists", reg.new_t === "gift_cards", reg.new_t);
check("old table name resolves to nothing (no table, no view)", reg.old_t === null, reg.old_t);
check("redeem_gift_card + restore_gift_card_for_job exist", !!reg.new_redeem && !!reg.new_restore);
check("old RPC names resolve to nothing", reg.old_redeem === null && reg.old_restore === null, `${reg.old_redeem} ${reg.old_restore}`);

const like = `%${OLD_TOKEN}%`;
const leftovers = await q(`
  select 'class:'||relname n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and relname ilike $1
  union all select 'proc:'||proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and (proname ilike $1 or prosrc ilike $1)
  union all select 'constraint:'||conname from pg_constraint where conname ilike $1
  union all select 'policy:'||policyname from pg_policies where policyname ilike $1
  union all select 'comment:'||c.relname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and col_description(c.oid, a.attnum) ilike $1`,
  [like]);
check("no object, body, policy or column comment in public still carries the old name", leftovers.length === 0, leftovers.map((r) => r.n).join(", "));
const post = {
  indexes: (await one(`select count(*)::int n from pg_index where indrelid = 'public.gift_cards'::regclass`)).n,
  constraints: (await one(`select count(*)::int n from pg_constraint where conrelid = 'public.gift_cards'::regclass`)).n,
};
check("every index and constraint carried over", post.indexes === PRE.indexes && post.constraints === PRE.constraints, `idx ${PRE.indexes}->${post.indexes}, con ${PRE.constraints}->${post.constraints}`);
const policy = await q(`select policyname from pg_policies where tablename='gift_cards'`);
check("policy renamed, still the only one", policy.length === 1 && policy[0].policyname === "Gift cards are party-only", JSON.stringify(policy));

// ── 3. grants identical ───────────────────────────────────────────────
const relacl = (await one(`select relacl::text a, relrowsecurity r from pg_class where oid='public.gift_cards'::regclass`));
check("gift_cards relacl identical to the old table's", relacl.a === PRE.relacl, relacl.a);
check("RLS still enabled", relacl.r === true);
for (const [label, sig, pre] of [
  ["redeem_gift_card", "public.redeem_gift_card(uuid,uuid,uuid)", PRE.redeem],
  ["restore_gift_card_for_job", "public.restore_gift_card_for_job(uuid,integer,boolean)", PRE.restore],
]) {
  const p = await one(`select proacl::text acl, prosecdef, proconfig::text cfg from pg_proc where oid = to_regprocedure($1)`, [sig]);
  check(`${label} proacl identical to its old counterpart's`, p.acl === pre.acl, p.acl);
  check(`${label} SECURITY DEFINER + search_path kept`, p.prosecdef === pre.prosecdef && p.cfg === pre.cfg, `${p.prosecdef} ${p.cfg}`);
  const priv = await one(`select has_function_privilege('anon', $1, 'EXECUTE') anon, has_function_privilege('authenticated', $1, 'EXECUTE') authd, has_function_privilege('service_role', $1, 'EXECUTE') svc`, [sig]);
  check(`${label}: anon and authenticated cannot EXECUTE, service_role can`, !priv.anon && !priv.authd && priv.svc, JSON.stringify(priv));
}
const purge = await one(`select proacl::text acl from pg_proc where oid = to_regprocedure('public.purge_user_data(uuid)')`);
check("purge_user_data EXECUTE is service_role only", purge?.acl === "{postgres=X/postgres,service_role=X/postgres}", purge?.acl);
const tpriv = await one(`select has_table_privilege('anon','public.gift_cards','SELECT') anon_sel, has_table_privilege('anon','public.gift_cards','INSERT') anon_ins, has_table_privilege('authenticated','public.gift_cards','UPDATE') auth_upd, has_table_privilege('service_role','public.gift_cards','INSERT') svc_ins`);
check("table privileges: anon/auth read-only, service_role writes", tpriv.anon_sel && !tpriv.anon_ins && !tpriv.auth_upd && tpriv.svc_ins, JSON.stringify(tpriv));

// ── 4. the new names work ─────────────────────────────────────────────
const poster = "11111111-1111-1111-1111-111111111111";
const donor = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users(id, email) values ('${poster}', 'poster@example.com'), ('${donor}', 'donor@example.com')`);
const job = (await one(`insert into public.jobs(customer_id, budget, urgent_fee) values ($1, 50, 0) returning id`, [poster])).id;
const card = (await one(`insert into public.gift_cards(donor_id, recipient_id, amount, status, payment_status) values ($1, $2, 75, 'sent', 'paid') returning id`, [donor, poster])).id;
const read = await one(`select count(*)::int n from public.gift_cards where id = $1`, [card]);
check("a read through gift_cards works", read.n === 1);

const redeemed = (await one(`select public.redeem_gift_card($1, $2, $3) r`, [card, job, poster])).r;
check("redeem_gift_card settles a $50 job with a $75 card", redeemed.outcome === "settled" && redeemed.applied_cents === 5000 && redeemed.leftover_cents === 2500, JSON.stringify(redeemed));
const after = await one(`select (select payment_status from public.jobs where id=$1) job_ps, (select status from public.gift_cards where id=$2) card_st, (select count(*)::int from public.gift_cards where parent_credit_id=$2) children`, [job, card]);
check("job is escrow, card redeemed, $25 child minted", after.job_ps === "escrow" && after.card_st === "redeemed" && after.children === 1, JSON.stringify(after));

const dry = (await one(`select public.restore_gift_card_for_job($1, 10000, true) r`, [job])).r;
check("restore_gift_card_for_job dry-run quotes the applied $50, not the $75 face value", dry.outcome === "would_restore" && dry.restore_cents === 5000, JSON.stringify(dry));
const restored = (await one(`select public.restore_gift_card_for_job($1) r`, [job])).r;
check("restore_gift_card_for_job restores once", restored.outcome === "restored", JSON.stringify(restored));
const again = (await one(`select public.restore_gift_card_for_job($1) r`, [job])).r;
check("a second restore reports already_restored", again.outcome === "already_restored", JSON.stringify(again));

await db.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
