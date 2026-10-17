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
 * @mutate .github/workflows/prod-audit.yml | path: test-results/messy-input-prod/credits/ | path: node_modules/.cache/lh-journeys/
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
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
      return pathBlocksAfterUses(y).some((block) => block.includes("node_modules"));
    });
    expect(leaks).toEqual([]);
  });
});

/**
 * Each upload-artifact / cache step's `path:` value: the rest of its line plus
 * the indented, colon-free lines under it. Read line by line, not with one
 * backtracking regex (CodeQL js/redos flagged `(\n\s+[^\n:]+)*` on PR #3295).
 */
function pathBlocksAfterUses(yaml: string): string[] {
  const blocks: string[] = [];
  const uses = /uses: actions\/(?:upload-artifact|cache)@/g;
  for (let m = uses.exec(yaml); m; m = uses.exec(yaml)) {
    const at = yaml.slice(m.index, m.index + 400).indexOf("path:");
    if (at < 0) continue;
    const lines = yaml.slice(m.index + at + "path:".length).split("\n");
    const block = [lines[0]];
    for (const line of lines.slice(1)) {
      if (!/^[ \t]/.test(line) || line.includes(":")) break;
      block.push(line);
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}
