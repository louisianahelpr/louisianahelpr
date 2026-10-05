#!/usr/bin/env node
/**
 * PGlite proof for 20261005060416_direct_offer_markers_server_owned_on_insert
 * (docs/OPEN.md Q1283). Harness = jobsIdServerOwned.pglite.mjs's, with
 * enforce_jobs_insert_column_lock at 20261004191544 (= live 2026-10-05).
 *
 *   node src/test/pglite/directOfferMarkersOnInsert.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/directOfferMarkersOnInsert.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE jobs trigger chain and policies
 * (scripts/probes/fixtures/dispute-table-door.live.sql), with
 * enforce_jobs_insert_column_lock replaced by its newest definition on main
 * (20261004165404, md5 = live). `SET ROLE authenticated` is PostgREST with a
 * user JWT (auth.uid() = the poster); `SET ROLE service_role` is an edge
 * function.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261005060416_direct_offer_markers_server_owned_on_insert.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ALTER COLUMN created_at SET DEFAULT now();
-- Live default (information_schema.columns, 2026-10-04); the 09-14 fixture omits it.
ALTER TABLE public.jobs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_ft numeric,
  ADD COLUMN IF NOT EXISTS recurring_helper_id uuid,
  ADD COLUMN IF NOT EXISTS helper_arrival_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_on_the_way_at timestamptz;
`);
await db.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
await db.exec(cut("20261004191544_jobs_id_server_owned.sql", "enforce_jobs_insert_column_lock"));
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);
await db.exec(`INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES ('${POSTER}', 'verified', false);`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : "authenticated"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : "SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const post = async (who, extra) => {
  const keys = Object.keys(extra);
  const r = await as(who, `INSERT INTO public.jobs (customer_id, title, status, budget${keys.map((k) => `, ${k}`).join("")})
    VALUES ('${POSTER}', 'offer', 'open', 50${keys.map((k) => `, ${extra[k]}`).join("")})
    RETURNING direct_offer_status AS s, extract(epoch FROM direct_offer_expires_at - now())::int AS secs`);
  return r;
};
const H = 3600;
const near = (secs, want) => Math.abs(secs - want) <= 120;

{
  const r = await post(POSTER, { direct_offer_status: "'accepted'" });
  check("R1 no offer: a sent 'accepted' marker is dropped", r.ok && r.rows[0].s === null, r.ok ? JSON.stringify(r.rows[0]) : r.err);
  const e = await post(POSTER, { direct_offer_status: "'pending'", direct_offer_expires_at: "now() + interval '30 days'" });
  check("R2 no offer: a sent pending marker and expiry are dropped", e.ok && e.rows[0].s === null && e.rows[0].secs === null, e.ok ? JSON.stringify(e.rows[0]) : e.err);
}
{
  const n = await post(POSTER, { offered_to_helper_id: `'${HELPR}'`, direct_offer_status: "'pending'" });
  check("R3 an offer with a NULL expiry gets the 24h default (the sweep can clear it)", n.ok && n.rows[0].s === "pending" && near(n.rows[0].secs, 24 * H), n.ok ? JSON.stringify(n.rows[0]) : n.err);
  const far = await post(POSTER, { offered_to_helper_id: `'${HELPR}'`, direct_offer_status: "'pending'", direct_offer_expires_at: "now() + interval '400 days'" });
  check("R4 a far-future expiry is held to 48h", far.ok && near(far.rows[0].secs, 48 * H), far.ok ? JSON.stringify(far.rows[0]) : far.err);
  const past = await post(POSTER, { offered_to_helper_id: `'${HELPR}'`, direct_offer_status: "'pending'", direct_offer_expires_at: "now() - interval '3 hours'" });
  check("R5 a past expiry (a slow phone clock) becomes the 1h minimum, the post is not refused", past.ok && near(past.rows[0].secs, 1 * H), past.ok ? JSON.stringify(past.rows[0]) : past.err);
  const dec = await post(POSTER, { offered_to_helper_id: `'${HELPR}'`, direct_offer_status: "'declined'", direct_offer_expires_at: "now() + interval '4 hours'" });
  check("R6 an offer posted as 'declined' is 'pending'", dec.ok && dec.rows[0].s === "pending", dec.ok ? JSON.stringify(dec.rows[0]) : dec.err);
}
{
  for (const h of [1, 2, 4, 8, 12, 24, 48]) {
    const ok = await post(POSTER, { offered_to_helper_id: `'${HELPR}'`, direct_offer_status: "'pending'", direct_offer_expires_at: `now() + interval '${h} hours'` });
    check(`L1 the app's ${h}h window lands unchanged`, ok.ok && ok.rows[0].s === "pending" && near(ok.rows[0].secs, h * H), ok.ok ? JSON.stringify(ok.rows[0]) : ok.err);
  }
  const plain = await post(POSTER, {});
  check("L2 a plain post (no offer) still lands with no markers", plain.ok && plain.rows[0].s === null && plain.rows[0].secs === null, plain.ok ? JSON.stringify(plain.rows[0]) : plain.err);
  const svc = await post("service", { offered_to_helper_id: `'${HELPR}'`, direct_offer_status: "'expired'", direct_offer_expires_at: "now() - interval '1 hour'" });
  check("L3 a server insert keeps the markers it sets", svc.ok && svc.rows[0].s === "expired" && near(svc.rows[0].secs, -1 * H), svc.ok ? JSON.stringify(svc.rows[0]) : svc.err);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
