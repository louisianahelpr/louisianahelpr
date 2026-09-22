#!/usr/bin/env node
/**
 * Post-deploy verification for .github/workflows/functions-deploy.yml.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CATCHES: a deploy the CLI reports as successful that the platform
 * silently discarded.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Measured on 2026-09-22. Run 35756822730 was a deploy-all. For every one of
 * the 73 functions the Supabase CLI printed
 *
 *     Deploying Function: create-pro-checkout (script size: 839 kB)
 *     Deployed Functions on project ***: create-pro-checkout
 *
 * and exited 0, so the workflow's `if supabase functions deploy …; then` branch
 * took the success path and the run was green. EIGHT of those uploads never
 * reached prod. `create-pro-checkout` was still serving the build from
 * 2026-09-07 (version 87), and `claim-gift-card` was still serving the build
 * from 2026-09-13 (version 3) — the latter WITHOUT the `payment_status` funding
 * gate landed that morning in 61fe256d2, so a refunded or charged-back gift
 * card remained claimable in production while main was green.
 *
 * A second, single-function run (35757178581, commit 073a680cb) re-uploaded
 * create-pro-checkout at 16:55:12Z, printed the same success lines, and was
 * also discarded. Two green runs, nothing deployed, no error anywhere.
 *
 * The workflow trusted the CLI's EXIT CODE. An exit code is a statement about
 * the client; it is not a statement about prod. This module asserts the
 * OUTCOME instead: for every function the CLI actually uploaded, the stored
 * artifact on the project must have changed.
 *
 * ── WHY `ezbr_sha256` AND NOT `version` ────────────────────────────────────
 *
 * `version` is not a deploy counter on this project. Measured 2026-09-22:
 * `health-check` moved 1305 -> 1307 and `money-reconciliation` 986 -> 988
 * inside nine minutes with no deploy of any kind, both landing on the same
 * `updated_at` to the millisecond. Roughly forty functions — the ones whose
 * `entrypoint_path` the platform has rewritten to `/app/…` — are re-stamped
 * like this continuously, which is how `create-payment` reached version 2191.
 * A guard keyed on `version` would read that churn as a successful deploy.
 *
 * `ezbr_sha256` is the stored bundle hash. It is also churned for that same
 * population (health-check's moved 823bd331… -> 7fc09e19… over those nine
 * minutes), so this check is WEAKER there than it is for the rest — it can
 * miss a lost deploy on a churning function. It can never do the opposite:
 * a hash that did NOT move is proof the upload did not land. That asymmetry is
 * the point. It catches the eight real losses above with certainty, and it
 * cannot invent one.
 *
 * ── WHY THE "No change found" FUNCTIONS ARE EXEMPT ─────────────────────────
 *
 * The CLI dedupes: when the bundle it just built already matches what the
 * project stores, it prints `No change found in Function: <slug>` and uploads
 * nothing. Nine functions took that path in run 35756822730 and are correctly
 * up to date. Asserting a hash change on those would fail every run forever.
 * So the inventory this verifies is not "the functions we targeted" — it is
 * "the functions the CLI says it UPLOADED", read back out of the CLI's own
 * output. Anything targeted that the CLI neither uploaded nor explicitly
 * skipped is itself a failure: it means the deploy log stopped saying what
 * happened, and an inventory we can no longer derive is not an inventory.
 *
 * Usage (CI):
 *   node scripts/verify-functions-deployed.mjs \
 *       --before before.json --after after.json --log deploy.log \
 *       --targets "fn-a fn-b fn-c"
 *
 * `before.json` / `after.json` are the raw body of
 * `GET https://api.supabase.com/v1/projects/<ref>/functions`.
 */

import fs from "node:fs";

/** Slugs the CLI said it uploaded a new bundle for. */
export function uploadedFunctions(deployLog) {
  const slugs = new Set();
  for (const m of deployLog.matchAll(/Deploying Function:\s*([a-z0-9][a-z0-9-]*)/g)) {
    slugs.add(m[1]);
  }
  return slugs;
}

/** Slugs the CLI deduped — it built a bundle identical to the stored one. */
export function dedupedFunctions(deployLog) {
  const slugs = new Set();
  for (const m of deployLog.matchAll(/No change found in Function:\s*([a-z0-9][a-z0-9-]*)/g)) {
    slugs.add(m[1]);
  }
  return slugs;
}

