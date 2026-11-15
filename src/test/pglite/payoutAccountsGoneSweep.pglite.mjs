/**
 * PGlite proof for 20261115033601_clear_payout_accounts_gone_with_platform_rejection (Q2794): the sweep clears the
 * link (id + the three cached gate columns) of exactly the listed Stripe account ids on non-seed profiles, leaves
 * every other profile alone (a seed profile on a listed id, a live account, a member with none), writes one
 * record-only error_logs row per clear that the REAL newest Slack and ops-ledger triggers neither post nor record
 * (the origin stamp included), writes no record for a clear a trigger refused, and is replay-safe (applied 3x:
 * still one row per clear). `profiles` is a stub here: the prod triggers on it (prevent_self_escalation lets a
 * server-context write through; the email, pending-accept and verification-history triggers do not act on these
 * columns) were read on prod by the lh-money-escrow review, 2026-11-14.
 *
 *   node src/test/pglite/payoutAccountsGoneSweep.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/payoutAccountsGoneSweep.pglite.mjs   # RED: the state on main
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Named by src/test/edge/payoutAccountsGoneSweep.test.ts.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { newestFunction } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const FILE = "20261115033601_clear_payout_accounts_gone_with_platform_rejection.sql";
const NEW = readFileSync(MIG + FILE, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x'), ('service_role_key', 'k');
CREATE TABLE public.posted (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO public.posted VALUES (body) RETURNING 1::bigint $$;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message text, severity text, tags jsonb NOT NULL DEFAULT '{}'::jsonb, url text, context jsonb, user_id uuid, user_agent text, stack text, created_at timestamptz DEFAULT now());
CREATE TABLE public.recorded (source text, title text, severity text);
CREATE FUNCTION public.error_log_is_seed(jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(($1 ->> 'seed')::boolean, false) $$;
CREATE FUNCTION public.ops_alert_record(p_kind text, p_source text, p_title text, p_severity text, p_sample text, p_ref jsonb,
  p_a text, p_b text, p_at timestamptz) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.recorded VALUES (p_source, p_title, p_severity) $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, stripe_account_id text,
  stripe_payouts_enabled boolean DEFAULT false, stripe_charges_enabled boolean DEFAULT false, stripe_identity_verified boolean DEFAULT false);
`);
for (const n of ["stamp_error_log_origin", "error_log_is_record_only", "notify_slack_on_error_log", "ops_alert_ledger_from_error_log"]) {
  await db.exec(newestFunction(n).stmt);
}
await db.exec(`
CREATE TRIGGER trg_error_logs_00_stamp_origin BEFORE INSERT ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public.stamp_error_log_origin();
CREATE TRIGGER trg_error_logs_slack AFTER INSERT ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public.notify_slack_on_error_log();
CREATE TRIGGER trg_error_logs_zz_ledger AFTER INSERT ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public.ops_alert_ledger_from_error_log();
`);

const GONE = [...NEW.matchAll(/'(acct_[A-Za-z0-9]+)'/g)].map((m) => m[1]);
check("the migration names 16 Stripe account ids (floor)", GONE.length === 16, String(GONE.length));
const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
for (const [i, acct] of GONE.entries()) {
  await db.query(`INSERT INTO public.profiles VALUES ($1, false, $2, false, true, true)`, [uid(i + 1), acct]);
}
const SEED = uid(100), LIVE = uid(101), NONE = uid(102);
// A seed profile on a listed id, a member on a live account, a member with no account: none may move.
await db.query(`UPDATE public.profiles SET is_seed = true WHERE user_id = $1`, [uid(16)]);
await db.query(`INSERT INTO public.profiles VALUES ($1, false, 'acct_1UQDLA3KPlb4n0ev', true, true, true), ($2, false, NULL, false, false, false), ($3, true, 'acct_seed_fixture', true, true, true)`, [LIVE, NONE, SEED]);

// A trigger that refuses one member's change (BEFORE UPDATE returning NULL): that clear did not happen.
await db.exec(`CREATE FUNCTION public.refuse_one() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.user_id = '${uid(15)}' THEN RETURN NULL; END IF; RETURN NEW; END $$;
  CREATE TRIGGER refuse_one BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.refuse_one();`);
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const row = async (u) => (await db.query(`SELECT * FROM public.profiles WHERE user_id = $1`, [u])).rows[0];
let cleared = 0;
for (let i = 1; i <= 14; i++) {
  const p = await row(uid(i));
  if (p.stripe_account_id === null && !p.stripe_payouts_enabled && !p.stripe_charges_enabled && !p.stripe_identity_verified) cleared++;
}
check("each listed id on a non-seed profile is cleared with its three gate columns", cleared === 14, `${cleared} of 14`);
const seedOnListed = await row(uid(16));
check("a seed profile on a listed id is not touched", seedOnListed.stripe_account_id === GONE[15] && seedOnListed.stripe_charges_enabled === true, JSON.stringify(seedOnListed));
const live = await row(LIVE);
check("a member on a live account is not touched", live.stripe_account_id === "acct_1UQDLA3KPlb4n0ev" && live.stripe_payouts_enabled === true);
check("a member with no account stays as they were", (await row(NONE)).stripe_account_id === null);
check("a seed fixture's account is not touched", (await row(SEED)).stripe_account_id === "acct_seed_fixture");

const logs = (await db.query(`SELECT user_id, tags, context FROM public.error_logs ORDER BY context->>'old_account_id'`)).rows;
check("one record row per clear, replayed 3x", logs.length === 14, String(logs.length));
check("a clear a trigger refused leaves its link and writes no record", (await row(uid(15))).stripe_account_id === GONE[14] && !logs.some((l) => l.user_id === uid(15)));
check("every record row is server-stamped and record-only", logs.length > 0 && logs.every((l) => l.tags.origin === "server" && l.tags.kind === "connect-dead-account-close" && l.tags.source === "stripe-connect"), JSON.stringify(logs[0]?.tags));
check("each row names the old account and its member", logs.length > 0 && logs.every((l) => { const i = GONE.indexOf(l.context.old_account_id); return i >= 0 && i < 14 && l.user_id === uid(i + 1); }));
const n = async (t) => (await db.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
check("nothing was posted to Slack", (await n("posted")) === 0, String(await n("posted")));
check("nothing reached the ops ledger", (await n("recorded")) === 0, String(await n("recorded")));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
