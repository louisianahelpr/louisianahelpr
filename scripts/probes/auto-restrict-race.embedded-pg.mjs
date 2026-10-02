#!/usr/bin/env node
/**
 * TRUE concurrency proof for docs/OPEN.md Q744: two violations inserted at the
 * same moment in separate transactions must still walk the ladder (the second
 * one suspends), not both count 1 and both send "Final warning".
 *
 * PGlite is one backend (src/test/pglite/autoRestrictWarnFirst.pglite.mjs runs
 * inserts one after the other), so this runs a real throwaway Postgres
 * (embedded-postgres, not a repo dependency):
 *
 *   mkdir -p ~/.lh-pg-embedded && cd ~/.lh-pg-embedded \
 *     && echo '{"name":"lh-pg-embedded","private":true,"type":"module"}' > package.json \
 *     && npm i embedded-postgres pg
 *   node scripts/probes/auto-restrict-race.embedded-pg.mjs
 *
 * tx1 inserts a violation and holds its transaction open; tx2 inserts a second
 * one for the same user while tx1 is open. With the Q744 lock, tx2 waits for
 * tx1, counts 2 and suspends for 7 days. RED proof: the same race on the
 * previous definition (20260927231939) ends with a final warning, no
 * suspension, two "Final warning" notices; printed as "UNLOCKED VARIANT RED".
 * The shipped migrations run 3x each (replay-safety).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = process.env.PG_EMBED_DIR ?? `${process.env.HOME}/.lh-pg-embedded`;
let EmbeddedPostgres, pg;
try {
  ({ default: EmbeddedPostgres } = await import(`${DIR}/node_modules/embedded-postgres/dist/index.js`));
  ({ default: pg } = await import(`${DIR}/node_modules/pg/lib/index.js`));
} catch (e) {
  console.error(`Could not load embedded-postgres/pg from ${DIR}: ${e.message}`);
  process.exit(2);
}

const mig = (f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const CHAIN = [
  "20260903204406_auto_restrict_log_cron_defect.sql",
  "20260927043454_auto_restrict_warn_first.sql",
  "20260927222831_auto_restrict_no_profile_no_notice.sql",
  "20260927230819_auto_restrict_no_profile_no_final_warning.sql",
  "20260927231939_auto_restrict_repeat_offender_no_profile.sql",
];
const Q744 = "20261002055040_auto_restrict_lock_per_user.sql";
const U = "00000000-0000-0000-0000-00000000000a";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cluster(port, withQ744) {
  const dataDir = mkdtempSync(join(tmpdir(), "lh-restrict-race-"));
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  const conn = () => new pg.Client({ host: "localhost", port, user: "postgres", password: "pw", database: "postgres" });
  const admin = conn();
  await admin.connect();
  await admin.query(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notifications (id serial, user_id uuid, type text, title text, message text, link text, read boolean);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  violation_type text NOT NULL, description text, job_id uuid, reported_by uuid,
  action_taken text NOT NULL DEFAULT 'warning', created_at timestamptz DEFAULT now());
CREATE TABLE public.defects (fn text, subject text, err text);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql
  AS $$ INSERT INTO public.defects VALUES (a, b, c) $$;`);
  await admin.query(mig(CHAIN[0]));
  await admin.query(`CREATE TRIGGER auto_restrict_repeat_violators_tg AFTER INSERT ON public.user_violations
    FOR EACH ROW EXECUTE FUNCTION public.auto_restrict_repeat_violators();`);
  for (const f of CHAIN.slice(1)) await admin.query(mig(f));
  if (withQ744) for (let i = 0; i < 3; i++) await admin.query(mig(Q744));
  // seed-policy: not prod — the throwaway embedded-postgres this probe boots in a temp data dir
  await admin.query(`INSERT INTO public.profiles (user_id, full_name) VALUES ('${U}', 'Racer')`);
  const stop = async () => {
    await admin.end().catch(() => {});
    await server.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { admin, conn, stop };
}

async function race({ conn, admin }, holdMs = 1500) {
  const c1 = conn(), c2 = conn();
  await c1.connect(); await c2.connect();
  for (const c of [c1, c2]) await c.query("set statement_timeout = '10s'");
  const ins = (c) => c.query(`INSERT INTO public.user_violations (user_id, violation_type) VALUES ('${U}', 'low_ratings')`)
    .then(() => "ok", (e) => `error: ${e.message}`);
  await c1.query("BEGIN");
  const r1 = await ins(c1);
  const t0 = performance.now();
  const tx1Done = sleep(holdMs).then(() => c1.query("COMMIT")).then(() => "committed", (e) => `failed: ${e.message}`);
  const r2 = await ins(c2);
  const waited = performance.now() - t0;
  const tx1 = await tx1Done;
  await c1.end(); await c2.end();
  const prof = (await admin.query(`SELECT ban_status, auto_suspended_until IS NOT NULL AS suspended FROM public.profiles WHERE user_id='${U}'`)).rows[0];
  const notes = (await admin.query(`SELECT title FROM public.notifications WHERE user_id='${U}' ORDER BY id`)).rows.map((r) => r.title);
  const defects = (await admin.query(`SELECT err FROM public.defects`)).rows.map((r) => r.err);
  return { r1, r2, waited, tx1, prof, notes, defects };
}

// ── The shipped definition (Q744) ─────────────────────────────────────────
{
  const c = await cluster(54393, true);
  try {
    const { r1, r2, waited, tx1, prof, notes, defects } = await race(c);
    check("both inserts succeed", r1 === "ok" && r2 === "ok" && tx1 === "committed", `${r1}; ${r2}; ${tx1}`);
    check("tx2 WAITED for tx1 (the per-user lock), not raced past it", waited >= 1000, `${waited.toFixed(0)} ms`);
    check("the second violation suspends for 7 days", prof.ban_status === "temp_banned" && prof.suspended, JSON.stringify(prof));
    check("one Final warning, then one 7-day suspension notice", JSON.stringify(notes) === JSON.stringify(["Final warning", "Account suspended — 7 days"]), JSON.stringify(notes));
    check("no defect logged", defects.length === 0, JSON.stringify(defects));
  } finally {
    await c.stop();
  }
}

// ── RED: the same race on the previous definition ─────────────────────────
{
  const c = await cluster(54394, false);
  try {
    const { prof, notes } = await race(c);
    const red = prof.ban_status !== "temp_banned";
    console.log(`-- UNLOCKED VARIANT ${red ? "RED" : "NOT RED"}: profile=${JSON.stringify(prof)} notices=${JSON.stringify(notes)}`);
    if (!red) failures++;
  } finally {
    await c.stop();
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
