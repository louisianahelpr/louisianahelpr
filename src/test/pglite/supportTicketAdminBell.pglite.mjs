#!/usr/bin/env node
/**
 * PGlite proof for 20261030212558_support_ticket_admin_bell: every new support ticket rings every admin's bell.
 *
 *   node src/test/pglite/supportTicketAdminBell.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/supportTicketAdminBell.pglite.mjs   # RED (prod has no bell)
 *
 * Prod has no trigger for this (the only reports trigger that writes a notification is auto_escalate_reports, for user
 * and application reports). The Profile support tab posts no Slack, so an admin learned of a member's ticket only from
 * the rail badge or the ledger. Applies the migration 3x, then proves:
 *   - a member's ticket from either path, and a guest's (no reporter), ring each admin once, and two tickets ring twice;
 *   - the words are fixed: nothing the sender typed reaches the bell;
 *   - a seed account and an unmarked test account ring nobody, and their ticket is still filed;
 *   - an admin's own ticket does not ring that admin, and rings the others;
 *   - another report type rings nobody;
 *   - a failing bell never loses the ticket, and it is logged;
 *   - anon and authenticated cannot execute the function.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, U, makeCheck } from "./messageAlertsWorld.mjs";

const NEW = "20261030212558_support_ticket_admin_bell.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();
const migration = readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${NEW}`, import.meta.url)), "utf8");

const MEMBER = U(1);
const SEED = U(2);
const TEST = U(3);
const ADMIN1 = U(8);
const ADMIN2 = U(9);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.test_subjects (user_id uuid PRIMARY KEY);
-- Stands in for public.is_test_subject (prod md5 b943403c753adf5a2f9cdd92cdf54d79): the proof needs its answer, not auth.users.
CREATE FUNCTION public.is_test_subject(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_subjects t WHERE t.user_id = p_user_id) $$;
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL, reported_id uuid NOT NULL,
  reason text NOT NULL, description text, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
  message text NOT NULL DEFAULT '', type text NOT NULL, link text, read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text DEFAULT 'error', message text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, context jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
INSERT INTO public.profiles (user_id, is_seed) VALUES ('${MEMBER}', false), ('${SEED}', true), ('${TEST}', false), ('${ADMIN1}', false), ('${ADMIN2}', false);
INSERT INTO public.test_subjects VALUES ('${TEST}');
INSERT INTO public.user_roles VALUES ('${ADMIN1}', 'admin'), ('${ADMIN2}', 'admin'), ('${ADMIN2}', 'admin'), ('${MEMBER}', 'user');
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(migration);

const q = async (sql, p) => (await db.query(sql, p)).rows;
const file = async (reporter, { type = "support", reason = "[Issue Report] SECRET-SUBJECT", description = "SECRET-BODY" } = {}) =>
  (await q(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason, description) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [reporter, type, reporter ?? "00000000-0000-0000-0000-000000000000", reason, description]))[0].id;
const bells = () => q(`SELECT user_id, title, message, type, link FROM public.notifications ORDER BY created_at, id`);
const clear = () => db.exec(`DELETE FROM public.notifications`);

let id = await file(MEMBER);
let b = await bells();
check("a member's ticket rings each admin once", b.length === 2 && new Set(b.map((x) => x.user_id)).size === 2, `${b.length}`);
check("the notice is an admin alert that opens the Support inbox at this ticket",
  b.every((x) => x.type === "admin_alert" && x.link === `/admin?view=support&ticket=${id}`), b[0]?.link);
check("nothing the sender typed reaches the bell", !JSON.stringify(b).includes("SECRET"));
check("it says a member wrote", b.every((x) => x.message.includes("A member")), b[0]?.message);

await file(MEMBER, { reason: "[Issue Report] SECRET-SUBJECT" });
check("a second ticket rings again", (await bells()).length === 4, `${(await bells()).length}`);

await clear();
await file(null, { reason: "[Issue Report] Guest message", description: "Help\n\nGuest: SECRET Name <secret@bayoumail.net>" });
b = await bells();
check("a guest's ticket (no reporter) rings each admin once", b.length === 2, `${b.length}`);
check("it says a guest wrote, and no guest text reaches the bell",
  b.every((x) => x.message.includes("A guest")) && !/secret/i.test(JSON.stringify(b)), b[0]?.message);

await clear();
const seedId = await file(SEED);
const testId = await file(TEST);
check("a seed account's ticket rings nobody", (await bells()).length === 0, `${(await bells()).length}`);
check("their tickets are still filed", (await q(`SELECT 1 FROM public.reports WHERE id IN ($1, $2)`, [seedId, testId])).length === 2);

await clear();
await file(ADMIN1);
b = await bells();
check("an admin's own ticket rings only the other admin", b.length === 1 && b[0].user_id === ADMIN2, `${b.length}`);

await clear();
await file(MEMBER, { type: "job", reason: "Spam" });
check("another report type rings nobody", (await bells()).length === 0);

// A failing bell never loses the ticket.
await clear();
await db.exec(`ALTER TABLE public.notifications ADD CONSTRAINT boom CHECK (title <> 'New support message')`);
let survived = false;
try { await file(MEMBER); survived = true; } catch (e) { console.log(`  threw: ${e.message}`); }
check("a failing bell does not fail the ticket", survived);
check("a failing bell is logged", (await q(`SELECT 1 FROM public.error_logs WHERE tags->>'source' = 'notify_admins_support_ticket'`)).length === 1);
await db.exec(`ALTER TABLE public.notifications DROP CONSTRAINT boom`);

if (!SKIP) {
  const acl = await q(`SELECT has_function_privilege('anon', 'public.notify_admins_support_ticket()', 'EXECUTE') a, has_function_privilege('authenticated', 'public.notify_admins_support_ticket()', 'EXECUTE') b, has_function_privilege('public', 'public.notify_admins_support_ticket()', 'EXECUTE') c`);
  check("anon, authenticated and PUBLIC cannot execute it", !acl[0].a && !acl[0].b && !acl[0].c);
}

console.log(`\n${state.failures === 0 ? "ALL PASS" : `${state.failures} FAILED`}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(state.failures === 0 ? 0 : 1);
