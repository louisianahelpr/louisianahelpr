#!/usr/bin/env node
/**
 * Fail if any internal link points at a path no route serves.
 *
 * WHY THIS EXISTS
 * Deleting a route is the easy half. On 2026-09-02 seven routes became Profile
 * tabs and one was removed outright, and the leftovers were not in the pages —
 * they were in a Stripe `success_url` (a 404 at the end of a COMPLETED
 * purchase), two notification `link:` fields, and a screenshot script that
 * would have captured the 404 page under seven names reading like real screens.
 * None of those is visible from the route table and none breaks a build.
 *
 * THE SELF-TEST IS NOT DECORATION
 * A throwaway version of this check reported 13 dead links, then 28 — every one
 * a bug in the checker, which treated `/messages?jobId=${id}` as a path called
 * "/messages?jobId=". A checker nobody has proven is not evidence. This one
 * resolves a known-good and known-bad set first and refuses to report link
 * results at all if it gets any of them wrong.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const app = readFileSync("src/App.tsx", "utf8");
const routes = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
const statics = new Set(routes.filter((r) => !r.includes(":") && r !== "*"));
const params = routes
  .filter((r) => r.includes(":") || r.endsWith("/*"))
  .map((r) => new RegExp("^" + r.replace(/:[A-Za-z0-9_]+/g, "[^/]+").replace(/\/\*$/, "(/.*)?") + "$"));
const resolves = (p) => statics.has(p) || params.some((re) => re.test(p));

const SELF_TEST = [
  ["/dashboard", true], ["/profile", true], ["/jobs/abc-123", true], ["/user/xyz", true],
  ["/pets", false], ["/wrapped", false], ["/definitely-not-a-route", false],
];
const selfFails = SELF_TEST.filter(([p, want]) => resolves(p) !== want);
if (selfFails.length) {
  console.error("✖ check-dead-links: the resolver is wrong — refusing to report link results.");
  for (const [p, want] of selfFails) console.error(`    ${p}: expected ${want}, got ${!want}`);
  process.exit(1);
}

const files = execSync("git ls-files src supabase", { encoding: "utf8" }).trim().split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

const PATTERNS = [
  /\bto=["'`](\/[^"'`\s>]*)["'`]/g,
  /\bnavigate\(\s*["'`](\/[^"'`\s)]*)["'`]/g,
  /\bhref=["'`](\/[^"'`\s>]*)["'`]/g,
  /\blink:\s*["'`](\/[^"'`\s,}]*)["'`]/g,
];

const bad = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8").replace(/\/\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const re of PATTERNS) {
    for (const m of src.matchAll(re)) {
      // PATH ONLY, stripped FIRST. The query is not part of routing:
      // `/messages?jobId=${id}` is the /messages route carrying a param.
      const p = m[1].split("?")[0].split("#")[0];
      if (!p || p === "/") continue;
      // A template literal still has a checkable static prefix: `/user/${id}`
      // asks whether any route serves /user/<something>.
      if (p.includes("${")) {
        const prefix = p.slice(0, p.indexOf("${")).replace(/\/+$/, "");
        if (!prefix || statics.has(prefix) || routes.some((r) => r.startsWith(prefix + "/"))) continue;
        const key = `${prefix}/\${…}`;
        if (!bad.has(key)) bad.set(key, []);
        bad.get(key).push(f);
        continue;
      }
      if (resolves(p)) continue;
      if (!bad.has(p)) bad.set(p, []);
      bad.get(p).push(f);
    }
  }
}

if (!bad.size) {
  console.log(`✔ dead links: none — ${files.length} files, every internal link resolves (self-test ${SELF_TEST.length}/${SELF_TEST.length})`);
  process.exit(0);
}
console.error(`\n✖ ${bad.size} link target(s) render the 404 screen:\n`);
for (const [p, fs_] of [...bad].sort()) console.error(`    ${p.padEnd(30)} ${[...new Set(fs_)].slice(0, 3).join(", ")}`);
console.error("\n  A link to a deleted route does not fail a build. It fails a person.\n");
process.exit(1);
