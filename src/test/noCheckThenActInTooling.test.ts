/*
 * CLASS GUARD (code scanning, js/file-system-race, 2026-10-05): developer tooling
 * and tests never check a path and then create, write or delete the same path.
 *
 * `if (!existsSync(p)) writeFileSync(p, ...)` leaves a window between the check
 * and the write in which another process can create (or symlink) `p`. The
 * atomic forms close it: `writeFileSync(p, data, { flag: "wx" })` (exclusive
 * create, EEXIST is the "already there" answer), `rmSync(p, { force: true })`,
 * `rmSync(p, { recursive: true })` (ENOENT is the "nothing to remove" answer),
 * or read-and-catch ENOENT instead of exists-then-read.
 *
 * Rule, measured over every git-tracked scripts/, e2e/ and src test source with
 * comments blanked (helpers/blankNonCode.ts): no `existsSync(X)`,
 * `accessSync(X)` or `statSync(X).isDirectory()/isFile()` is followed, within
 * WINDOW lines, by a write/append/unlink/rm/mkdir/copy/rename/createWriteStream
 * call on the same X. Exact floor 0.
 *
 * NOT covered, on purpose: exists-then-READ (143 sites on 2026-10-05, 78 in
 * scripts/) and `statSync(p).isDirectory()` in a read-only directory walk. CodeQL
 * flags neither shape we could reproduce, they cannot clobber anything, and a
 * guard for them would be a wall of churn. Only a mutation of a checked path is
 * the race this rule is about.
 *
 * Floors: MIN_FILES scanned and MIN_CHECKS check calls seen, so a scan that
 * silently lists nothing cannot pass. Shown able to fail: each @mutate puts
 * back a check-then-mutate shape this commit removed.
 */
// @mutate scripts/new-repro.mjs | writeFileSync(out, specBody, { flag: "wx" }); | if (!existsSync(out)) writeFileSync(out, specBody);
// @mutate scripts/clear-xcode-cache.mjs | fs.rmSync(targetPath, { recursive: true }); | if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true });
// @mutate e2e/liveSession.ts | writeFileSync(file, JSON.stringify(session), { mode: 0o600 }); | if (!existsSync(file)) writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");
const SRC_RE = /\.(mjs|cjs|js|ts|tsx)$/;
const WINDOW = 12; // lines after a check in which a mutation of the same path counts

const MIN_FILES = 1000; // 1937 measured on 2026-10-05; a floor, adding a file is normal
const MIN_CHECKS = 100; // 200+ existsSync/accessSync/statSync checks measured; a floor so an empty scan cannot pass

const CHECK = /\b(?:fs\.)?(?:(existsSync|accessSync)\(\s*([A-Za-z_$][\w$.]*)\s*[,)]|statSync\(\s*([A-Za-z_$][\w$.]*)\s*\)\s*\.\s*(?:isDirectory|isFile)\(\))/g;
const MUTATORS = "writeFileSync|appendFileSync|unlinkSync|rmSync|rmdirSync|mkdirSync|copyFileSync|renameSync|createWriteStream";

function mutates(x: string): RegExp {
  return new RegExp(`\\b(?:fs\\.)?(?:${MUTATORS})\\(\\s*${x.replace(/[.$()]/g, "\\$&")}\\s*[,)]`);
}

function trackedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "scripts", "e2e", "src"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((f) => f && SRC_RE.test(f) && (/^(scripts|e2e)\//.test(f) || /\.test\.|\/test\//.test(f)));
}

function scan(read: (f: string) => string) {
  const res = { files: 0, checks: 0, hits: [] as string[] };
  for (const f of trackedSources()) {
    let raw: string;
    try {
      raw = read(f);
    } catch {
      continue; // deleted in the working tree but still indexed
    }
    res.files += 1;
    const lines = blankComments(raw).split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(CHECK)) {
        res.checks += 1;
        const x = m[2] ?? m[3];
        const window = lines.slice(i, i + WINDOW).join("\n");
        if (mutates(x).test(window)) res.hits.push(`${f}:${i + 1}: ${m[0].trim()} then a mutation of ${x}`);
      }
    });
  }
  return res;
}

describe("tooling never checks a path and then mutates the same path", () => {
  const result = scan((f) => readFileSync(resolve(REPO, f), "utf8"));

  it("no existsSync/statSync check is followed by a write, rm, mkdir or rename of the same path", () => {
    expect(
      result.hits,
      "check-then-act leaves a race window. Use writeFileSync(p, data, { flag: \"wx\" }), rmSync(p, { force: true }), or try the operation and handle ENOENT/EEXIST.",
    ).toEqual([]);
  });

  it("the scan looks at real files and real checks (floors)", () => {
    expect(trackedSources().length, "tracked sources listed").toBeGreaterThan(MIN_FILES);
    expect(result.files, "tracked sources scanned").toBeGreaterThanOrEqual(MIN_FILES);
    expect(result.checks, "existsSync/accessSync/statSync checks seen").toBeGreaterThanOrEqual(MIN_CHECKS);
  });
});
