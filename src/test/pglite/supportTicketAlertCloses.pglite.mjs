#!/usr/bin/env node
/**
 * PGlite proof for 20261030221720_support_ticket_alert_closes_itself: the "New support message" ledger item has a close
 * rule that re-asks the pending ticket queue.
 *
 *   node src/test/pglite/supportTicketAlertCloses.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/supportTicketAlertCloses.pglite.mjs   # RED (the title has no rule)
 *
 * Applies the migration 3x, then proves:
 *   - the title maps to the rule, and every older rule still maps as before;
 *   - a pending member or guest ticket keeps the item open, and resolving the last one closes it;
 *   - a pending seed or test ticket, or a pending report of another type, never holds it open;
 *   - grants are unchanged: anon and authenticated cannot execute either function.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, U, makeCheck } from "./messageAlertsWorld.mjs";

const NEW = "20261030221720_support_ticket_alert_closes_itself.sql";
const PREVIOUS = "20261023143240_payout_waits_for_the_posters_approval.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();
const read = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const migration = read(NEW);

const MEMBER = U(1);
const SEED = U(2);
const TEST = U(3);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.test_subjects (user_id uuid PRIMARY KEY);
-- Stands in for public.is_test_subject (a null is not a test subject, as prod's): the proof needs its answer, not auth.users.
CREATE FUNCTION public.is_test_subject(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_subjects t WHERE t.user_id = p_user_id) $$;
CREATE FUNCTION public.ops_alert_normalise(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(p) $$;
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL, status text NOT NULL DEFAULT 'pending');
INSERT INTO public.profiles VALUES ('${MEMBER}', false), ('${SEED}', true), ('${TEST}', false);
INSERT INTO public.test_subjects VALUES ('${TEST}');
`);

const q = async (sql) => (await db.query(sql)).rows;

if (SKIP) {
  // Today's definitions, so the red run differs by this migration alone.
  const old = read(PREVIOUS).split("\n");
  const from = old.findIndex((l) => l.startsWith("CREATE OR REPLACE FUNCTION public.admin_alert_close_rule("));
  const to = old.findIndex((l) => l.startsWith("GRANT EXECUTE ON FUNCTION public.admin_queue_still_pending("));
  await db.exec(old.slice(from, to + 1).join("\n"));
} else {
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(migration); check(`applies, pass ${i}`, true); }
    catch (e) { check(`applies, pass ${i}`, false, e.message); }
  }
}

const rule = async (t) => (await q(`SELECT public.admin_alert_close_rule('${t}') r`))[0].r;
const open = async () => (await q(`SELECT public.admin_queue_still_pending('support-ticket', '{}'::jsonb, now()) o`))[0].o;
const clear = () => db.exec(`DELETE FROM public.reports`);
const file = (who, type = "support", status = "pending") =>
  db.exec(`INSERT INTO public.reports (reporter_id, reported_type, status) VALUES (${who ? `'${who}'` : "NULL"}, '${type}', '${status}')`);

check("the bell's title maps to support-ticket", (await rule("New support message")) === "support-ticket");
check("an older queue rule still maps", (await rule("Job waiting on approval")) === "approval-escalation");
check("a notice still maps", (await rule("New member joined")) === "notice");
check("an unknown title still has no rule", (await rule("Something else")) === null);

await clear();
check("no tickets: closed", (await open()) === false);

await file(MEMBER);
check("a member's pending ticket keeps it open", (await open()) === true);
await db.exec(`UPDATE public.reports SET status = 'resolved'`);
check("resolving the ticket closes it", (await open()) === false);

await clear();
await file(null);
check("a guest's pending ticket keeps it open", (await open()) === true);
await db.exec(`UPDATE public.reports SET status = 'resolved'`);
check("resolving the guest's ticket closes it", (await open()) === false);

await clear();
await file(MEMBER);
await file(null);
await db.exec(`UPDATE public.reports SET status = 'resolved' WHERE reporter_id IS NULL`);
check("one of two resolved: still open", (await open()) === true);

await clear();
await file(SEED);
check("a seed account's ticket never holds it open", (await open()) === false);
await clear();
await file(TEST);
check("a test account's ticket never holds it open", (await open()) === false);
await clear();
await file(MEMBER, "user");
check("another report type never holds it open", (await open()) === false);
await clear();
await file(MEMBER, "support", "dismissed");
check("a ticket no longer pending, whatever its status, does not hold it open", (await open()) === false);

const acl = await q(`SELECT
  has_function_privilege('anon', 'public.admin_alert_close_rule(text)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.admin_alert_close_rule(text)', 'EXECUTE') b,
  has_function_privilege('anon', 'public.admin_queue_still_pending(text,jsonb,timestamptz)', 'EXECUTE') c,
  has_function_privilege('authenticated', 'public.admin_queue_still_pending(text,jsonb,timestamptz)', 'EXECUTE') d,
  has_function_privilege('service_role', 'public.admin_queue_still_pending(text,jsonb,timestamptz)', 'EXECUTE') e`);
check("anon and authenticated cannot execute either; service_role can", !acl[0].a && !acl[0].b && !acl[0].c && !acl[0].d && acl[0].e);

console.log(`\n${state.failures === 0 ? "ALL PASS" : `${state.failures} FAILED`}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(state.failures === 0 ? 0 : 1);
