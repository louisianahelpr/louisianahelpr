/**
 * PGlite proof for 20260926043528_log_cron_defect_cap_alerts (CJ-007 follow-up).
 *
 *   node src/test/pglite/logCronDefectCapAlerts.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Proves: applies 3x; 25 failures on distinct rows in an hour file 20 defect
 * rows plus ONE 'defect-cap' row whose context.dropped is 5; a repeat of an
 * already-filed row is deduped, not counted as dropped; the cap row does not
 * count toward the cap; each function has its own cap; a '-seed' function's
 * cap row keeps the '-seed' source; a cap row older than an hour starts a new
 * one; it still never raises. RED: the previous body (20260831193039) on the
 * same 25 failures files 20 rows and no trace of the other 5.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = read("20260926043528_log_cron_defect_cap_alerts.sql");
const OLD_FILE = read("20260831193039_cron_sql_error_reporting.sql");
const OLD = (() => {
  const i = OLD_FILE.indexOf("CREATE OR REPLACE FUNCTION public.log_cron_defect(");
  return OLD_FILE.slice(i, OLD_FILE.indexOf("$$;", OLD_FILE.indexOf("AS $$", i) + 5) + 3);
})();

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
`);
const fail = (fn, ref) => q(`SELECT public.log_cron_defect($1, $2, 'boom ' || $2, '{}'::jsonb)`, [fn, ref]);
const rows = async (fn) => (await one(`SELECT count(*) FILTER (WHERE tags->>'ref' IS DISTINCT FROM 'defect-cap')::int defects,
                                              count(*) FILTER (WHERE tags->>'ref' = 'defect-cap')::int caps
                                         FROM public.error_logs WHERE tags->>'source' = $1`, [fn]));
const cap = async (fn) => (await one(`SELECT context, message FROM public.error_logs WHERE tags->>'source' = $1 AND tags->>'ref' = 'defect-cap' ORDER BY created_at DESC LIMIT 1`, [fn]));

// ── RED: the previous body ──────────────────────────────────────────────────
await db.exec(OLD);
for (let i = 0; i < 25; i++) await fail("sweep_x", `row-${i}`);
const old = await rows("sweep_x");
check("RED: previous body files 20 rows and no trace of the 5 it dropped", old.defects === 20 && old.caps === 0, JSON.stringify(old));
await db.exec(`DELETE FROM public.error_logs`);

// ── apply 3x ────────────────────────────────────────────────────────────────
let applied = 0;
for (let i = 0; i < 3; i++) {
  try { await db.exec(NEW); applied++; } catch (e) { console.log(`apply ${i + 1}: ${e.message}`); }
}
check("the migration applies 3x", applied === 3, `${applied}/3`);

// ── the cap is loud ─────────────────────────────────────────────────────────
for (let i = 0; i < 25; i++) await fail("sweep_x", `row-${i}`);
let r = await rows("sweep_x");
let c = await cap("sweep_x");
check("25 failures: 20 defect rows + ONE cap row", r.defects === 20 && r.caps === 1, JSON.stringify(r));
check("the cap row counts the 5 dropped and names the first and last",
  c.context.dropped === 5 && c.context.first_dropped_ref === "row-20" && c.context.last_dropped_ref === "row-24", JSON.stringify(c.context));
check("its title is stable (no ref or count in the message before ' — ')",
  c.message.split(" — ")[0] === "sweep_x: over 20 failures in an hour", c.message);
await fail("sweep_x", "row-3");
check("a repeat of an already-filed row is deduped, not counted as dropped", (await cap("sweep_x")).context.dropped === 5);
await fail("sweep_x", "row-99");
r = await rows("sweep_x");
check("the cap row is not counted toward the cap: still 20 defects, one cap row, dropped 6",
  r.defects === 20 && r.caps === 1 && (await cap("sweep_x")).context.dropped === 6, JSON.stringify(r));

// ── per function, seed source kept ──────────────────────────────────────────
for (let i = 0; i < 3; i++) await fail("sweep_y", `y-${i}`);
check("another function has its own cap (3 rows, no cap row)", JSON.stringify(await rows("sweep_y")) === '{"defects":3,"caps":0}');
for (let i = 0; i < 22; i++) await fail("detect_stuck_payments-seed", `s-${i}`);
const seedCap = await one(`SELECT tags FROM public.error_logs WHERE tags->>'ref' = 'defect-cap' AND tags->>'source' LIKE '%-seed'`);
check("a -seed function's cap row keeps the -seed source (stays out of paging)",
  seedCap?.tags?.source === "detect_stuck_payments-seed", JSON.stringify(seedCap));

// ── next hour ───────────────────────────────────────────────────────────────
await db.exec(`UPDATE public.error_logs SET created_at = created_at - interval '2 hours' WHERE tags->>'source' = 'sweep_x'`);
for (let i = 0; i < 21; i++) await fail("sweep_x", `h2-${i}`);
r = await rows("sweep_x");
check("an hour later the cap resets: a new cap row with dropped 1", r.caps === 2 && (await cap("sweep_x")).context.dropped === 1, JSON.stringify(r));

// ── never raises ────────────────────────────────────────────────────────────
await db.exec(`CREATE FUNCTION public._no() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'no writes'; END $f$;
               CREATE TRIGGER _no BEFORE INSERT OR UPDATE ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public._no();`);
let raised = false;
try { for (let i = 0; i < 3; i++) await fail("sweep_z", `z-${i}`); await fail("sweep_x", "h2-99"); } catch { raised = true; }
check("still never raises, even when the error_logs write itself fails", !raised);

// ── ACL ─────────────────────────────────────────────────────────────────────
const a = await one(`SELECT has_function_privilege('anon', 'public.log_cron_defect(text,text,text,jsonb)', 'EXECUTE') anon,
                            has_function_privilege('authenticated', 'public.log_cron_defect(text,text,text,jsonb)', 'EXECUTE') auth,
                            has_function_privilege('service_role', 'public.log_cron_defect(text,text,text,jsonb)', 'EXECUTE') svc`);
check("anon/authenticated cannot execute; service_role can", !a.anon && !a.auth && a.svc, JSON.stringify(a));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
