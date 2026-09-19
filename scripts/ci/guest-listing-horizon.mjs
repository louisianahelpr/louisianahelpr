#!/usr/bin/env node
/**
 * Will the guest marketplace still have listings TOMORROW?
 *
 * STRICTLY READ-ONLY. One GET against the anon `open_jobs_browse` view. No
 * credentials: the publishable key already ships in every browser bundle, the
 * same property `scripts/e2e/anon-surface-contract.mjs` protects — a check that
 * needs a secret is a check that will sit skipped.
 *
 * WHY IT EXISTS
 * -------------
 * On 2026-09-16 the signed-out marketplace went dark and `E2E real backend`
 * stayed red for three days. No commit caused it: the last GREEN run
 * (35052333685, 03:34) and the first RED one (35115323180, 15:26) were the SAME
 * SHA, 12fcd8541. What happened in between was the clock.
 *
 * Every open, funded listing on prod was a hand-seeded fixture carrying a FIXED
 * `date_needed`. `auto-expire-jobs` (cron jobid 16, hourly at :00) cancels an
 * open job once its scheduled date has passed — correctly; that is the product
 * rule. The fixtures aged out two at a time: 09-14 18:00, 09-15 05:00, and at
 * 2026-09-16 05:00:00.745 the LAST TWO ("Deep clean before showing", "Costco
 * run and unload", both `date_needed` 2026-09-15) were cancelled with
 * "Job listing expired — scheduled time passed with no Helpr assigned".
 * Eighty-six minutes earlier the suite had been green.
 *
 * The anon contract check did its job perfectly — it went red on the very first
 * run after the marketplace emptied. The problem is that "browse is empty" is
 * only ever knowable AFTER guests are already looking at nothing. This check is
 * the other half: it reads the listings' own expiry data and says how many days
 * of marketplace are LEFT, so the supply is refilled before it runs out rather
 * than after.
 *
 * NOTHING IS HAND-LISTED. The listings come from prod's own browse view, and
 * the expiry rule is transcribed from `supabase/functions/auto-expire-jobs`
 * step 2, which is the only thing that retires them:
 *
 *     open AND expires_at IS NOT NULL AND expires_at < now        -> cancelled
 *     open AND expires_at IS NULL     AND date_needed < today(CT) -> cancelled
 *
 * `date_needed` is a bare DATE that only means anything in Louisiana's zone, so
 * "today" is computed in America/Chicago here exactly as it is there — the UTC
 * date is already TOMORROW between 19:00 and midnight Central, which would make
 * this check declare a day of runway that does not exist.
 *
 * Usage:
 *   node scripts/ci/guest-listing-horizon.mjs
 *   HORIZON_DAYS=5 node scripts/ci/guest-listing-horizon.mjs
 */

const BASE = (process.env.SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
const KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";

/**
 * How much warning we want. Three days spans a weekend, which is the gap the
 * 2026-09-16 outage fell into: it went dark on a Wednesday morning and the next
 * scheduled run was Friday.
 */
const HORIZON_DAYS = Number(process.env.HORIZON_DAYS || 3);

/** Louisiana's civil date, N days out. Mirrors auto-expire-jobs' `today`. */
function centralDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Would auto-expire-jobs still leave this listing standing on `onDate`?
 *
 * Transcribed from step 2 of the cron, including the NULL split: a row with an
 * explicit `expires_at` is judged on that instant and its `date_needed` is not
 * consulted at all.
 */
function aliveOn(job, onDate, atMs) {
  if (job.expires_at) return Date.parse(job.expires_at) >= atMs;
  // `date_needed < today` cancels, so the listing survives while it is >= today.
  return String(job.date_needed) >= onDate;
}

const res = await fetch(
  `${BASE}/rest/v1/open_jobs_browse?select=id,title,date_needed,expires_at&order=date_needed.asc`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
);
const body = await res.text();
if (res.status !== 200) {
  console.error(`FAIL: open_jobs_browse answered anon with HTTP ${res.status}: ${body.slice(0, 300)}`);
  process.exit(1);
}

let jobs;
try {
  jobs = JSON.parse(body);
} catch {
  console.error(`FAIL: open_jobs_browse did not return JSON: ${body.slice(0, 300)}`);
  process.exit(1);
}
if (!Array.isArray(jobs)) {
  console.error(`FAIL: open_jobs_browse returned ${typeof jobs}, not an array of listings.`);
  process.exit(1);
}

console.log(`Guest listing horizon — READ-ONLY — ${BASE}`);
console.log(`Today in Louisiana: ${centralDate(0)} · horizon: ${HORIZON_DAYS} day(s)\n`);

// The runway, day by day, as auto-expire-jobs will see it.
const schedule = [];
for (let d = 0; d <= HORIZON_DAYS; d++) {
  const date = centralDate(d);
  const atMs = Date.now() + d * 86_400_000;
  const alive = jobs.filter((j) => aliveOn(j, date, atMs));
  schedule.push({ d, date, count: alive.length });
}
const width = Math.max(...schedule.map((s) => String(s.count).length));
for (const s of schedule) {
  const bar = s.count === 0 ? "  <- DARK" : "";
  console.log(`  ${s.date}  (+${s.d}d)  ${String(s.count).padStart(width)} listing(s)${bar}`);
}

console.log("\nSoonest to expire:");
for (const j of jobs.slice(0, 5)) {
  console.log(
    `  ${String(j.date_needed).padEnd(12)} ${j.expires_at ? `expires_at=${j.expires_at}` : "(no expires_at)"}  ${String(j.title).slice(0, 48)}`,
  );
}
if (!jobs.length) console.log("  (none — the marketplace is already empty)");

const today = schedule[0].count;
const atHorizon = schedule[schedule.length - 1].count;

if (today === 0) {
  console.error(
    `\nFAIL: the guest marketplace is ALREADY DARK — open_jobs_browse returns no listings to a ` +
      `signed-out visitor right now. Guests are looking at an empty marketplace.`,
  );
  process.exit(1);
}
if (atHorizon === 0) {
  const goesDark = schedule.find((s) => s.count === 0);
  console.error(
    `\nFAIL: the guest marketplace goes DARK on ${goesDark.date} (in ${goesDark.d} day(s)).\n` +
      `  ${today} listing(s) are visible today and every one of them expires by then.\n` +
      `  auto-expire-jobs cancels an open job once its scheduled date has passed, so nothing\n` +
      `  refills this on its own. Post or re-date funded listings before that date.\n` +
      `  This is the check that the 2026-09-16 three-day red did not have: back then the\n` +
      `  marketplace emptied 86 minutes after a green run and nothing said so until it was gone.`,
  );
  process.exit(1);
}

console.log(
  `\nOK: ${today} listing(s) today, ${atHorizon} still standing in ${HORIZON_DAYS} day(s).`,
);
