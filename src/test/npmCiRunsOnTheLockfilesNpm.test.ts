/**
 * EVERY WORKFLOW THAT RUNS `npm ci` RUNS IT ON NODE 24 OR LATER (npm 11) (Q1816, feature-switch-audience #4202).
 *
 * THE BUG: package-lock.json is written by npm 11 (Node 24: Vercel builds with "24.x", sentry-release.yml and local
 * machines use it). Since a99708fe73 (11-05) package.json carries nested overrides (fflate 0.8.3 under satori and
 * @shuding/opentype.js, a security fix). npm 10 (Node 22) does not read those overrides when it checks the lock, so
 * `npm ci` on Node 22 stops before installing: "Missing: fflate@0.7.5 from lock file" (EUSAGE). Measured 11-07:
 * `npx npm@10.9.4 ci --legacy-peer-deps --ignore-scripts --dry-run` on main's package files fails exactly so, npm
 * 11.11.0 passes; feature-switch-audience (Node 22, npm ci) has been red every night since, while sentry-release
 * (Node 24, npm ci) stayed green. Regenerating the lock with npm 10 is not the fix: it drops the override (it nests
 * fflate 0.7.5 back under @shuding/opentype.js) and the libc fields npm 11 writes.
 *
 * THE CHECK, over every workflow file (comments blanked): a file that runs `npm ci` sets every node-version it names
 * to 24 or later, and names at least one (no runner default). `npm install` (test.yml, vitest.yml) heals a lock and
 * is not checked.
 *
 * @mutate .github/workflows/feature-switch-audience.yml |           node-version: 24 |           node-version: 22
 * @mutate .github/workflows/sentry-release.yml |           node-version: "24" |           node-version: "22"
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";
import { blankHashComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../../.github/workflows");
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const code = (f: string) => blankHashComments(readFileSync(join(DIR, f), "utf8"));
const runsNpmCi = (src: string) => /(^|[\s;&|])npm ci(\s|$)/m.test(src);

describe("npm ci runs on the npm that wrote the lockfile", () => {
  it("reads every workflow (floor)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((f) => runsNpmCi(code(f))).length).toBeGreaterThan(2);
  });

  it("each workflow that runs npm ci sets Node 24 or later everywhere", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = code(f);
      if (!runsNpmCi(src)) continue;
      const versions = [...src.matchAll(/node-version:\s*["']?([^"'\s#]+)/g)].map((m) => m[1]);
      if (versions.length === 0) bad.push(`${f}: runs npm ci with no node-version (the runner's default npm may be 10)`);
      for (const v of versions) {
        const major = Number.parseInt(v, 10);
        if (!Number.isFinite(major) || major < 24) bad.push(`${f}: node-version ${v} runs npm ci with npm 10, which refuses this lockfile`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
