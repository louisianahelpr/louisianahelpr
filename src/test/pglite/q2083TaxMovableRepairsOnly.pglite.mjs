#!/usr/bin/env node
/**
 * PGlite proof for 20261102033237_q2083_tax_movable_repairs_only (Q2083, owner Option 1).
 *
 *   node src/test/pglite/q2083TaxMovableRepairsOnly.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/q2083TaxMovableRepairsOnly.pglite.mjs   # RED on main's definitions
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs as in tradesTaxedLikeHandyman.pglite.mjs: roles + Supabase's
 * default function ACL (EXECUTE to anon, authenticated, service_role), auth.uid(),
 * is_server_context(), the job_category enum with prod's 24 values, and a jobs
 * table with the columns the trigger reads. Main's current definitions (both in
 * 20261017055441) are loaded VERBATIM, then the new migration 3x, each in its own
 * transaction like the migration runner.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_MIG = readFileSync(process.env.MIG_PATH ?? `${MIG_DIR}20261102033237_q2083_tax_movable_repairs_only.sql`, "utf8");
const OLD_MIG = readFileSync(`${MIG_DIR}20261017055441_trades_taxed_like_handyman.sql`, "utf8");

const TRADES = ["electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "auto_repair", "appliance_repair", "flooring", "concrete_masonry", "fencing", "pressure_washing"];
const ALL = ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "other", "storm_prep", "events", ...TRADES];
// The memo's taxable set (docs/OPEN.md Q2083; La. R.S. 47:301.3(7)).
const TAXABLE = ["auto_repair", "appliance_repair"];
const UNTAXED = ALL.filter((c) => !TAXABLE.includes(c));

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
await db.exec(`BEGIN;\n${OLD_MIG}\nCOMMIT;`);
// The trigger itself (20260924082243 creates it on public.jobs; restatements keep it).
await db.exec(`CREATE TRIGGER trg_enforce_funded_category_tax_class BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_funded_category_tax_class();`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(`BEGIN;\n${NEW_MIG}\nCOMMIT;`);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

// 1. is_category_taxable answers exactly the memo's set, over every enum value.
const { rows: taxRows } = await db.query(
  `SELECT c::text AS c, public.is_category_taxable(c) AS t FROM unnest(enum_range(NULL::public.job_category)) c`,
);
check("enum has prod's 24 values", taxRows.length === 24, `${taxRows.length}`);
const wrong = taxRows.filter((r) => r.t !== TAXABLE.includes(r.c)).map((r) => `${r.c}=${r.t}`);
check("is_category_taxable is true exactly for auto_repair and appliance_repair", wrong.length === 0, wrong.join(", "));
const { rows: nul } = await db.query(`SELECT public.is_category_taxable(NULL) AS t`);
check("is_category_taxable(NULL) is false, not NULL", nul[0].t === false, String(nul[0].t));

// 2. ACL after the anon-default emulation: service_role only.
const { rows: acl } = await db.query(
  `SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
          has_function_privilege('service_role', p.oid, 'EXECUTE') s
     FROM pg_proc p WHERE p.proname IN ('is_category_taxable','enforce_funded_category_tax_class')`,
);
check("anon/authenticated cannot EXECUTE either function", acl.length === 2 && acl.every((r) => !r.a && !r.u), JSON.stringify(acl));
check("service_role can EXECUTE is_category_taxable", acl.some((r) => r.proname === "is_category_taxable" && r.s));

// 2b. A FRESH apply (no earlier definition to inherit an ACL from): the
// migration's own REVOKEs must beat Supabase's default anon EXECUTE grant.
if (process.env.NEW_MIGRATION !== "skip") {
  const fresh = new PGlite();
  await fresh.exec(SCHEMA);
  await fresh.exec(`BEGIN;\n${NEW_MIG}\nCOMMIT;`);
  const { rows: facl } = await fresh.query(
    `SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u
       FROM pg_proc p WHERE p.proname IN ('is_category_taxable','enforce_funded_category_tax_class')`,
  );
  check("fresh apply: anon/authenticated cannot EXECUTE either function", facl.length === 2 && facl.every((r) => !r.a && !r.u), JSON.stringify(facl));
  await fresh.close();
}

// 3. The trigger, as the poster on a PAID job.
const poster = "11111111-1111-1111-1111-111111111111";
await db.exec(`SELECT set_config('request.jwt.claim.sub', '${poster}', false)`);
const move = async (from, to, paid = true) => {
  const { rows } = await db.query(
    `INSERT INTO public.jobs (customer_id, category, payment_status) VALUES ($1, $2::public.job_category, $3) RETURNING id`,
    [poster, from, paid ? "escrow" : "unpaid"],
  );
  try {
    await db.query(`UPDATE public.jobs SET category = $1::public.job_category WHERE id = $2`, [to, rows[0].id]);
    return "ok";
  } catch (e) {
    return /taxed and untaxed/.test(String(e.message)) ? "refused" : `error: ${e.message}`;
  }
};
const crossIn = [];
for (const c of UNTAXED) if ((await move(c, "auto_repair")) === "refused") crossIn.push(c);
check("paid untaxed -> auto_repair is refused for every untaxed category", crossIn.length === UNTAXED.length, `${crossIn.length}/${UNTAXED.length}`);
const crossOut = [];
for (const c of UNTAXED) if ((await move("appliance_repair", c)) === "refused") crossOut.push(c);
check("paid appliance_repair -> any untaxed category is refused", crossOut.length === UNTAXED.length, `${crossOut.length}/${UNTAXED.length}`);
check("paid auto_repair <-> appliance_repair is allowed (same class)", (await move("auto_repair", "appliance_repair")) === "ok");
// The reversed Q1831 shape: house work and the real-property trades are one (untaxed) class now.
const houseOk = [];
for (const t of ["electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "flooring", "concrete_masonry", "fencing", "pressure_washing", "assembly"]) {
  if ((await move("cleaning", t)) === "ok") houseOk.push(t);
}
check("paid cleaning -> handyman-class trades and assembly are allowed (all untaxed)", houseOk.length === 11, `${houseOk.length}/11`);
check("paid handyman -> cleaning is allowed", (await move("handyman", "cleaning")) === "ok");

// 4. Unpaid jobs stay freely editable; the server context is never blocked.
check("unpaid cleaning -> auto_repair is allowed", (await move("cleaning", "auto_repair", false)) === "ok");
await db.exec(`SELECT set_config('test.server', 'on', false)`);
check("server context: paid cleaning -> auto_repair is allowed", (await move("cleaning", "auto_repair")) === "ok");
await db.exec(`SELECT set_config('test.server', '', false)`);
// Someone other than the poster is not this trigger's concern (RLS decides).
await db.exec(`SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false)`);
const { rows: other } = await db.query(
  `INSERT INTO public.jobs (customer_id, category, payment_status) VALUES ($1, 'cleaning', 'escrow') RETURNING id`, [poster]);
let otherOk = true;
try { await db.query(`UPDATE public.jobs SET category = 'auto_repair' WHERE id = $1`, [other[0].id]); } catch { otherOk = false; }
check("non-poster update passes through the trigger (unchanged behaviour)", otherOk);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
