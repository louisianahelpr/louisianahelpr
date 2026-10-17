#!/usr/bin/env node
/**
 * PGlite proof for 20261017055441_trades_taxed_like_handyman (Q1831, Q1833).
 *
 *   node src/test/pglite/tradesTaxedLikeHandyman.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/tradesTaxedLikeHandyman.pglite.mjs   # RED on main's definitions
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs: roles + prod's default function ACL, auth.uid(),
 * is_server_context(), the job_category enum with prod's 24 values (read
 * 2026-10-17 with pg_enum), and a jobs table with the columns the trigger reads
 * (category is the enum, as on prod). Main's previous definitions are loaded
 * VERBATIM from their migrations (20260418080453 is_category_taxable,
 * 20260924082243 the trigger), then the new migration 3x, each in its own
 * transaction like the migration runner.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_MIG = readFileSync(process.env.MIG_PATH ?? `${MIG_DIR}20261017055441_trades_taxed_like_handyman.sql`, "utf8");

const OLD_TAXABLE_FN = (() => {
  const sql = readFileSync(`${MIG_DIR}20260418080453_ce2b12ea-eef6-43e2-9c38-72cb390ecf39.sql`, "utf8");
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.is_category_taxable");
  const end = sql.indexOf("$$;", sql.indexOf("AS $$", start) + 5);
  return sql.slice(start, end + 3);
})();
const OLD_TRIGGER = readFileSync(`${MIG_DIR}20260924082243_funded_category_tax_class_lock.sql`, "utf8");

const TRADES = ["electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "auto_repair", "appliance_repair", "flooring", "concrete_masonry", "fencing", "pressure_washing"];
const TAXABLE = ["assembly", "handyman", ...TRADES];
const ALL = ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "other", "storm_prep", "events", ...TRADES];

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.server', true), '') = 'on' $$;
CREATE TYPE public.job_category AS ENUM (${ALL.map((c) => `'${c}'`).join(",")});
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid,
  category public.job_category NOT NULL,
  payment_status text NOT NULL DEFAULT 'unpaid',
  stripe_session_id text
);
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(OLD_TAXABLE_FN);
await db.exec(OLD_TRIGGER);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(`BEGIN;\n${NEW_MIG}\nCOMMIT;`);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

// 1. is_category_taxable answers exactly TAXABLE, over every enum value.
const { rows: taxRows } = await db.query(
  `SELECT c::text AS c, public.is_category_taxable(c) AS t FROM unnest(enum_range(NULL::public.job_category)) c`,
);
check("enum has prod's 24 values", taxRows.length === 24, `${taxRows.length}`);
const wrong = taxRows.filter((r) => r.t !== TAXABLE.includes(r.c)).map((r) => `${r.c}=${r.t}`);
check("is_category_taxable is true exactly for assembly, handyman and the 12 trades", wrong.length === 0, wrong.join(", "));

// 2. ACL: service_role only (postgres owner implicit).
const { rows: acl } = await db.query(
  `SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u
     FROM pg_proc p WHERE p.proname IN ('is_category_taxable','enforce_funded_category_tax_class')`,
);
check("anon/authenticated cannot EXECUTE either function", acl.length === 2 && acl.every((r) => !r.a && !r.u), JSON.stringify(acl));

// 3. The trigger: a poster on a PAID job crosses the line between cleaning and each trade.
const poster = "11111111-1111-1111-1111-111111111111";
await db.exec(`SELECT set_config('request.jwt.claim.sub', '${poster}', false)`);
const crossRefused = [];
const withinOk = [];
for (const trade of TRADES) {
  const { rows } = await db.query(
    `INSERT INTO public.jobs (customer_id, category, payment_status) VALUES ($1, 'cleaning', 'escrow') RETURNING id`,
    [poster],
  );
  try {
    await db.query(`UPDATE public.jobs SET category = $1::public.job_category WHERE id = $2`, [trade, rows[0].id]);
  } catch (e) {
    if (/taxed and untaxed/.test(String(e.message))) crossRefused.push(trade);
    else if (trade === TRADES[0]) console.log(`  cleaning -> ${trade}: unexpected error ${e.message}`);
  }
  const { rows: r2 } = await db.query(
    `INSERT INTO public.jobs (customer_id, category, payment_status) VALUES ($1, 'handyman', 'escrow') RETURNING id`,
    [poster],
  );
  try {
    await db.query(`UPDATE public.jobs SET category = $1::public.job_category WHERE id = $2`, [trade, r2[0].id]);
    withinOk.push(trade);
  } catch (e) {
    if (trade === TRADES[0]) console.log(`  handyman -> ${trade} refused: ${e.message}`);
  }
}
check("paid cleaning -> each trade is refused (crosses the taxed line)", crossRefused.length === 12, `${crossRefused.length}/12`);
check("paid handyman -> each trade is allowed (same tax class)", withinOk.length === 12, `${withinOk.length}/12`);

// 4. Unpaid jobs stay freely editable.
const { rows: u } = await db.query(
  `INSERT INTO public.jobs (customer_id, category) VALUES ($1, 'cleaning') RETURNING id`,
  [poster],
);
let unpaidOk = true;
try {
  await db.query(`UPDATE public.jobs SET category = 'plumbing' WHERE id = $1`, [u[0].id]);
} catch (e) {
  unpaidOk = false;
  console.log(`  unpaid update refused: ${e.message}`);
}
check("unpaid cleaning -> plumbing is allowed", unpaidOk);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
