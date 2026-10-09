#!/usr/bin/env node
/**
 * Phone added after sign-up keeps the duplicate refusal (2026-10-09): a number
 * another real account has is refused on every write path, '' is stored as
 * NULL, a reformatted re-save is not a change, test accounts are exempt. The
 * retained-ban side stays the existing flag trigger (no auto-ban trigger: it
 * could not apply from a member's own write). Runs
 * 20261009175007_phone_added_later_keeps_ban_and_duplicate_checks.sql VERBATIM
 * (3x) over a profiles table.
 *
 *   node src/test/pglite/phoneAddedLater.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/phoneAddedLater.pglite.mjs   # RED: no triggers
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const FILE = new URL("../../../supabase/migrations/20261009175007_phone_added_later_keeps_ban_and_duplicate_checks.sql", import.meta.url).pathname;
const RED = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, phone text, is_seed boolean DEFAULT false, ban_status text DEFAULT 'active', email text);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
CREATE TABLE public.ban_calls (user_id uuid, phone text);
CREATE FUNCTION public.enforce_retained_ban(p_user_id uuid, p_email text, p_phone text, p_identity_sha256 text) RETURNS jsonb
  LANGUAGE plpgsql AS $$ BEGIN
    IF p_phone = '(337) 000-0000' THEN RAISE EXCEPTION 'lookup down'; END IF;
    INSERT INTO public.ban_calls VALUES (p_user_id, p_phone);
    RETURN jsonb_build_object('banned', false);
  END $$;
`);
if (!RED) {
  const sql = readFileSync(FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const A = "55555555-0000-0000-0000-000000000001";
const B = "55555555-0000-0000-0000-000000000002";
const T1 = "55555555-0000-0000-0000-0000000000a1";
const T2 = "55555555-0000-0000-0000-0000000000a2";
const C = "55555555-0000-0000-0000-000000000003";
await q(`INSERT INTO public.profiles (user_id, phone) VALUES ($1, '(504) 555-1234'), ($2, NULL), ($3, NULL)`, [A, B, C]);
await q(`INSERT INTO public.profiles (user_id, phone, is_seed) VALUES ($1, '(504) 555-0199', true), ($2, NULL, true)`, [T1, T2]);

// 1. Duplicate refused, whatever the formatting.
let err = null;
try { await q(`UPDATE public.profiles SET phone = '5045551234' WHERE user_id = $1`, [B]); } catch (e) { err = e; }
check("a number another real account has is refused", err?.code === "23505" && /already on another account/.test(err?.message ?? ""), String(err?.message));
check("…and the row keeps no phone", (await q(`SELECT phone FROM public.profiles WHERE user_id = $1`, [B]))[0].phone === null);

// 2. A fresh number is saved; no auto-ban trigger is installed.
await q(`UPDATE public.profiles SET phone = '(337) 555-9999' WHERE user_id = $1`, [B]);
check("a fresh number is saved", (await q(`SELECT phone FROM public.profiles WHERE user_id = $1`, [B]))[0].phone === "(337) 555-9999");
if (!RED) check("no auto-ban trigger (it could not apply from a member's own write)",
  (await q(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'trg_enforce_retained_ban_on_first_phone'`))[0].n === 0);

// 3. The same number in another format is not a change, even when shared.
// A pair that already shares a number (prod has one) predates the guard.
await db.exec(`SET session_replication_role = replica;
  INSERT INTO public.profiles (user_id, phone) VALUES ('55555555-0000-0000-0000-0000000000e1', '3375198454'), ('55555555-0000-0000-0000-0000000000e2', '3375198454');
  SET session_replication_role = origin;`);
let fmtErr = null;
try { await q(`UPDATE public.profiles SET phone = '(337) 519-8454' WHERE user_id = '55555555-0000-0000-0000-0000000000e1'`); } catch (e) { fmtErr = e; }
check("an already-shared number can be re-saved in another format", fmtErr === null, String(fmtErr?.message));

// 3b. A banned account's number is not refused: the flag trigger must see it.
await db.exec(`SET session_replication_role = replica;
  INSERT INTO public.profiles (user_id, phone, ban_status) VALUES ('55555555-0000-0000-0000-0000000000b1', '(225) 555-0101', 'permanently_banned');
  SET session_replication_role = origin;`);
await q(`INSERT INTO public.profiles (user_id) VALUES ('55555555-0000-0000-0000-0000000000b2')`);
let banErr = null;
try { await q(`UPDATE public.profiles SET phone = '2255550101' WHERE user_id = '55555555-0000-0000-0000-0000000000b2'`); } catch (e) { banErr = e; }
check("a banned account's number is saved (so the ban-evasion flag records it)", banErr === null, String(banErr?.message));

// 3c. Extensions and stray digits cannot slip past the duplicate key.
let extErr = null;
try { await q(`UPDATE public.profiles SET phone = '(504) 555-1234 x9' WHERE user_id = '55555555-0000-0000-0000-0000000000b2'`); } catch (e) { extErr = e; }
check("a number that is not 10 US digits is refused", !RED ? extErr?.code === "23514" : true, String(extErr?.message));
let oneErr = null;
try { await q(`UPDATE public.profiles SET phone = '1 504 555 1234' WHERE user_id = '55555555-0000-0000-0000-0000000000b2'`); } catch (e) { oneErr = e; }
check("a leading 1 is the country code: still the same (taken) number", oneErr?.code === "23505", String(oneErr?.message));

// 4. '' is stored as NULL.
await q(`UPDATE public.profiles SET phone = '' WHERE user_id = $1`, [C]);
check("a blank phone is stored as NULL", (await q(`SELECT phone FROM public.profiles WHERE user_id = $1`, [C]))[0].phone === null);

// 5. Test accounts are exempt both ways.
await q(`UPDATE public.profiles SET phone = '(504) 555-0199' WHERE user_id = $1`, [T2]);
check("test accounts may share a fixture number", (await q(`SELECT phone FROM public.profiles WHERE user_id = $1`, [T2]))[0].phone === "(504) 555-0199");
await q(`UPDATE public.profiles SET phone = '(504) 555-0199' WHERE user_id = $1`, [C]);
check("a real account may take a number only a test account has", (await q(`SELECT phone FROM public.profiles WHERE user_id = $1`, [C]))[0].phone === "(504) 555-0199");

// 7. Nobody can call the trigger functions.
if (!RED) {
  const g = (await q(`SELECT has_function_privilege('anon','public.guard_profile_phone()','EXECUTE') a,
                              has_function_privilege('authenticated','public.guard_profile_phone()','EXECUTE') u`))[0];
  check("the trigger function is nobody's to call", !g.a && !g.u, JSON.stringify(g));
  check("the duplicate lookup has its index", (await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname = 'profiles_phone_last10_idx'`))[0].n === 1);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
