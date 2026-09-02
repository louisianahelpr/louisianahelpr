#!/usr/bin/env node
/**
 * Pre-commit guard for vercel.json.
 *
 * WHY THIS EXISTS
 * Vercel validates vercel.json against its own schema BEFORE the build starts,
 * and that validation happens on Vercel's side — independently of GitHub Actions.
 * So an invalid file produces a fully green Actions tab and a production deploy
 * that never ran. Production silently keeps serving the previous build.
 *
 * This file has broken production three times, always the same way — someone adds
 * a human-readable explanation as an extra key, because JSON has no comments:
 *
 *   cea0055f  "comment" inside headers[1]        -> prod stale ~30 min
 *   d3ffb269  the fix for the above
 *   e926b307  "//", "//why", "//requires", "//status" inside redirects[0]
 *
 * Every entry in redirects/headers/rewrites is additionalProperties:false, so any
 * such key is rejected outright.
 *
 * WHY IT DOES NOT FETCH THE LIVE SCHEMA
 * CI already does that, and its "cannot reach the schema = fail" stance is correct
 * there. A pre-commit hook is a different contract: one that needs the network
 * blocks your commit on a plane, and a gate people reach for --no-verify to escape
 * is worse than no gate. So this checks, offline and in milliseconds, the exact
 * structural rule that has actually broken production, and leaves authoritative
 * full-schema validation to CI. Narrow and always-runnable beats complete and
 * skipped.
 */

import { readFileSync } from "node:fs";

const FILE = "vercel.json";

// additionalProperties:false in the upstream schema — keep these in sync with
// https://openapi.vercel.sh/vercel.json if Vercel ever widens them.
const ALLOWED = {
  redirects: new Set(["source", "destination", "permanent", "statusCode", "has", "missing"]),
  headers: new Set(["source", "headers", "has", "missing"]),
  rewrites: new Set(["source", "destination", "has", "missing"]),
};

let raw;
try {
  raw = readFileSync(FILE, "utf8");
} catch (err) {
  console.error(`✖ ${FILE}: cannot read (${err.message})`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(raw);
} catch (err) {
  console.error(`✖ ${FILE} is not valid JSON: ${err.message}`);
  process.exit(1);
}

const problems = [];

for (const [section, allowed] of Object.entries(ALLOWED)) {
  const entries = config[section];
  if (entries === undefined) continue;
  if (!Array.isArray(entries)) {
    problems.push(`${section}: expected an array, got ${typeof entries}`);
    continue;
  }
  entries.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${section}/${i}: expected an object`);
      return;
    }
    const unknown = Object.keys(entry).filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
      problems.push(
        `${section}/${i}: additional properties are not allowed ` +
          `(${unknown.map((k) => `'${k}'`).join(", ")} unexpected)`,
      );
    }
  });
}

if (problems.length > 0) {
  console.error(`\n✖ ${FILE} would be REJECTED by Vercel before the build starts.\n`);
  for (const p of problems) console.error(`    at ${p}`);
  console.error(
    "\n  Vercel validates this file on its own side, so this failure does NOT show up\n" +
      "  as a red check on GitHub — the deploy just never runs and production keeps\n" +
      "  serving the previous build. This has happened three times.\n\n" +
      "  JSON has no comments and Vercel allows no stand-in key. Put the explanation\n" +
      "  in the commit message or next to the code that depends on the rule, not in\n" +
      "  this file.\n",
  );
  process.exit(1);
}

console.log(`✔ ${FILE}: no unknown keys in redirects/headers/rewrites`);
