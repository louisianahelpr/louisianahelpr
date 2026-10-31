#!/usr/bin/env node
/**
 * PGlite proof for 20261031183631_declutter_my_question_ids (AUD31-15): the asker can tell their own waiting question
 * ("Your question") and nobody else learns who asked anything.
 *
 *   node src/test/pglite/declutterMyQuestionIds.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMyQuestionIds.pglite.mjs  # RED: no read says which are mine
 *
 * World (minimal, prod-shaped where it matters): roles, auth.uid(), a require_feature stub that refuses a switch not
 * on (feature_disabled, 42501), declutter_items, declutter_questions exactly as 20261014193955 creates it, the member
 * column grant without asker_id (20261021124810), the item page's read (20261021122157, verbatim), then the new
 * migration 3x.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261031183631_declutter_my_question_ids.sql";
const READ_FILE = "20261021122157_declutter_item_questions.sql";
const FOUNDATION = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

const ASKER = "00000000-0000-4000-8000-00000000a001";
const OTHER = "00000000-0000-4000-8000-00000000a002";
const SELLER = "00000000-0000-4000-8000-00000000a003";
const ITEM = "00000000-0000-4000-8000-00000000b001";
const ITEM2 = "00000000-0000-4000-8000-00000000b002";

/** The questions table as the foundation creates it (sliced from the file, so a later edit there is read here). */
const start = FOUNDATION.indexOf("CREATE TABLE IF NOT EXISTS public.declutter_questions");
const end = FOUNDATION.indexOf("-- 7. Tax confirmations", start);
if (start < 0 || end < 0) throw new Error("declutter_questions DDL not found in the foundation migration");
const QUESTIONS_DDL = FOUNDATION.slice(start, end).replace(/\n-- -+\s*$/, "");

const db = new PGlite();
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  INSERT INTO auth.users VALUES ('${ASKER}'), ('${OTHER}'), ('${SELLER}');
  CREATE TABLE public.switch_on (key text PRIMARY KEY);
  INSERT INTO public.switch_on VALUES ('declutter');
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.switch_on WHERE key = p_key) THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
    END IF;
  END $$;
  GRANT EXECUTE ON FUNCTION public.require_feature(text) TO authenticated, service_role;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid NOT NULL);
  ALTER TABLE public.declutter_items ENABLE ROW LEVEL SECURITY;
  GRANT SELECT ON public.declutter_items TO authenticated;
  CREATE POLICY "items: readable" ON public.declutter_items FOR SELECT TO authenticated USING (true);
  INSERT INTO public.declutter_items VALUES ('${ITEM}', '${SELLER}'), ('${ITEM2}', '${SELLER}');
`);
await db.exec(QUESTIONS_DDL);
await db.exec(`REVOKE SELECT ON public.declutter_questions FROM anon, authenticated;
  GRANT SELECT (id, item_id, question, answer, answered_at, removed_at, created_at) ON public.declutter_questions TO authenticated;`);
await db.exec(readFileSync(`${MIG_DIR}${READ_FILE}`, "utf8"));
if (!skip) for (let i = 0; i < 3; i++) await db.exec(readFileSync(`${MIG_DIR}${NEW_FILE}`, "utf8"));

const Q = { mine1: "00000000-0000-4000-8000-0000000c0001", other: "00000000-0000-4000-8000-0000000c0002",
  mine2: "00000000-0000-4000-8000-0000000c0003", removed: "00000000-0000-4000-8000-0000000c0004", elsewhere: "00000000-0000-4000-8000-0000000c0005" };
await db.exec(`INSERT INTO public.declutter_questions (id, item_id, asker_id, question, created_at, removed_at, answer, answered_at) VALUES
  ('${Q.mine1}', '${ITEM}', '${ASKER}', 'Is it solid oak?', now() - interval '3 hours', NULL, NULL, NULL),
  ('${Q.other}', '${ITEM}', '${OTHER}', 'Does it rock evenly?', now() - interval '2 hours', NULL, 'Yes', now()),
  ('${Q.mine2}', '${ITEM}', '${ASKER}', 'Can you hold it until Sunday?', now() - interval '1 hour', NULL, NULL, NULL),
  ('${Q.removed}', '${ITEM}', '${ASKER}', 'Removed one', now() - interval '30 minutes', now(), NULL, NULL),
  ('${Q.elsewhere}', '${ITEM2}', '${ASKER}', 'On another item', now(), NULL, NULL, NULL)`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
async function as(uid, sql) {
  try {
    await db.exec(uid ? `SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;` : `SET ROLE anon;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const ids = (r) => (Array.isArray(r) ? r.map((x) => Object.values(x)[0]) : r);
const mine = (uid, item = ITEM) => as(uid, `SELECT * FROM public.declutter_my_question_ids('${item}')`);

const a = await mine(ASKER);
ok(Array.isArray(a) && JSON.stringify(ids(a)) === JSON.stringify([Q.mine1, Q.mine2]), `the asker reads their two live questions on the item, oldest first: ${JSON.stringify(ids(a))}`);
ok(Array.isArray(a) && !ids(a).includes(Q.other), "a neighbour's question is never in the asker's answer");
ok(Array.isArray(a) && !ids(a).includes(Q.removed), "a removed question is not in it");
ok(Array.isArray(a) && !ids(a).includes(Q.elsewhere), "a question on another item is not in it");
const o = await mine(OTHER);
ok(Array.isArray(o) && JSON.stringify(ids(o)) === JSON.stringify([Q.other]), `the other asker reads only their own: ${JSON.stringify(ids(o))}`);
const s = await mine(SELLER);
ok(Array.isArray(s) && s.length === 0, `the seller reads none (who asked stays hidden from the seller): ${JSON.stringify(s)}`);
const anon = await mine(null);
ok(!Array.isArray(anon) && /permission denied/.test(anon.error ?? ""), `anon cannot call it: ${JSON.stringify(anon).slice(0, 120)}`);
await db.exec(`DELETE FROM public.switch_on WHERE key = 'declutter'`);
const off = await mine(ASKER);
ok(!Array.isArray(off) && off.code === "42501" && /feature_disabled/.test(off.error ?? ""), `the 'declutter' switch off refuses it: ${JSON.stringify(off).slice(0, 120)}`);
await db.exec(`INSERT INTO public.switch_on VALUES ('declutter')`);
const asker = await as(SELLER, `SELECT asker_id FROM public.declutter_questions`);
ok(!Array.isArray(asker) && /permission denied/.test(asker.error ?? ""), "members still cannot read asker_id from the table");
const page = await as(OTHER, `SELECT * FROM public.declutter_item_questions('${ITEM}')`);
ok(Array.isArray(page) && page.length === 3 && page.every((r) => !("asker_id" in r) && !("mine" in r)), "the item page's read is unchanged: 3 live questions, no asker, no mine");
const acl = await db.query(`SELECT p.prosecdef, p.proconfig, array_to_string(p.proacl, ',') AS acl FROM pg_proc p WHERE p.proname = 'declutter_my_question_ids'`);
const r0 = acl.rows[0];
ok(!!r0 && r0.prosecdef === true && /search_path=public, pg_temp/.test(String(r0.proconfig)), "SECURITY DEFINER with a pinned search_path");
ok(!!r0 && /authenticated=X/.test(r0.acl) && !/(^|,)=X/.test(r0.acl) && !/anon=X/.test(r0.acl), `EXECUTE for authenticated, not PUBLIC or anon: ${r0?.acl}`);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
