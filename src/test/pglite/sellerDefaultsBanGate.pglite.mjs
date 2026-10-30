#!/usr/bin/env node
/**
 * PGlite proof for 20261030224733_declutter_seller_defaults_ban_gate.
 *
 *   node src/test/pglite/sellerDefaultsBanGate.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/sellerDefaultsBanGate.pglite.mjs   # RED (a banned account can write)
 *
 * Uses prod's enforce_ban_gate body, read from its newest migration. Applies the migration 3x, then proves:
 *   - a banned caller's INSERT, UPDATE and DELETE are refused with account_restricted, and the row is unchanged;
 *   - a member in good standing writes as before;
 *   - with no caller, a banned member's row still goes: a service-role delete, and the auth.users cascade that
 *     account deletion (auth admin API) causes;
 *   - a DELETE that passes really removes the row (the gate returns OLD).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, U, makeCheck } from "./messageAlertsWorld.mjs";

const NEW = "20261030224733_declutter_seller_defaults_ban_gate.sql";
const GATE_FILE = "20260927012804_recurring_series_end.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();
const read = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");

const GOOD = U(1);
const BANNED = U(2);

const gateSql = read(GATE_FILE);
const at = gateSql.indexOf("CREATE OR REPLACE FUNCTION public.enforce_ban_gate()");
const end = gateSql.indexOf("$function$", gateSql.indexOf("$function$", at) + 10) + 10;
if (at < 0) throw new Error(`enforce_ban_gate not found in ${GATE_FILE}`);

const db = new PGlite();
await db.exec(`
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.banned (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.banned b WHERE b.user_id = auth.uid()) $$;
CREATE TABLE public.declutter_seller_defaults (
  member_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  drop_pct smallint NOT NULL DEFAULT 5);
INSERT INTO auth.users VALUES ('${GOOD}'), ('${BANNED}');
INSERT INTO public.banned VALUES ('${BANNED}');
${gateSql.slice(at, end)};
`);

if (!SKIP) {
  const migration = read(NEW);
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(migration); check(`applies, pass ${i}`, true); }
    catch (e) { check(`applies, pass ${i}`, false, e.message); }
  }
}

const as = (uid) => db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
const refused = async (sql) => {
  try { await db.exec(sql); return "allowed"; } catch (e) { return e.message; }
};
const row = async (id) => (await db.query(`SELECT drop_pct FROM public.declutter_seller_defaults WHERE member_id = '${id}'`)).rows[0];
const seed = async (id) => {
  await as(null);
  await db.exec(`INSERT INTO public.declutter_seller_defaults (member_id) VALUES ('${id}') ON CONFLICT DO NOTHING`);
};

// A banned caller.
await as(BANNED);
check("a banned INSERT is refused", (await refused(`INSERT INTO public.declutter_seller_defaults (member_id) VALUES ('${BANNED}')`)) === "account_restricted");
await seed(BANNED);
await as(BANNED);
check("a banned UPDATE is refused", (await refused(`UPDATE public.declutter_seller_defaults SET drop_pct = 20 WHERE member_id = '${BANNED}'`)) === "account_restricted");
check("the refused UPDATE changed nothing", (await row(BANNED))?.drop_pct === 5);
check("a banned DELETE is refused", (await refused(`DELETE FROM public.declutter_seller_defaults WHERE member_id = '${BANNED}'`)) === "account_restricted");
check("the refused DELETE left the row", (await row(BANNED)) !== undefined);

// A member in good standing.
await as(GOOD);
check("a member's INSERT works", (await refused(`INSERT INTO public.declutter_seller_defaults (member_id) VALUES ('${GOOD}')`)) === "allowed");
check("a member's UPDATE works", (await refused(`UPDATE public.declutter_seller_defaults SET drop_pct = 20 WHERE member_id = '${GOOD}'`)) === "allowed" && (await row(GOOD))?.drop_pct === 20);
check("a member's DELETE removes the row", (await refused(`DELETE FROM public.declutter_seller_defaults WHERE member_id = '${GOOD}'`)) === "allowed" && (await row(GOOD)) === undefined);

// No caller: server cleanup and account deletion are never blocked, banned or not.
await as(null);
check("service-role cleanup deletes a banned member's row", (await refused(`DELETE FROM public.declutter_seller_defaults WHERE member_id = '${BANNED}'`)) === "allowed" && (await row(BANNED)) === undefined);
await seed(BANNED);
await as(null);
check("deleting a banned account cascades through the gate", (await refused(`DELETE FROM auth.users WHERE id = '${BANNED}'`)) === "allowed" && (await row(BANNED)) === undefined);

console.log(`\n${state.failures === 0 ? "ALL PASS" : `${state.failures} FAILED`}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(state.failures === 0 ? 0 : 1);
