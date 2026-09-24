#!/usr/bin/env node
/**
 * Does every SEEDED job on prod carry an address a driver could actually
 * follow — or just a town?
 *
 * WHY IT EXISTS (owner, 2026-09-19)
 * ---------------------------------
 *   "When i click directions, it gives directions to the town but not the
 *    actual address."
 *
 * Nothing in the app was broken. `DirectionsButton` hands `job.location` to
 * `mapsSearchUrl()`; the post-a-job form writes
 * `"<street>, <city>, <state> <zip>"` (src/pages/post-job/jobSubmitHelpers.ts);
 * `user_may_see_job_address` had already released the full column to the
 * viewer, and `JobAddressLine` prints it on the card. The row the owner tapped
 * simply had no street in it. On 2026-09-19, live:
 *
 *     is_seed = false : 3 jobs,   0 with a street address, 3 with coordinates
 *     is_seed = true  : 257 jobs, 47 with a street address, 160 with coordinates
 *
 * 210 seeded jobs said "Lafayette, LA" / "Baton Rouge, LA" / "New Orleans, LA"
 * and nothing more, because that is what every seed generator wrote. That is
 * the THIRD bug report in one day manufactured by a fixture that does not look
 * like real data (the others: a contested job with no `job_tracking` row read
 * as "the map is gone"; an `in_progress` job with no confirmation stamps read
 * as a tracker bug).
 *
 * THE GENERATORS ARE FIXED FIRST, and a CI guard holds that line without
 * touching the network — `src/test/seedFixtureAddressRealism.test.ts` scans
 * every seed generator's own source. This script is the RUNTIME half: it
 * reports, and on `--fix` repairs, the rows those generators already wrote.
 *
 * Usage:
 *   node scripts/probes/seed-job-address-realism.prod.mjs          # report only
 *   node scripts/probes/seed-job-address-realism.prod.mjs --fix    # backfill
 *
 * Exit 1 when a seeded job still holds a town. `--fix` re-reads afterwards and
 * exits on the post-state, so a green run is a measurement, not a claim.
 *
 * SAFETY. Every read and every write is filtered `is_seed=eq.true`; the PATCH
 * additionally names one job id at a time. A non-seed row is never selected, so
 * it can never be written. There are three of them on prod and they are real
 * people's jobs.
 *
 * It cannot be a credential-free CI step the way
 * `scripts/ci/guest-listing-horizon.mjs` is: the anon `open_jobs_browse` view
 * runs `mask_job_location()` over the column, so the street part is exactly
 * what a guest may not see. Checking it requires the service role, which is why
 * the CI gate is the source-level guard and this is the operator's tool.
 */
import { rest } from "./lib/prodEnv.mjs";
// The catalogue and the predicate live in a dependency-free module so the CI
// guard (src/test/seedFixtureAddressRealism.test.ts) can import them; this file
// is the same knowledge plus the network.
import { ADDRESSES, hasStreetAddress, cityKey } from "./lib/seedAddresses.mjs";

const FIX = process.argv.includes("--fix");

async function main() {
  const jobs = await rest("jobs?is_seed=eq.true&select=id,location,latitude,longitude,status&order=created_at.asc");
  const bad = jobs.filter((j) => !hasStreetAddress(j.location));
  console.log(`seeded jobs: ${jobs.length} · with a street address: ${jobs.length - bad.length} · town only: ${bad.length}`);

  if (bad.length) {
    const byCity = new Map();
    for (const j of bad) {
      const k = cityKey(j.location) ?? `(unparseable: ${j.location})`;
      byCity.set(k, (byCity.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...byCity].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  }

  if (!FIX) {
    if (bad.length) console.log("\nrun with --fix to backfill");
    process.exit(bad.length ? 1 : 0);
  }

  const unmapped = [];
  const counters = new Map();
  let patched = 0;
  for (const j of bad) {
    const key = cityKey(j.location);
    const options = key && ADDRESSES[key];
    if (!options) { unmapped.push(j); continue; }
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    const [address, lat, lng] = options[n % options.length];
    // Coordinates move WITH the address so the map pin and the printed line
    // name the same doorstep. Only for rows that already had a point: a seed
    // with no coordinates is a deliberate shape (several trackers are exercised
    // without one) and inventing a point would change what those fixtures test.
    const patch = j.latitude === null || j.longitude === null
      ? { location: address }
      : { location: address, latitude: lat, longitude: lng };
    await rest(`jobs?id=eq.${j.id}&is_seed=eq.true`, { method: "PATCH", body: patch, prefer: "return=minimal" });
    patched++;
  }
  console.log(`\npatched ${patched} row(s)`);
  if (unmapped.length) {
    console.log(`NO ADDRESS CATALOGUE for ${unmapped.length} row(s) — add the city to ADDRESSES:`);
    for (const j of unmapped.slice(0, 20)) console.log(`  ${j.id}  ${JSON.stringify(j.location)}`);
  }

  // Re-read. The exit code is the POST state, never the intent.
  const after = await rest("jobs?is_seed=eq.true&select=id,location");
  const stillBad = after.filter((j) => !hasStreetAddress(j.location));
  console.log(`after: ${after.length} seeded jobs · ${after.length - stillBad.length} with a street address · ${stillBad.length} town only`);
  process.exit(stillBad.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
