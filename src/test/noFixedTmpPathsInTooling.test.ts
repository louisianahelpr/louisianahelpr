/*
 * CLASS GUARD (code scanning, js/insecure-temporary-file, 2026-10-05): developer
 * tooling must not write to a PREDICTABLE path in the shared OS temp directory.
 *
 * A fixed or guessable name under /tmp (a literal `/tmp/ui-review`, or
 * `join(tmpdir(), "x-" + Date.now())`) lets another local user pre-create the
 * path as a symlink or a directory they own, so the tool then writes through
 * it. CodeQL flagged 23 such sites in e2e/ and scripts/. The fix, applied in
 * the same commit: evidence and caches live under ~/.lh-shots (the repo's
 * convention for output outside the worktree), and anything that truly needs
 * the OS temp dir makes it with mkdtemp (unpredictable name, mode 0700).
 *
 * The rule, measured over every git-tracked scripts/ and e2e/ source file with
 * comments blanked (helpers/blankNonCode.ts):
 *   1. no string or template literal begins with "/tmp";
 *   2. every `tmpdir()` call has `mkdtemp` on its own line or within the next
 *      three (the base path is built on one line and handed to mkdtempSync).
 *
 * The inventory is derived from git, and has floors so a scan that silently
 * lists nothing cannot pass: MIN_FILES scanned, TMPDIR_SITES tmpdir()
 * calls seen and accepted (the guard is shown to look at real calls).
 *
 * Shown able to fail on both halves. Each mutation puts back a pattern this
 * commit removed.
 */
// @mutate scripts/state-review.mjs | resolve(homedir(), ".lh-shots", "lh-state-review") | "/tmp/lh-state-review"
// @mutate scripts/rollback/rollback.mjs | const tree = LIVE ? mkdtempSync(treeBase) : | const tree = LIVE ? join(treeBase, "x") :
// @mutate scripts/vacuity/run.mjs | const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), "vacuity-pw-")); | const jsonDir = path.join(os.tmpdir(), "vacuity-pw-" + Date.now());
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { blankComments, blankNonCode } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");
const SRC_RE = /\.(mjs|cjs|js|ts|tsx)$/;

// Measured 2026-10-05 with this test's own scan.
// Measured 2026-10-05 with this test's own scan.
const MIN_FILES = 400; // 426 measured; a floor, since adding a script is normal
const TMPDIR_SITES = 14; // EXACT: every tmpdir() call, all mkdtemp-wrapped. Lower or raise it in the commit that changes one.

function trackedTooling(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "scripts", "e2e"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((f) => f && SRC_RE.test(f));
}

interface Scan {
  files: number;
  literalTmp: string[];
  unsafeTmpdir: string[];
  tmpdirSites: number;
}

function scan(read: (f: string) => string): Scan {
  const res: Scan = { files: 0, literalTmp: [], unsafeTmpdir: [], tmpdirSites: 0 };
  for (const f of trackedTooling()) {
    let raw: string;
    try {
      raw = read(f);
    } catch {
      continue; // deleted in the working tree but still indexed
    }
    res.files += 1;
    // Literals are read from the comment-blanked text (a string body is the thing
    // looked for); calls from the code-only text (a string that merely MENTIONS
    // tmpdir() is prose, not a call).
    const withStrings = blankComments(raw).split("\n");
    const codeOnly = blankNonCode(raw).split("\n");
    withStrings.forEach((line, i) => {
      if (/["'`]\/tmp(\/|["'`])/.test(line)) res.literalTmp.push(`${f}:${i + 1}: ${line.trim()}`);
    });
    const lines = codeOnly;
    lines.forEach((line, i) => {
      if (/\btmpdir\s*\(\s*\)/.test(line)) {
        res.tmpdirSites += 1;
        const window = lines.slice(i, i + 4).join("\n");
        if (!/mkdtemp/.test(window)) res.unsafeTmpdir.push(`${f}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  return res;
}

describe("tooling never writes to a predictable shared-temp path", () => {
  const result = scan((f) => readFileSync(resolve(REPO, f), "utf8"));

  it("no string literal starts with /tmp", () => {
    expect(
      result.literalTmp,
      "A literal /tmp path is predictable. Write under ~/.lh-shots/<name> (join(homedir(), \".lh-shots\", ...)) instead.",
    ).toEqual([]);
  });

  it("every tmpdir() call is wrapped by mkdtemp", () => {
    expect(
      result.unsafeTmpdir,
      "tmpdir() plus a fixed, pid or Date.now() name is guessable. Make the directory with mkdtempSync(join(tmpdir(), \"prefix-\")).",
    ).toEqual([]);
  });

  it("the scan looks at real files and real tmpdir() calls (floors)", () => {
    expect(trackedTooling().length, "tracked scripts/ + e2e/ sources listed").toBeGreaterThan(MIN_FILES);
    expect(result.files, "tracked scripts/ + e2e/ sources scanned").toBeGreaterThanOrEqual(MIN_FILES);
    expect(result.tmpdirSites, "tmpdir() calls seen (all mkdtemp-wrapped); update TMPDIR_SITES with the change").toBe(TMPDIR_SITES);
  });
});
