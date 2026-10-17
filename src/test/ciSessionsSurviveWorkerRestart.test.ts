/**
 * A RESTARTED PLAYWRIGHT WORKER REUSES THE SESSION ITS PREDECESSOR MINTED.
 *
 * Playwright replaces the worker process after every failed test. getSession
 * (e2e/journeys/fixtures.ts) kept a CI-minted session only in memory, so each
 * failure cost one more metered sign-in (POST /auth/v1/verify) per role the
 * next spec needed: prod-audit 38689259675 (2026-10-15) failed 14 + 4 tests on
 * one worker per leg and counted 38 sign-ins against its budget of 0.
 *
 * Rules:
 *  1. The CI branch (envCreds) reads the disk cache, checked live and for
 *     THIS account's address, BEFORE minting, and writes it after.
 *  2. The cache lives under node_modules/.cache (mode 0600), and no workflow
 *     uploads or caches node_modules: a session never becomes an artifact.
 *
 * @mutate e2e/journeys/fixtures.ts |     writeCache(cacheFile, session);\n  } else { |   } else {
 * @mutate e2e/journeys/fixtures.ts |     if (disk && disk.user?.email?.toLowerCase() === creds.email.toLowerCase()) { |     if (false) {
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SRC = blankComments(readFileSync(join(ROOT, "e2e/journeys/fixtures.ts"), "utf8"));

describe("CI sessions survive a worker restart without a new sign-in", () => {
  const start = SRC.indexOf("export async function getSession(");
  const body = SRC.slice(start, SRC.indexOf("\n}\n", start));
  const ci = body.slice(body.indexOf("if (creds) {"), body.indexOf("} else {", body.indexOf("if (creds) {")));

  it("the CI branch reuses a live cached session for the same address before minting, and caches what it mints", () => {
    expect(start).toBeGreaterThan(0);
    const read = ci.indexOf("await readLiveCache<Session>(cacheFile");
    const reuse = ci.search(/if \(disk && disk\.user\?\.email\?\.toLowerCase\(\) === creds\.email\.toLowerCase\(\)\) \{\s*sessionCache\.set\(role, disk\);\s*return disk;/);
    const mint = ci.indexOf("mintAdminSession(");
    const write = ci.indexOf("writeCache(cacheFile, session);");
    expect(read, "reads the disk cache").toBeGreaterThan(0);
    expect(reuse, "reuses it only for this account").toBeGreaterThan(read);
    expect(mint, "mints only after").toBeGreaterThan(reuse);
    expect(write, "caches the minted session").toBeGreaterThan(mint);
    expect(ci, "fresh=true always mints").toMatch(/const disk = fresh \? null : await readLiveCache/);
  });

  it("the cache is never an artifact: it lives under node_modules, 0600, and no workflow uploads or caches node_modules", () => {
    expect(SRC).toMatch(/return join\(REPO_ROOT, "node_modules", "\.cache", "lh-journeys", `\$\{role\}\.json`\);/);
    expect(readFileSync(join(ROOT, "e2e/liveSession.ts"), "utf8")).toMatch(/writeFileSync\(file, JSON\.stringify\(session\), \{ mode: 0o600 \}\)/);
    const dir = join(ROOT, ".github/workflows");
    const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));
    expect(files.length).toBeGreaterThan(20);
    const leaks = files.filter((f) => {
      const y = readFileSync(join(dir, f), "utf8");
      return /uses: actions\/(upload-artifact|cache)@[\s\S]{0,400}?path:[^\n]*(\n\s+[^\n:]+)*node_modules/.test(y);
    });
    expect(leaks).toEqual([]);
  });
});