/** slug -> ezbr_sha256, from a Management API functions listing. */
export function hashesBySlug(listing) {
  const functions = Array.isArray(listing) ? listing : (listing?.functions ?? []);
  const out = new Map();
  for (const fn of functions) {
    if (fn?.slug) out.set(fn.slug, fn.ezbr_sha256 ?? null);
  }
  return out;
}

/**
 * The whole judgement, kept pure so a test can drive it.
 *
 * @returns {{ok: boolean, lost: string[], unaccounted: string[], verified: string[], deduped: string[]}}
 */
export function verifyDeploys({ before, after, deployLog, targets }) {
  const uploaded = uploadedFunctions(deployLog);
  const deduped = dedupedFunctions(deployLog);
  const beforeHashes = hashesBySlug(before);
  const afterHashes = hashesBySlug(after);

  const lost = [];
  const verified = [];
  for (const slug of uploaded) {
    const b = beforeHashes.get(slug);
    const a = afterHashes.get(slug);
    // A function that did not exist before and exists now is a first deploy:
    // there is no prior hash to differ from, and its presence IS the evidence.
    if (b === undefined && a !== undefined) {
      verified.push(slug);
      continue;
    }
    // Gone, or never arrived at all. Either way the upload is not live.
    if (a === undefined || a === null) {
      lost.push(slug);
      continue;
    }
    if (a === b) lost.push(slug);
    else verified.push(slug);
  }

  // Every function we aimed at must be accounted for by the CLI's own output.
  // Silence about a target is the failure shape this whole module exists for.
  const unaccounted = (targets ?? []).filter(
    (slug) => !uploaded.has(slug) && !deduped.has(slug),
  );

  return {
    ok: lost.length === 0 && unaccounted.length === 0,
    lost: lost.sort(),
    unaccounted: unaccounted.sort(),
    verified: verified.sort(),
    deduped: [...deduped].sort(),
  };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const beforePath = arg("before");
  const afterPath = arg("after");
  const logPath = arg("log");
  if (!beforePath || !afterPath || !logPath) {
    console.error(
      "::error::verify-functions-deployed needs --before, --after and --log. " +
        "Refusing to report success without the evidence it exists to check.",
    );
    process.exit(2);
  }

  const read = (p, what) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch (e) {
      console.error(`::error::Could not read ${what} (${p}): ${e.message}`);
      console.error(
        "::error::This step cannot verify the deploy, so it fails rather than passing. " +
          "A verification that silently skips is the exact failure shape it was added to close.",
      );
      process.exit(2);
    }
  };

  const before = JSON.parse(read(beforePath, "the pre-deploy snapshot"));
  const after = JSON.parse(read(afterPath, "the post-deploy snapshot"));
  const deployLog = read(logPath, "the deploy log");
  const targets = (arg("targets") ?? "").split(/\s+/).filter(Boolean);

  const result = verifyDeploys({ before, after, deployLog, targets });

  for (const slug of result.deduped) {
    console.log(`· ${slug} — unchanged bundle, CLI skipped upload (nothing to verify)`);
  }
  for (const slug of result.verified) {
    console.log(`✓ ${slug} — stored bundle advanced`);
  }

  if (result.ok) {
    console.log(
      `\n✓ All ${result.verified.length} uploaded function(s) actually landed on the project.`,
    );
    return;
  }

  for (const slug of result.lost) {
    console.error(
      `::error::${slug} — the CLI reported a successful deploy, but the project's stored ` +
        `bundle hash did not change. The upload was accepted and discarded: prod is still ` +
        `running the PREVIOUS build of this function.`,
    );
  }
  for (const slug of result.unaccounted) {
    console.error(
      `::error::${slug} — targeted for deploy, but the CLI output says neither that it was ` +
        `uploaded nor that it was skipped. We cannot tell what happened to it.`,
    );
  }
  console.error(
    "\n::error::functions-deploy is failing because one or more deploys did not reach prod. " +
      "The CLI exiting 0 is a statement about the client, not about production. " +
      "Re-run this workflow; if a function keeps failing here, prod is serving stale code for it.",
  );
  process.exit(1);
}

// Only run the CLI when invoked directly, so the test can import the pure part.
if (process.argv[1] && process.argv[1].endsWith("verify-functions-deployed.mjs")) {
  main();
}
