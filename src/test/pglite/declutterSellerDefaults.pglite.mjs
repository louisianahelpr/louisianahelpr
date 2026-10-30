#!/usr/bin/env node
/**
 * PGlite proof for 20261030144112_declutter_seller_defaults (owner request via the lead, 2026-10-30: remember the
 * seller's listing choices on the account).
 *
 *   node src/test/pglite/declutterSellerDefaults.pglite.mjs                    # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerDefaults.pglite.mjs # RED: the migration absent
 *   MUTANT=<name> node src/test/pglite/declutterSellerDefaults.pglite.mjs      # a planted defect: must FAIL
 *
 * World: auth.users and auth.uid() (from request.jwt.claim.sub), the three API roles. Each check runs AS the
 * authenticated or anon role with row-level security on, as PostgREST does.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = fileURLToPath(new URL("../../../supabase/migrations/20261030144112_declutter_seller_defaults.sql", import.meta.url));
const MUTANT = process.env.MUTANT ?? "";
const skip = process.env.NEW_MIGRATION === "skip";

// No mutant drops the UPDATE policy's WITH CHECK: Postgres also checks the new row against the SELECT policy when
// the UPDATE reads the row (its WHERE), so moving a row onto another member is refused either way (measured:
// with WITH CHECK (true) the move still fails "new row violates row-level security policy"). Kept as defense in depth.
const MUTANTS = {
  // Every member's row readable.
  read: ["FOR SELECT TO authenticated USING (member_id = (SELECT auth.uid()));", "FOR SELECT TO authenticated USING (true);"],
  // A row written for someone else.
  insert: ["FOR INSERT TO authenticated WITH CHECK (member_id = (SELECT auth.uid()));", "FOR INSERT TO authenticated WITH CHECK (true);"],
  // anon keeps a grant.
  anon: ["REVOKE ALL ON public.declutter_seller_defaults FROM PUBLIC, anon;", "REVOKE ALL ON public.declutter_seller_defaults FROM PUBLIC; GRANT SELECT ON public.declutter_seller_defaults TO anon;"],
  // Any drop step.
  pct: ["CHECK (drop_pct IN (5, 10, 15, 20))", "CHECK (drop_pct > 0)"],
  // Any handover word.
  ways: ["AND handovers <@ ARRAY['porch', 'seller_delivery', 'meetup', 'delivery']::text[]", ""],
  // Defaults off.
  defaults: ["keep_up boolean NOT NULL DEFAULT true,\n  drops boolean NOT NULL DEFAULT true,", "keep_up boolean NOT NULL DEFAULT false,\n  drops boolean NOT NULL DEFAULT false,"],
};
let mig = readFileSync(MIG, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m) throw new Error(`unknown MUTANT ${MUTANT}`);
  for (let i = 0; i < m.length; i += 2) {
    if (!mig.includes(m[i])) throw new Error(`mutant ${MUTANT}: anchor not found`);
    mig = mig.replace(m[i], m[i + 1]);
  }
}

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  insert into auth.users values ('00000000-0000-4000-8000-00000000000a'), ('00000000-0000-4000-8000-00000000000b'), ('00000000-0000-4000-8000-00000000000c');
`);
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c"; // has no row: a move onto C is not stopped by the primary key
if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig);

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };

async function as(role, uid, sql) {
  await db.exec(`set request.jwt.claim.sub = '${uid ?? ""}'`);
  await db.exec(`set role ${role}`);
  try {
    const r = await db.query(sql);
    return { ok: true, rows: r.rows, n: r.affectedRows ?? 0 };
  } catch (e) {
    return { ok: false, err: String(e.message ?? e) };
  } finally {
    await db.exec("reset role");
    await db.exec("reset request.jwt.claim.sub");
  }
}

const exists = await db.query("select to_regclass('public.declutter_seller_defaults') as t");
check(exists.rows[0].t !== null, "the table exists");

const insA = await as("authenticated", A, `insert into public.declutter_seller_defaults (member_id) values ('${A}') returning keep_up, drops, drop_pct, floor_pct, free_after_days, handovers`);
check(insA.ok && insA.rows.length === 1, `a member saves their own row (${insA.err ?? "ok"})`);
const d = insA.rows?.[0] ?? {};
check(d.keep_up === true && d.drops === true && d.drop_pct === 5 && d.floor_pct === 50 && d.free_after_days === null && JSON.stringify(d.handovers) === '["porch"]',
  `no choices = keep it up ON, drops ON at 5%, floor 50%, never free, porch (${JSON.stringify(d)})`);

const insForB = await as("authenticated", A, `insert into public.declutter_seller_defaults (member_id) values ('${B}')`);
check(!insForB.ok, `a member cannot write a row for someone else (${insForB.err ?? "allowed"})`);

try { await db.exec(`insert into public.declutter_seller_defaults (member_id, keep_up) values ('${B}', false)`); } catch (e) { check(false, `seed B's row (${e.message})`); }
const readB = await as("authenticated", A, `select member_id from public.declutter_seller_defaults where member_id = '${B}'`);
check(readB.ok && readB.rows.length === 0, `a member cannot read another member's row (${readB.rows?.length})`);
const own = await as("authenticated", A, "select member_id from public.declutter_seller_defaults");
check(own.ok && own.rows.length === 1 && own.rows[0].member_id === A, "a member reads only their own row");

const upd = await as("authenticated", A, `update public.declutter_seller_defaults set drops = false, drop_pct = 10, floor_pct = 60, free_after_days = 14, handovers = array['porch','meetup'] where member_id = '${A}' returning drops`);
check(upd.ok && upd.rows.length === 1, `a member updates their own row (${upd.err ?? "ok"})`);
const updB = await as("authenticated", A, `update public.declutter_seller_defaults set keep_up = true where member_id = '${B}' returning member_id`);
check(updB.ok && updB.rows.length === 0, "a member cannot update another member's row");
const move = await as("authenticated", A, `update public.declutter_seller_defaults set member_id = '${C}' where member_id = '${A}'`);
check(!move.ok, `a member cannot move their row onto someone else (${move.err ?? "allowed"})`);

const badPct = await as("authenticated", A, `update public.declutter_seller_defaults set drop_pct = 7 where member_id = '${A}'`);
check(!badPct.ok, "a drop step the form does not offer is refused");
const badFloor = await as("authenticated", A, `update public.declutter_seller_defaults set floor_pct = 100 where member_id = '${A}'`);
check(!badFloor.ok, "a lowest price at or above the asking price is refused");
const badFree = await as("authenticated", A, `update public.declutter_seller_defaults set free_after_days = 3 where member_id = '${A}'`);
check(!badFree.ok, "a free-after day count the form does not offer is refused");
const badWays = await as("authenticated", A, `update public.declutter_seller_defaults set handovers = array['shipping'] where member_id = '${A}'`);
check(!badWays.ok, "a handover word that is not one of the four is refused");
const noWays = await as("authenticated", A, `update public.declutter_seller_defaults set handovers = array[]::text[] where member_id = '${A}'`);
check(!noWays.ok, "an empty handover list is refused");

const anonRead = await as("anon", null, "select 1 from public.declutter_seller_defaults");
check(!anonRead.ok, `signed out reads nothing (${anonRead.err ?? "allowed"})`);

try {
const acl = await db.query("select relacl::text as acl from pg_class where oid = 'public.declutter_seller_defaults'::regclass");
const aclText = acl.rows[0]?.acl ?? "";
check(!/(^|[{,])anon=/.test(aclText) && !/(^|[{,])=[a-zA-Z]/.test(aclText) && /authenticated=arwd/.test(aclText), `grants: authenticated only, never anon or PUBLIC (${aclText})`);

await db.exec(`delete from auth.users where id = '${A}'`);
const gone = await db.query(`select 1 from public.declutter_seller_defaults where member_id = '${A}'`);
check(gone.rows.length === 0, "account deletion removes the row");
} catch (e) { check(false, `grants and deletion (${e.message})`); }

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
