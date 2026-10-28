#!/usr/bin/env node
/**
 * PGlite proof for 20261028180400_declutter_reopen_taken_down (owner 2026-10-28: a taken-down listing comes back).
 *
 *   node src/test/pglite/declutterReopenListing.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterReopenListing.pglite.mjs # RED: before it, nothing reopens one
 *
 * The migration runs verbatim on prod-shaped stubs (require_feature, is_caller_banned and declutter_assert_member
 * keep their live contracts: feature_disabled 42501; not_authenticated / strikes / under-18 refusals).
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(MIG + "20261028180400_declutter_reopen_taken_down.sql", "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: before the migration (expect FAILs)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const STRUCK = "00000000-0000-4000-8000-0000000000c3";
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.caller (uid uuid);
  INSERT INTO auth.caller VALUES (NULL);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.caller $$;
  CREATE TABLE public.switch_off (key text);
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.switch_off s WHERE s.key = k) THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
    END IF;
  END $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE public.strikes (uid uuid);
  CREATE FUNCTION public.declutter_assert_member(p_selling boolean) RETURNS uuid LANGUAGE plpgsql AS $$
  DECLARE v uuid := auth.uid();
  BEGIN
    IF v IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
    IF (SELECT count(*) FROM public.strikes s WHERE s.uid = v) >= 3 THEN
      RAISE EXCEPTION 'declutter_strikes_blocked' USING ERRCODE = '42501';
    END IF;
    RETURN v;
  END $$;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text NOT NULL, title text,
    price_cents int, updated_at timestamptz DEFAULT now());
  INSERT INTO public.declutter_items (id, seller_id, status, title, price_cents) VALUES
    ('00000000-0000-4000-8000-000000000001', '${SELLER}', 'withdrawn', 'Old radio', 3500),
    ('00000000-0000-4000-8000-000000000002', '${SELLER}', 'live', 'Lamp', 2500),
    ('00000000-0000-4000-8000-000000000003', '${SELLER}', 'removed', 'Removed one', 100),
    ('00000000-0000-4000-8000-000000000004', '${SELLER}', 'rejected', 'Rejected one', 100),
    ('00000000-0000-4000-8000-000000000005', '${STRUCK}', 'withdrawn', 'Struck seller''s', 100);
  INSERT INTO public.strikes VALUES ('${STRUCK}'), ('${STRUCK}'), ('${STRUCK}');
`);

if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(NEW);

const as = (uid) => db.query("UPDATE auth.caller SET uid = $1", [uid]);
async function reopen(uid, id) {
  await as(uid);
  try {
    const r = await db.query("SELECT public.declutter_reopen_listing($1) AS s", [id]);
    return { ok: r.rows[0].s };
  } catch (e) {
    return { err: e.message };
  }
}
const statusOf = async (id) => (await db.query("SELECT status FROM public.declutter_items WHERE id = $1", [id])).rows[0].status;

let r = await reopen(OTHER, "00000000-0000-4000-8000-000000000001");
check("someone else can't reopen a seller's taken-down listing", r.err === "item_not_found", JSON.stringify(r));
check("  and it stays taken down", (await statusOf("00000000-0000-4000-8000-000000000001")) === "withdrawn");

r = await reopen(null, "00000000-0000-4000-8000-000000000001");
check("signed out: refused", r.err === "not_authenticated", JSON.stringify(r));

await db.exec("INSERT INTO public.switch_off VALUES ('declutter')");
r = await reopen(SELLER, "00000000-0000-4000-8000-000000000001");
check("switch off: refused with feature_disabled", r.err === "feature_disabled", JSON.stringify(r));
await db.exec("DELETE FROM public.switch_off");

r = await reopen(STRUCK, "00000000-0000-4000-8000-000000000005");
check("3 strikes: refused (the selling gate)", r.err === "declutter_strikes_blocked", JSON.stringify(r));

for (const [id, st] of [["00000000-0000-4000-8000-000000000002", "live"], ["00000000-0000-4000-8000-000000000003", "removed"], ["00000000-0000-4000-8000-000000000004", "rejected"]]) {
  r = await reopen(SELLER, id);
  check(`a ${st} listing is not reopened`, r.err === "item_not_editable" && (await statusOf(id)) === st, JSON.stringify(r));
}

r = await reopen(SELLER, "00000000-0000-4000-8000-000000000001");
check("the seller reopens their own taken-down listing as a draft", r.ok === "draft", JSON.stringify(r));
check("  its status is draft (publish runs every listing rule again)", (await statusOf("00000000-0000-4000-8000-000000000001")) === "draft");
const kept = (await db.query("SELECT title, price_cents FROM public.declutter_items WHERE id = '00000000-0000-4000-8000-000000000001'")).rows[0];
check("  its words and price are kept", kept.title === "Old radio" && kept.price_cents === 3500, JSON.stringify(kept));
r = await reopen(SELLER, "00000000-0000-4000-8000-000000000001");
check("  a second reopen is refused (it is a draft now)", r.err === "item_not_editable", JSON.stringify(r));

if (!SKIP) {
  const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_reopen_listing(uuid)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.declutter_reopen_listing(uuid)', 'EXECUTE') AS authd,
    EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname = 'declutter_reopen_listing' AND a.grantee = 0) AS public_grant`)).rows[0];
  check("anon and PUBLIC can't execute it; authenticated can", acl.anon === false && acl.public_grant === false && acl.authd === true, JSON.stringify(acl));
}

console.log(failures ? `\n${failures} FAIL(s)` : "\nall PASS");
process.exit(failures ? 1 : 0);
