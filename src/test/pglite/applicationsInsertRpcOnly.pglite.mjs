#!/usr/bin/env node
/**
 * PGlite proof for 20261004184135_applications_insert_rpc_only (docs/OPEN.md Q1009).
 *
 *   node src/test/pglite/applicationsInsertRpcOnly.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/applicationsInsertRpcOnly.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = public.applications as LIVE on 2026-10-04
 * (scripts/probes/fixtures/applications.live.sql: columns, UNIQUE, table ACL,
 * the seven policies, apply_to_job and enforce_application_limit). Roles are
 * real: `SET ROLE authenticated` with request.uid set is PostgREST with a user
 * JWT; the RPC is SECURITY DEFINER owned by the superuser, as on prod.
 *
 * The defect: a Helpr's direct INSERT (the app's old PGRST202 fallback, or any
 * client) passes the policy, so it skips apply_to_job's per-minute and
 * per-hour caps and its advisory lock. With the minute cap at 1 the RPC
 * refuses the second apply, and the raw INSERT does not.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/applications.live.sql");
const NEW = read("../../../supabase/migrations/20261004184135_applications_insert_rpc_only.sql");
const CHECK = read("../../../scripts/ci/client-insert-columns.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(LIVE);
// The rest of the class check's declared tables, so its other rows read clean
// and only the applications rows are under test here.
await db.exec(`
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, job_id uuid, sender_id uuid, receiver_id uuid,
  content text, attachment_url text, attachment_mime text, attachment_size int, attachment_duration int, reply_to_id uuid, read boolean, is_system boolean);
REVOKE ALL ON public.messages FROM PUBLIC, anon, authenticated;
GRANT INSERT (client_id, job_id, sender_id, receiver_id, content, attachment_url, attachment_mime, attachment_size, attachment_duration, reply_to_id) ON public.messages TO authenticated;
GRANT UPDATE (content, read) ON public.messages TO authenticated;
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

// Five funded open jobs, one unfunded, all the poster's.
await db.exec(`
INSERT INTO public.jobs (id, customer_id, status, payment_status) VALUES
  ('${id(1)}', '${POSTER}', 'open', 'escrow'), ('${id(2)}', '${POSTER}', 'open', 'escrow'),
  ('${id(3)}', '${POSTER}', 'open', 'escrow'), ('${id(4)}', '${POSTER}', 'open', 'escrow'),
  ('${id(5)}', '${POSTER}', 'open', 'escrow'), ('${id(6)}', '${POSTER}', 'open', 'unpaid');
UPDATE public.platform_settings SET application_cap_per_minute = 1;
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : who ? "authenticated" : "anon"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const apps = async () => (await db.query(`SELECT count(*)::int AS n FROM public.applications WHERE helper_id = '${HELPER}'`)).rows[0].n;
const raw = (job) => as(HELPER, `INSERT INTO public.applications (job_id, helper_id, message) VALUES ('${job}', '${HELPER}', 'hi') RETURNING id`);

// ── the one door: apply_to_job still works, and still holds the minute cap ──
{
  const r = await as(HELPER, `SELECT public.apply_to_job('${id(1)}', 'first') AS id`);
  check("L1 the RPC writes the Helpr's application", r.ok && r.rows[0]?.id, r.ok ? "" : r.err);
  const r2 = await as(HELPER, `SELECT public.apply_to_job('${id(2)}', 'second') AS id`);
  check("L2 ...and refuses a second within the minute (cap 1)", !r2.ok && /rate_limit_minute/.test(r2.err), r2.ok ? "landed" : r2.err);
}

// ── the trapdoor: a raw INSERT is refused (RED on live: it lands past the cap) ──
{
  const before = await apps();
  const r = await raw(id(3));
  check("R1 a Helpr's direct INSERT is refused (it skipped the minute cap)", !r.ok && /permission denied/i.test(r.err) && (await apps()) === before, r.ok ? `landed; ${await apps()} applications in one minute against a cap of 1` : r.err);
  const r2 = await raw(id(4));
  check("R2 ...every time (no second door past the cap either)", !r2.ok && /permission denied/i.test(r2.err), r2.ok ? "landed" : r2.err);
  const anon = await as(null, `INSERT INTO public.applications (job_id, helper_id) VALUES ('${id(5)}', '${HELPER}') RETURNING id`);
  check("R3 anon's direct INSERT is refused", !anon.ok && /permission denied/i.test(anon.err), anon.ok ? "landed" : anon.err);
  const unfunded = await raw(id(6));
  check("R4 a direct INSERT on an unfunded job is refused at the grant", !unfunded.ok && /permission denied/i.test(unfunded.err), unfunded.ok ? "landed" : unfunded.err);
}

// ── the rest of the client's application writes are unchanged ──────────────
{
  const mine = (await db.query(`SELECT id FROM public.applications WHERE helper_id = '${HELPER}' AND job_id = '${id(1)}'`)).rows[0].id;
  const u = await as(HELPER, `UPDATE public.applications SET attachment_urls = ARRAY['a.jpg'] WHERE id = '${mine}' RETURNING id`);
  check("L3 the Helpr still patches attachment_urls onto their row (useApplyFlow)", u.ok && u.rows.length === 1, u.ok ? `${u.rows.length} row(s)` : u.err);
  const s = await as("service", `INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${id(5)}', '${HELPER}', 'accepted') ON CONFLICT (job_id, helper_id) DO UPDATE SET status = EXCLUDED.status RETURNING id`);
  check("L4 the service role's upsert (charge-recurring-visits) still writes", s.ok && s.rows.length === 1, s.ok ? "" : s.err);
  const d = await as(HELPER, `DELETE FROM public.applications WHERE id = '${mine}' RETURNING id`);
  check("L5 the Helpr still withdraws a pending application (DELETE)", d.ok && d.rows.length === 1, d.ok ? `${d.rows.length} row(s)` : d.err);
}

// ── the class check ─────────────────────────────────────────────────────────
{
  const rows = (await db.query(CHECK.replace(/;\s*$/, ""))).rows.filter((r) => r.table === "applications" && /INSERT/.test(r.what));
  check("C1 scripts/ci/client-insert-columns.sql is clean for applications", rows.length === 0, rows.map((r) => `${r.role}: ${r.what}`).join("; ") || "0 rows");
}
if (MODE !== "skip") {
  await db.exec("GRANT INSERT (job_id, helper_id, message) ON public.applications TO authenticated;");
  const rows = (await db.query(CHECK.replace(/;\s*$/, ""))).rows.filter((r) => r.table === "applications" && /INSERT/.test(r.what)).map((r) => `${r.role}: ${r.what}`);
  check("C2 ...and flags a column INSERT grant coming back", rows.includes("authenticated: INSERT (helper_id)"), rows.join("; "));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
