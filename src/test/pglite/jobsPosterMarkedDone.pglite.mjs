#!/usr/bin/env node
/**
 * PGlite proof for 20261025211357_jobs_poster_marked_done (owner 2026-10-25:
 * three refunded jobs into the poster's Done list, display only).
 *
 *   node src/test/pglite/jobsPosterMarkedDone.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobsPosterMarkedDone.pglite.mjs # RED: the state on main
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR).
 *
 * jobs is a stand-in with prod's grant shape: authenticated holds table-level
 * INSERT/UPDATE, so the new column needs its own lock. Proven: only the owner's
 * three cancelled jobs are marked (not a fourth cancelled job, not another
 * poster's job with one of the ids' shapes, not a job no longer cancelled);
 * replay leaves the first stamp; a client INSERT is cleared; a client UPDATE
 * of it is refused (42501) and of another column passes; the service role can
 * set it; a trigger refusal during the backfill does not fail the migration.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261025211357_jobs_poster_marked_done.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const OWNER = "7f65ef12-1d3d-439b-b0a7-f42ce8bc176d";
const OTHER = "22222222-2222-4222-8222-222222222222";
const [TREES, KIA, HOUSE] = ["375000de-81ae-48fd-810c-362d33e60f3b", "1251173a-e30c-498c-891f-cf5c2d705bdf", "9c321fed-f09c-402c-b5dd-3c9e798e3244"];
const FOURTH = "4d7f3085-a572-48c4-8c5a-a29ddf0e38ea"; // the owner's older refunded "clean": not asked for

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, title text, status text, payment_status text);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
INSERT INTO public.jobs VALUES
  ('${TREES}', '${OWNER}', 'Trim tree branches', 'cancelled', 'refunded'),
  ('${KIA}', '${OWNER}', 'Detail Kia Telluride', 'cancelled', 'refunded'),
  ('${HOUSE}', '${OWNER}', 'Clean a 2-bedroom house', 'cancelled', 'refunded'),
  ('${FOURTH}', '${OWNER}', 'clean', 'cancelled', 'refunded');
`);

const marked = async () => (await db.query(`SELECT id FROM public.jobs WHERE poster_marked_done_at IS NOT NULL ORDER BY id`)).rows.map((r) => r.id);

if (MODE !== "skip") {
  await db.exec(NEW);
  const first = (await db.query(`SELECT poster_marked_done_at AS t FROM public.jobs WHERE id = '${TREES}'`)).rows[0]?.t;
  await db.exec(NEW);
  await db.exec(NEW);
  check("migration applies 3x (replay-safe)", true);
  const again = (await db.query(`SELECT poster_marked_done_at AS t FROM public.jobs WHERE id = '${TREES}'`)).rows[0]?.t;
  check("replay keeps the first stamp", String(first) === String(again));
}

let ids = [];
try { ids = await marked(); } catch (e) { ids = [`error: ${e.message}`]; }
check("exactly the owner's three are marked", JSON.stringify(ids) === JSON.stringify([KIA, TREES, HOUSE].sort()), JSON.stringify(ids));
check("the older refunded job was not marked", !ids.includes(FOURTH));

async function as(role, sql) {
  try {
    await db.exec(`SET ROLE ${role};`);
    const r = await db.query(sql);
    return { rows: r.rows };
  } catch (e) {
    return { error: e.message, code: e.code };
  } finally {
    await db.exec("RESET ROLE;");
  }
}

const ins = await as("authenticated", `INSERT INTO public.jobs (id, customer_id, title, status, poster_marked_done_at) VALUES ('${OTHER}', '${OTHER}', 'x', 'open', now()) RETURNING poster_marked_done_at`);
check("a client INSERT has it cleared", !ins.error && ins.rows?.[0]?.poster_marked_done_at === null, ins.error ?? "");
const upd = await as("authenticated", `UPDATE public.jobs SET poster_marked_done_at = now() WHERE id = '${FOURTH}'`);
check("a client UPDATE of it is refused 42501", upd.code === "42501", upd.error ?? "no error");
const other = await as("authenticated", `UPDATE public.jobs SET title = 'y' WHERE id = '${OTHER}'`);
check("a client UPDATE of another column passes", !other.error, other.error ?? "");
const svc = await as("service_role", `UPDATE public.jobs SET poster_marked_done_at = now() WHERE id = '${OTHER}'`);
check("the service role can set it", !svc.error, svc.error ?? "");

// A refusing trigger during the backfill must not fail the migration.
if (MODE !== "skip") {
  const db2 = new PGlite();
  await db2.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, title text, status text, payment_status text);
INSERT INTO public.jobs VALUES ('${TREES}', '${OWNER}', 't', 'cancelled', 'refunded');
CREATE FUNCTION public.refuse_all() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'nope'; END $$;
CREATE TRIGGER zz_refuse BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.refuse_all();
`);
  let err = null;
  try { await db2.exec(NEW); } catch (e) { err = e.message; }
  check("a trigger refusal in the backfill does not fail the migration", err === null, err ?? "");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
