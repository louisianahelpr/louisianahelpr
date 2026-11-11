#!/usr/bin/env node
/**
 * PGlite proof for 20261111011855_shops_my_strikes.sql (Q2110): a member reads their OWN active Shops strikes and when
 * each ends, never another member's, never a removed or ended one, never removed_by.
 *
 *   node src/test/pglite/shopsMyStrikes.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsMyStrikes.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                            # red on a planted defect
 *
 * World: the shop_strikes table from 20261018164444 (cut to its columns; FKs to auth.users kept, the shop_orders FK
 * dropped). Supabase's DEFAULT PRIVILEGES (EXECUTE on new functions to anon, authenticated, service_role) are
 * emulated, so the REVOKE is proved. Stub: require_feature (no-op).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261111011855_shops_my_strikes.sql`, "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ANA = U(1), BOB = U(2), ADMIN = U(3), CLEAN = U(4);
const S_SOON = U(10), S_LATE = U(11), S_REMOVED = U(12), S_ENDED = U(13), S_BOB = U(14);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE TABLE public.shop_strikes (
    id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), offender_side text NOT NULL,
    reason text NOT NULL, order_id uuid, given_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
    removed_at timestamptz, removed_by uuid REFERENCES auth.users(id), is_seed boolean NOT NULL DEFAULT false);
  REVOKE ALL ON TABLE public.shop_strikes FROM PUBLIC, anon, authenticated;
  INSERT INTO auth.users VALUES ('${ANA}'), ('${BOB}'), ('${ADMIN}'), ('${CLEAN}');
  INSERT INTO public.shop_strikes (id, user_id, offender_side, reason, expires_at, removed_at, removed_by) VALUES
    ('${S_LATE}', '${ANA}', 'shop', 'shop_cancelled', now() + interval '80 days', NULL, NULL),
    ('${S_SOON}', '${ANA}', 'buyer', 'buyer_no_show', now() + interval '5 days', NULL, NULL),
    ('${S_REMOVED}', '${ANA}', 'shop', 'admin_strike', now() + interval '60 days', now(), '${ADMIN}'),
    ('${S_ENDED}', '${ANA}', 'shop', 'no_ready_photo', now() - interval '1 day', NULL, NULL),
    ('${S_BOB}', '${BOB}', 'buyer', 'buyer_cancelled_late', now() + interval '30 days', NULL, NULL);
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(SQL);

let failed = 0, total = 0;
const ok = (name, cond, detail = "") => { total++; if (cond) console.log(`OK   ${name}`); else { failed++; console.log(`FAIL ${name} ${detail}`); } };
const mine = async (uid) => {
  await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
  try {
    const r = await db.query(`SELECT * FROM public.shops_my_strikes()`);
    return { rows: r.rows, cols: r.fields.map((f) => f.name), err: null };
  } catch (e) { return { rows: [], cols: [], err: e.message }; }
  finally { await db.exec(`SELECT set_config('test.uid', '', false)`); }
};

const ana = await mine(ANA);
ok("a member sees their own two active strikes", ana.rows.length === 2 && !ana.err, JSON.stringify(ana));
ok("soonest to end first (the one that reopens Shops)", ana.rows[0]?.id === S_SOON && ana.rows[1]?.id === S_LATE, JSON.stringify(ana.rows));
ok("each row says when it ends", ana.rows.length > 0 && ana.rows.every((r) => r.expires_at instanceof Date && r.expires_at > new Date()), JSON.stringify(ana.rows));
ok("never a removed strike", ana.rows.length > 0 && !ana.rows.some((r) => r.id === S_REMOVED), JSON.stringify(ana.rows));
ok("never an ended strike", ana.rows.length > 0 && !ana.rows.some((r) => r.id === S_ENDED), JSON.stringify(ana.rows));
ok("never removed_by, removed_at or user_id in the answer",
  ana.cols.length > 0 && !ana.cols.some((c) => ["removed_by", "removed_at", "user_id", "is_seed"].includes(c)), JSON.stringify(ana.cols));
ok("never another member's strike", ana.rows.length > 0 && !ana.rows.some((r) => r.id === S_BOB), JSON.stringify(ana.rows));
const bob = await mine(BOB);
ok("the other member sees only their own", bob.rows.length === 1 && bob.rows[0].id === S_BOB, JSON.stringify(bob));
const clean = await mine(CLEAN);
ok("a member with no strikes gets an empty list", clean.rows.length === 0 && !clean.err, JSON.stringify(clean));
const admin = await mine(ADMIN);
ok("the admin who removed a strike does not see it as theirs", admin.rows.length === 0 && !admin.err, JSON.stringify(admin));
const anon = await mine(null);
ok("signed out is refused", /not_authenticated/.test(anon.err ?? ""), JSON.stringify(anon));

const g = (await db.query(`SELECT has_function_privilege('anon', 'public.shops_my_strikes()', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.shops_my_strikes()', 'EXECUTE') AS m`).catch(() => ({ rows: [{}] }))).rows[0];
ok("anon cannot run it; members can", g.a === false && g.m === true, JSON.stringify(g));
const t = (await db.query(`SELECT has_table_privilege('authenticated', 'public.shop_strikes', 'SELECT') AS s`)).rows[0];
ok("the table itself stays closed to members", t.s === false, JSON.stringify(t));

console.log(`\n${total - failed} PASS, ${failed} FAIL${process.env.NEW_MIGRATION === "skip" ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(failed ? 1 : 0);
