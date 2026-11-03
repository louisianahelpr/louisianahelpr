#!/usr/bin/env node
/**
 * PGlite proof for 20261103235037 (Builder 81): `authenticated` can select
 * declutter_problems.decide_by (handover.ts withDecideBy), and still cannot
 * select decided_by (members never learn which admin decided).
 *
 *   node src/test/pglite/declutterProblemsDecideByGrant.pglite.mjs                 # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterProblemsDecideByGrant.pglite.mjs  # the before: must FAIL
 *   MUTANT=allColumns node ...                                                    # a table-wide grant: must FAIL
 *
 * World: prod's declutter_problems columns and its authenticated column grants
 * exactly as read from information_schema on 2026-11-03 (15 columns, no
 * decide_by / decided_by / other_side_* / withdrawn_at), RLS on, the read
 * policy with has_role stubbed to an admin list.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_problems_grant_decide_by.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANTS = {
  allColumns: [
    "GRANT SELECT (decide_by) ON TABLE public.declutter_problems TO authenticated;",
    "GRANT SELECT ON TABLE public.declutter_problems TO authenticated;",
  ],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const ADMIN = "11111111-0000-0000-0000-000000000001";
const BUYER = "11111111-0000-0000-0000-000000000002";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
  CREATE TABLE public.admins (id uuid PRIMARY KEY);
  INSERT INTO public.admins VALUES ('${ADMIN}');
  CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
    $f$ SELECT r = 'admin' AND EXISTS (SELECT 1 FROM public.admins WHERE id = u) $f$;
  GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated;
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid);
  GRANT SELECT ON public.declutter_orders TO authenticated;
  CREATE TABLE public.declutter_problems (
    id uuid PRIMARY KEY, order_id uuid NOT NULL, reporter_id uuid, reporter_side text NOT NULL,
    reason text NOT NULL, note text NOT NULL, photo_paths text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'open', decision text, fault text, strike_given boolean NOT NULL DEFAULT false,
    admin_note text, decided_by uuid, decided_at timestamptz, is_seed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(), decide_by timestamptz, other_side_at timestamptz,
    other_side_note text, other_side_photo_paths text[], withdrawn_at timestamptz);
  ALTER TABLE public.declutter_problems ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.declutter_problems FROM PUBLIC, anon, authenticated;
  GRANT SELECT (admin_note, created_at, decided_at, decision, fault, id, is_seed, note, order_id, photo_paths,
                reason, reporter_id, reporter_side, status, strike_given) ON TABLE public.declutter_problems TO authenticated;
  CREATE POLICY "declutter problems: the two sides and admins read" ON public.declutter_problems
    FOR SELECT TO authenticated
    USING (public.has_role((SELECT auth.uid()), 'admin')
           OR EXISTS (SELECT 1 FROM public.declutter_orders o
                       WHERE o.id = declutter_problems.order_id
                         AND (o.buyer_id = (SELECT auth.uid()) OR o.seller_id = (SELECT auth.uid()))));
  INSERT INTO public.declutter_orders VALUES ('33333333-0000-0000-0000-000000000001', '${BUYER}', '11111111-0000-0000-0000-000000000003');
  INSERT INTO public.declutter_problems (id, order_id, reporter_side, reason, note, decided_by, decide_by)
    VALUES ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'buyer', 'damaged', 'cracked',
            '${ADMIN}', '2026-11-05T12:00:00Z');
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
for (let i = 0; i < runs; i++) await db.exec(mig);
console.log(`applied ${THIS} x${runs}`);

async function as(uid, sql) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', true);`);
    const r = await db.query(sql);
    await db.exec("COMMIT");
    return { rows: r.rows };
  } catch (e) {
    await db.exec("ROLLBACK");
    return { error: String(e.message ?? e) };
  }
}

const adminDecide = await as(ADMIN, "SELECT id, decide_by FROM public.declutter_problems");
check(!adminDecide.error && adminDecide.rows.length === 1 && adminDecide.rows[0].decide_by != null,
  `admin selects id, decide_by (withDecideBy) -> ${adminDecide.error ?? JSON.stringify(adminDecide.rows)}`);
const buyerDecide = await as(BUYER, "SELECT id, decide_by FROM public.declutter_problems");
check(!buyerDecide.error && buyerDecide.rows.length === 1, `a side of the order selects decide_by -> ${buyerDecide.error ?? buyerDecide.rows.length + " row"}`);
const stranger = await as("11111111-0000-0000-0000-000000000009", "SELECT id, decide_by FROM public.declutter_problems");
check(!stranger.error && stranger.rows.length === 0, `a stranger still sees no row (RLS) -> ${stranger.error ?? stranger.rows.length + " rows"}`);
for (const col of ["decided_by", "other_side_note", "withdrawn_at"]) {
  const r = await as(ADMIN, `SELECT ${col} FROM public.declutter_problems`);
  check(/permission denied/.test(r.error ?? ""), `${col} stays ungranted -> ${r.error ?? "READABLE"}`);
}
const oldReads = await as(BUYER, "SELECT id, order_id, reporter_side, reason, note, photo_paths, status, created_at FROM public.declutter_problems");
check(!oldReads.error, `the existing client reads still work -> ${oldReads.error ?? "ok"}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
