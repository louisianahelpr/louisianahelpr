// Probe: the two offer-expiry sweeps at their time boundaries, in real Postgres.
//
//   expire_unanswered_offers()     — accepted offer, helper never confirmed,
//                                    response_deadline < now()
//   expire_pending_direct_offers() — direct offer, direct_offer_expires_at < now()
//
// Both are called hourly by auto-expire-jobs ('0 * * * *'). NOT a vitest test:
// pglite is deliberately not a dependency (CLAUDE.md), so run by hand:
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/offer-expiry.probe.mjs
//
// Function bodies are read VERBATIM from the latest migration defining each.
// PGlite cannot move now(), so rows are placed relative to it instead, and each
// call is its own transaction (now() is the transaction start).
//
// EXPECTED TO FAIL TODAY on one assertion — the defect filed in docs/OPEN.md
// ("Audit gaps"): expire_pending_direct_offers notifies only offers that expired
// in the last 5 minutes, so on an hourly schedule most posters are never told.
// Set DIRECT_MIG to a fixed copy of the function to see it go green.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const mig = (f) => new URL(`../../supabase/migrations/${f}`, import.meta.url).pathname;
const UNANSWERED = process.env.UNANSWERED_MIG ?? mig("20260824243000_reliability_ladder_temp_ban_and_cancel_booking.sql");
const DIRECT = process.env.DIRECT_MIG ?? mig("20260423025644_8e120f3a-2254-48db-8dad-fc1e91830df3.sql");

const grab = (file, startRe, endRe) => {
  const sql = readFileSync(file, "utf8");
  const i = sql.search(startRe);
  if (i < 0) throw new Error(`not found in ${file}: ${startRe}`);
  const m = endRe.exec(sql.slice(i));
  if (!m) throw new Error(`end not found for ${startRe}`);
  return sql.slice(i, i + m.index + m[0].length);
};

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

await db.exec(`
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text, customer_id uuid, helper_id uuid, status text,
    response_deadline timestamptz, helper_confirmed_at timestamptz,
    direct_offer_status text, direct_offer_expires_at timestamptz,
    offered_to_helper_id uuid
  );
  CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text);
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text, message text, type text, link text);
  CREATE TABLE public.probe_denials (helper_id uuid, job_id uuid);
  CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_reason text)
    RETURNS jsonb LANGUAGE sql AS $$ INSERT INTO public.probe_denials VALUES (p_helper, p_job) RETURNING '{}'::jsonb $$;
`);
await db.exec(grab(UNANSWERED, /CREATE OR REPLACE FUNCTION public\.expire_unanswered_offers\(\)/, /\$function\$;/));
await db.exec(grab(DIRECT, /CREATE OR REPLACE FUNCTION public\.expire_pending_direct_offers\(\)/, /\n\$\$;/));
ok("both functions loaded verbatim from their latest migrations", true);

const P = "00000000-0000-4000-8000-0000000000a1";
const Hp = "00000000-0000-4000-8000-0000000000b2";
const q = async (sql) => (await db.query(sql)).rows;
const one = async (sql) => Object.values((await q(sql))[0])[0];

// ── expire_unanswered_offers ────────────────────────────────────────────────
async function unanswered(label, deadlineSql, confirmed = false) {
  await db.exec(`TRUNCATE jobs, applications, notifications, probe_denials`);
  const [{ id }] = await q(`INSERT INTO jobs (title, customer_id, helper_id, status, response_deadline, helper_confirmed_at)
    VALUES ('${label}', '${P}', '${Hp}', 'accepted', ${deadlineSql}, ${confirmed ? "now()" : "NULL"}) RETURNING id`);
  await db.exec(`INSERT INTO applications (job_id, helper_id, status) VALUES ('${id}', '${Hp}', 'accepted')`);
  const n = await one(`SELECT public.expire_unanswered_offers()`);
  const job = (await q(`SELECT status, helper_id, response_deadline FROM jobs WHERE id='${id}'`))[0];
  return { n, job, app: await one(`SELECT status FROM applications WHERE job_id='${id}'`),
    denials: Number(await one(`SELECT count(*) FROM probe_denials`)),
    notes: Number(await one(`SELECT count(*) FROM notifications`)) };
}

let r = await unanswered("future", "now() + interval '1 second'");
ok("unanswered: deadline 1s ahead → untouched", r.n === 0 && r.job.status === "accepted" && r.denials === 0);
r = await unanswered("past", "now() - interval '1 millisecond'");
ok("unanswered: deadline 1ms past → reopened, app rejected, strike, both told",
  r.n === 1 && r.job.status === "open" && r.job.helper_id === null && r.job.response_deadline === null &&
  r.app === "rejected" && r.denials === 1 && r.notes === 2, JSON.stringify(r));
r = await unanswered("hourAgo", "now() - interval '59 minutes'");
ok("unanswered: deadline 59 min past (hourly cron lag) → still expired", r.n === 1);
r = await unanswered("confirmed", "now() - interval '1 hour'", true);
ok("unanswered: helper already confirmed → never expired", r.n === 0 && r.job.status === "accepted");
r = await unanswered("second-run", "now() - interval '1 hour'");
const again = await one(`SELECT public.expire_unanswered_offers()`);
ok("unanswered: second run is a no-op (no double strike)", again === 0 && Number(await one(`SELECT count(*) FROM probe_denials`)) === 1);

// ── expire_pending_direct_offers ───────────────────────────────────────────
async function direct(expiresSql) {
  await db.exec(`TRUNCATE jobs, notifications`);
  await db.exec(`INSERT INTO jobs (title, customer_id, status, direct_offer_status, direct_offer_expires_at, offered_to_helper_id)
    VALUES ('Gutter clean', '${P}', 'open', 'pending', ${expiresSql}, '${Hp}')`);
  const n = await one(`SELECT public.expire_pending_direct_offers()`);
  return { n, status: await one(`SELECT direct_offer_status FROM jobs`),
    notes: Number(await one(`SELECT count(*) FROM notifications WHERE title='Direct offer expired'`)) };
}

let d = await direct("now() + interval '1 second'");
ok("direct: expiry 1s ahead → still pending, no notification", d.n === 0 && d.status === "pending" && d.notes === 0);
d = await direct("now() - interval '1 millisecond'");
ok("direct: expiry 1ms past → expired and poster told", d.n === 1 && d.status === "expired" && d.notes === 1, JSON.stringify(d));
d = await direct("now() - interval '19 minutes'");
ok("direct: expired 19 min before the hourly run → expired AND poster told", d.n === 1 && d.status === "expired" && d.notes === 1,
  `(DEFECT: notifications=${d.notes}; the notify scan only looks back 5 minutes)`);
const d2 = await one(`SELECT public.expire_pending_direct_offers()`);
ok("direct: second run is a no-op", d2 === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
