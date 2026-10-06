#!/usr/bin/env node
/**
 * PGlite proof for 20261006020751_payout_hold_freezes_stripe_auto_payouts
 * (docs/OPEN.md Q1221, owner decision 2026-10-05).
 *
 *   node src/test/pglite/payoutHoldFreezesStripePayouts.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/payoutHoldFreezesStripePayouts.pglite.mjs   # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: Q764's payout hold exactly as live, by REPLAYING
 * 20261004162921_payout_holds_server_side verbatim over the same live-shaped
 * tables its own proof uses (payoutHoldServerSide.pglite.mjs), plus
 * error_logs. No pg_net / vault / pg_cron here, so the kick reports "not sent"
 * and the cron is not scheduled; both are guarded in the migration.
 *
 * Then the new migration 3x (replay-safe), and:
 *   - an admin's hold asks for a pause (who asked is recorded); RED live;
 *   - re-placing or denying a paused hold leaves it paused;
 *   - a release asks for a restore and KEEPS the saved schedule;
 *   - a re-hold before the restore ran asks for a pause again with the
 *     ORIGINAL saved schedule;
 *   - a release before any pause still asks (the sync decides nothing paused);
 *   - the sweep counts stale requests, pages ONE fatal error_logs row per stuck
 *     request (and not again within 6 hours), and pages a stuck RESTORE too;
 *   - admins read the table, a non-admin reads nothing, anon has no grant, no
 *     client writes it; no client may run the sweep, the kick or the trigger.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (name) =>
  readFileSync(new URL(`../../../supabase/migrations/${name}.sql`, import.meta.url).pathname, "utf8");
const Q764 = mig("20261004162921_payout_holds_server_side");
const NEW = mig("20261006020751_payout_hold_freezes_stripe_auto_payouts");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const ADMIN2 = "aaaaaaaa-0000-4000-8000-000000000009";
const HELPER = "bbbbbbbb-0000-4000-8000-000000000002";
const OTHER = "cccccccc-0000-4000-8000-000000000003";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${ADMIN2}'), ('${HELPER}'), ('${OTHER}');

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin');
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated, service_role;

CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE TABLE public.payout_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
  helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, stripe_transfer_id text UNIQUE,
  stripe_account_id text, amount_cents integer NOT NULL, status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- error_logs: live columns (information_schema 2026-10-05).
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, severity text NOT NULL DEFAULT 'error',
  message text NOT NULL, stack text, url text, user_agent text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);

try { await db.exec(Q764); } catch (e) { check("Q764 migration replays", false, e.message); }

if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) {
    try { await db.exec(NEW); }
    catch (e) { check(`migration applies (run ${i + 1})`, false, e.message); }
  }
}

/** Run `sql` as `who` (an auth uid, "service", or null for anon). */
async function as(who, sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const freeze = async (helper = HELPER) => {
  try {
    return (await db.query(`SELECT * FROM public.payout_schedule_freezes WHERE helper_id = $1`, [helper])).rows[0] ?? null;
  } catch {
    return null; // RED mode: the table does not exist
  }
};
/** What payout-hold-stripe-sync writes after Stripe took the pause. */
const syncPaused = (prior) =>
  db.query(
    `UPDATE public.payout_schedule_freezes SET freeze_state = 'paused', stripe_account_id = 'acct_x', prior_schedule = $2::jsonb WHERE helper_id = $1`,
    [HELPER, JSON.stringify(prior)],
  ).catch(() => null);
const DAILY = { interval: "daily", delay_days: 2 };

// ── A hold asks for a pause ────────────────────────────────────────────────
const placed = await as(ADMIN, `SELECT * FROM public.admin_set_payout_hold('${HELPER}', 'fraud review')`);
check("an admin places a hold (Q764 unchanged)", placed.ok, placed.err ?? "");
let f = await freeze();
check("the hold asks Stripe to pause the Helpr's automatic payouts", f?.freeze_state === "pause_requested", JSON.stringify(f));
check("…naming the admin who asked", f?.requested_by === ADMIN);

await syncPaused(DAILY);
const reheld = await as(ADMIN2, `SELECT * FROM public.admin_set_payout_hold('${HELPER}', 'still reviewing')`);
f = await freeze();
check("re-placing a paused hold leaves it paused (no second Stripe call)", reheld.ok && f?.freeze_state === "paused", JSON.stringify(f));
const denied = await as(ADMIN, `SELECT * FROM public.admin_deny_payout_hold('${HELPER}', 'compliance failed')`);
f = await freeze();
check("denying a paused hold leaves it paused", denied.ok && f?.freeze_state === "paused", JSON.stringify(f));

// ── A release asks for a restore ───────────────────────────────────────────
const released = await as(ADMIN2, `SELECT public.admin_release_payout_hold('${HELPER}') AS r`);
f = await freeze();
check("a release asks for the restore", released.ok && f?.freeze_state === "restore_requested", JSON.stringify(f));
check("…keeping the schedule to restore", JSON.stringify(f?.prior_schedule) === JSON.stringify(DAILY), JSON.stringify(f?.prior_schedule));
check("…naming the admin who released", f?.requested_by === ADMIN2);

const reheld2 = await as(ADMIN, `SELECT * FROM public.admin_set_payout_hold('${HELPER}', 'new evidence')`);
f = await freeze();
check("a re-hold before the restore ran asks for a pause again", reheld2.ok && f?.freeze_state === "pause_requested", JSON.stringify(f));
check("…with the ORIGINAL schedule still the one to restore", JSON.stringify(f?.prior_schedule) === JSON.stringify(DAILY));

// A hold released before any pause happened still asks (the sync then finds nothing paused).
await as(ADMIN, `SELECT * FROM public.admin_set_payout_hold('${OTHER}', 'quick check')`);
await as(ADMIN, `SELECT public.admin_release_payout_hold('${OTHER}') AS r`);
const fo = await freeze(OTHER);
check("a release before any pause still asks for a restore (prior unknown)", fo?.freeze_state === "restore_requested" && fo?.prior_schedule === null, JSON.stringify(fo));

// ── The sweep ──────────────────────────────────────────────────────────────
await db.query(`UPDATE public.payout_schedule_freezes SET updated_at = now() - interval '10 minutes', requested_at = now() - interval '45 minutes', attempts = 2, freeze_error = 'Stripe is down'`).catch(() => null);
const sweep = await as("service", "SELECT public.sweep_payout_schedule_freezes() AS r");
const r = sweep.rows?.[0]?.r;
check("the sweep finds both stale requests", sweep.ok && r?.stale === 2, sweep.err ?? JSON.stringify(r));
check("…cannot send without pg_net here, and says so (kicked 0)", r?.kicked === 0, JSON.stringify(r));
check("…and pages both stuck requests", r?.paged === 2, JSON.stringify(r));
const pages = (await db.query(`SELECT severity, message, tags FROM public.error_logs ORDER BY message`)).rows;
check("each page is fatal, tagged payout-freeze-stuck",
  pages.length === 2 && pages.every((p) => p.severity === "fatal" && p.tags?.source === "payout-freeze-stuck"), JSON.stringify(pages));
check("a stuck PAUSE says money can still leave", pages.some((p) => /NOT paused/.test(p.message) && /Stripe is down/.test(p.message)));
check("a stuck RESTORE says the Helpr is still on manual", pages.some((p) => /NOT restored/.test(p.message)));
const sweep2 = await as("service", "SELECT public.sweep_payout_schedule_freezes() AS r");
const pages2 = (await db.query(`SELECT count(*)::int AS n FROM public.error_logs`)).rows[0].n;
check("a second sweep within 6 hours does not page again", sweep2.ok && pages2 === 2, `${pages2} pages`);
await db.query(`UPDATE public.payout_schedule_freezes SET requested_at = now(), updated_at = now() - interval '10 minutes'`).catch(() => null);
const sweep3 = await as("service", "SELECT public.sweep_payout_schedule_freezes() AS r");
check("a fresh request is retried but not paged", sweep3.rows?.[0]?.r?.stale === 2 && sweep3.rows?.[0]?.r?.paged === 0, JSON.stringify(sweep3.rows?.[0]?.r));

// ── Access ─────────────────────────────────────────────────────────────────
const adminRead = await as(ADMIN, "SELECT helper_id FROM public.payout_schedule_freezes");
check("an admin reads the freezes", adminRead.ok && adminRead.rows.length === 2, adminRead.err ?? JSON.stringify(adminRead.rows));
const helperRead = await as(HELPER, "SELECT helper_id FROM public.payout_schedule_freezes");
check("a non-admin reads none (RLS)", helperRead.ok && helperRead.rows.length === 0, helperRead.err ?? JSON.stringify(helperRead.rows));
const anonRead = await as(null, "SELECT helper_id FROM public.payout_schedule_freezes");
check("anon has no grant", !anonRead.ok, anonRead.err ?? "read");
const adminWrite = await as(ADMIN, `UPDATE public.payout_schedule_freezes SET freeze_state = 'paused' RETURNING helper_id`);
check("not even an admin writes it directly", !adminWrite.ok, adminWrite.err ?? JSON.stringify(adminWrite.rows));
for (const sig of ["sweep_payout_schedule_freezes()", "kick_payout_schedule_sync(uuid)", "queue_payout_schedule_freeze()"]) {
  for (const role of ["anon", "authenticated"]) {
    const g = await db.query(`SELECT has_function_privilege('${role}', 'public.${sig}', 'EXECUTE') AS a`).catch((e) => ({ rows: [{ a: e.message }] }));
    check(`${role} has no EXECUTE on ${sig}`, g.rows[0]?.a === false, String(g.rows[0]?.a));
  }
}

// ── The kick is tagged under its cron (lh-money-escrow review, 2026-10-05) ──
// pg_net and vault stand-ins, and cron_http_tag as live (20260924132850):
// one cron_http_requests row per request id, naming the job.
await db.exec(`
CREATE SCHEMA net;
CREATE SEQUENCE net.req_seq;
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
  RETURNS bigint LANGUAGE sql AS $$ SELECT nextval('net.req_seq') $$;
CREATE SCHEMA vault;
CREATE VIEW vault.decrypted_secrets AS
  SELECT * FROM (VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'k')) v(name, decrypted_secret);
CREATE TABLE public.cron_http_requests (request_id bigint PRIMARY KEY, jobname text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.cron_http_tag(p_request_id bigint, p_jobname text) RETURNS bigint LANGUAGE sql
  AS $$ INSERT INTO public.cron_http_requests (request_id, jobname) VALUES (p_request_id, p_jobname) RETURNING p_request_id $$;
`);
await db.query(`UPDATE public.payout_schedule_freezes SET updated_at = now() - interval '10 minutes'`).catch(() => null);
const sweep4 = await as("service", "SELECT public.sweep_payout_schedule_freezes() AS r");
check("with pg_net present the sweep sends both requests", sweep4.rows?.[0]?.r?.kicked === 2, sweep4.err ?? JSON.stringify(sweep4.rows?.[0]?.r));
const tags = (await db.query(`SELECT jobname FROM public.cron_http_requests`)).rows;
check("every kick is tagged under payout-freeze-sync (its HTTP failures get filed)",
  tags.length === 2 && tags.every((t) => t.jobname === "payout-freeze-sync"), JSON.stringify(tags));

// ── A paused row is re-verified at Stripe every 6 hours (re-review) ────────
await db.query(`DELETE FROM public.cron_http_requests`);
await db.query(`UPDATE public.payout_schedule_freezes SET freeze_state = 'paused', stripe_account_id = 'acct_x',
                  updated_at = now() - interval '7 hours', verified_at = NULL WHERE helper_id = $1`, [HELPER]).catch(() => null);
const sweep5 = await as("service", "SELECT public.sweep_payout_schedule_freezes() AS r");
check("a paused row unchecked for 6 hours is sent for a Stripe re-check", sweep5.rows?.[0]?.r?.verify_kicked === 1, sweep5.err ?? JSON.stringify(sweep5.rows?.[0]?.r));
await db.query(`UPDATE public.payout_schedule_freezes SET verified_at = now() WHERE helper_id = $1`, [HELPER]).catch(() => null);
const sweep6 = await as("service", "SELECT public.sweep_payout_schedule_freezes() AS r");
check("…and not again once it was verified", sweep6.rows?.[0]?.r?.verify_kicked === 0, JSON.stringify(sweep6.rows?.[0]?.r));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
