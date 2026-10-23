#!/usr/bin/env node
/**
 * PGlite proof for 20261023192154_job_tax_kind (owner 2026-10-23, #3555 /
 * Q2083: a job is taxed when its category is one of the 14 OR the poster says
 * it fixes an item, cleans carpet, rugs, upholstery or furniture, or alters clothes).
 *
 *   node src/test/pglite/jobTaxKind.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/jobTaxKind.pglite.mjs   # RED without the file
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs as tradesTaxedLikeHandyman.pglite.mjs (roles + prod's
 * default function ACL, auth.uid(), is_server_context(), the job_category enum
 * with prod's 24 values, a jobs table with the columns the trigger reads). The
 * previous definitions load VERBATIM from their migrations (20260924082243 the
 * trigger, 20261017055441 its newest body and is_category_taxable), then the
 * new migration 3x, each in its own transaction like the migration runner.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_MIG = readFileSync(process.env.MIG_PATH ?? `${MIG_DIR}20261023192154_job_tax_kind.sql`, "utf8");
const OLD_TRIGGER = readFileSync(`${MIG_DIR}20260924082243_funded_category_tax_class_lock.sql`, "utf8");
const TRADES_MIG = readFileSync(`${MIG_DIR}20261017055441_trades_taxed_like_handyman.sql`, "utf8");

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
-- The poster edits as authenticated (the trigger runs as the invoker).
GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated;
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(OLD_TRIGGER);
await db.exec(TRADES_MIG);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(`BEGIN;\n${NEW_MIG}\nCOMMIT;`);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};
const tryQ = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
};

// 1. The column and its CHECK.
const { rows: col } = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'tax_kind'`);
check("jobs.tax_kind exists", col[0].n === 1);
const badKind = await tryQ(`INSERT INTO public.jobs (category, tax_kind) VALUES ('cleaning', 'sofa')`);
check("the CHECK refuses an unknown kind", badKind !== null && /jobs_tax_kind_valid|check/i.test(badKind), badKind ?? "accepted");
check("the CHECK accepts the three kinds and NULL",
  (await tryQ(`INSERT INTO public.jobs (category, tax_kind) VALUES ('cleaning', 'fabric_cleaning'), ('other', 'item_repair'), ('other', 'clothing_alterations'), ('cleaning', NULL)`)) === null);

// 2. is_job_labor_taxable: the 14 categories, or a taxed kind.
let wrong = [];
try {
  const { rows } = await db.query(
    `SELECT c::text AS c, k, public.is_job_labor_taxable(c, k) AS t
       FROM unnest(enum_range(NULL::public.job_category)) c
       CROSS JOIN unnest(ARRAY[NULL, 'item_repair', 'fabric_cleaning', 'clothing_alterations', 'laundry']::text[]) k`,
  );
  wrong = rows.filter((r) => r.t !== (TAXABLE.includes(r.c) || ["item_repair", "fabric_cleaning", "clothing_alterations"].includes(r.k))).map((r) => `${r.c}/${r.k}=${r.t}`);
  check("is_job_labor_taxable = a taxed category OR a taxed kind (laundry is not one), over every enum value x kind", rows.length === 120 && wrong.length === 0, `${rows.length} rows; ${wrong.join(", ")}`);
} catch (e) {
  check("is_job_labor_taxable exists", false, String(e.message));
}
const { rows: acl } = await db.query(
  `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u
     FROM pg_proc p WHERE p.proname = 'is_job_labor_taxable'`,
);
check("anon/authenticated cannot EXECUTE is_job_labor_taxable", acl.length === 1 && !acl[0].a && !acl[0].u, JSON.stringify(acl));

// 3. The trigger, as the poster (authenticated) on a PAID job.
const poster = "11111111-1111-1111-1111-111111111111";
const paidJob = async (category, kind) => {
  const { rows } = await db.query(
    `INSERT INTO public.jobs (customer_id, category, tax_kind, payment_status) VALUES ($1, $2::public.job_category, $3, 'escrow') RETURNING id`,
    [poster, category, kind],
  );
  return rows[0].id;
};
const asPoster = async (sql, params) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${poster}', false); SET ROLE authenticated;`);
  try {
    return await tryQ(sql, params);
  } finally {
    await db.exec(`RESET ROLE;`);
  }
};
const crosses = (e) => e !== null && /taxed and untaxed/.test(e);

let id = await paidJob("cleaning", null);
let e = await asPoster(`UPDATE public.jobs SET tax_kind = 'fabric_cleaning' WHERE id = $1`, [id]);
check("paid untaxed cleaning -> fabric_cleaning is refused (crosses into taxed)", crosses(e), e ?? "allowed");

id = await paidJob("cleaning", "fabric_cleaning");
e = await asPoster(`UPDATE public.jobs SET tax_kind = NULL WHERE id = $1`, [id]);
check("paid cleaning + fabric_cleaning -> no kind is refused (crosses out of taxed)", crosses(e), e ?? "allowed");

id = await paidJob("cleaning", "fabric_cleaning");
e = await asPoster(`UPDATE public.jobs SET category = 'yard_work' WHERE id = $1`, [id]);
check("paid cleaning + fabric_cleaning -> yard_work is allowed (still taxed by the kind)", e === null, e ?? "");

id = await paidJob("cleaning", "item_repair");
e = await asPoster(`UPDATE public.jobs SET tax_kind = 'fabric_cleaning' WHERE id = $1`, [id]);
check("paid item_repair -> fabric_cleaning is allowed (taxed both ways)", e === null, e ?? "");

id = await paidJob("handyman", null);
e = await asPoster(`UPDATE public.jobs SET category = 'cleaning' WHERE id = $1`, [id]);
check("paid handyman -> cleaning (no kind) is still refused (the 14-category rule kept)", crosses(e), e ?? "allowed");

const { rows: u } = await db.query(`INSERT INTO public.jobs (customer_id, category) VALUES ($1, 'cleaning') RETURNING id`, [poster]);
e = await asPoster(`UPDATE public.jobs SET tax_kind = 'item_repair' WHERE id = $1`, [u[0].id]);
check("an UNPAID job's kind is freely editable", e === null, e ?? "");

id = await paidJob("cleaning", null);
await db.exec(`SELECT set_config('test.server', 'on', false)`);
e = await tryQ(`UPDATE public.jobs SET tax_kind = 'fabric_cleaning' WHERE id = $1`, [id]);
await db.exec(`SELECT set_config('test.server', '', false)`);
check("a server write passes (as before)", e === null, e ?? "");

// 4. The export's Taxable/Exempt column reads the rule.
const { rows: fn } = await db.query(`SELECT pg_get_functiondef('public.get_helper_earnings_export(uuid, date, date)'::regprocedure) AS d`).catch(() => ({ rows: [{ d: "" }] }));
check("get_helper_earnings_export reads is_job_labor_taxable(category, tax_kind)",
  /is_job_labor_taxable\(j\.category, j\.tax_kind\)/.test(fn[0]?.d ?? "") && !/is_category_taxable\(j\.category\)/.test(fn[0]?.d ?? ""));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
