/**
 * The review tooling must survive a dangling symlink in the tree it walks.
 *
 * ─── THE DEFECT (2026-10-17) ───────────────────────────────────────────────
 *
 * `npm run review:report -- ~/.lh-shots/bgloc-dd` crashed with
 *   ENOENT: no such file or directory, stat
 *   '/Users/lexilombas/.lh-shots/bgloc-dd/SourcePackages/checkouts/promises/FBLPromise+Testing.h'
 * because `walk()` called `statSync()` (which FOLLOWS links) on every name
 * `readdirSync()` returned. An Xcode DerivedData copy keeps relative symlinks
 * that point nowhere once it is moved under ~/.lh-shots, and
 * `~/.lh-shots/stale-bundle/current` points at a dist folder that was deleted.
 * One broken link anywhere under a root killed the whole report, so the tool
 * that enforces "I looked is recorded" could not run at all.
 *
 * The class: ANY filesystem walk in the review tooling must go through
 * `scripts/lib/safeWalk.mjs`, which reports a dangling link (and a symlink
 * cycle, and an unreadable directory) instead of throwing, and never follows a
 * cycle forever.
 *
 * ─── WHAT THIS TEST DRIVES ─────────────────────────────────────────────────
 *
 * 1. The real `scripts/review-report.mjs`, as a child process, against a
 *    sandbox holding a dangling file link, a dangling directory link, a
 *    symlink cycle and a GOOD symlinked directory with a PNG in it. It must
 *    exit by its normal rules, name each broken link, and still count the
 *    PNG reached through the good link.
 * 2. An inventory guard: every review-tooling file (scripts/ and e2e/ files
 *    that read or write the screenshot review log, review-log.jsonl or a
 *    visual-notes reviews.jsonl, plus scripts/review-*.mjs) may not
 *    call readdirSync/statSync/readdir itself; a walk there must import
 *    safeWalk. A new review script that hand-rolls a walk goes red here.
 *
 * @mutate scripts/lib/safeWalk.mjs | try { st = statSync(p); } catch (e) { broken.push({ path: p, reason: e.code \|\| String(e) }); continue; } | st = statSync(p);
 * @mutate scripts/lib/safeWalk.mjs | if (seen.has(real)) { cycles.push(dir); return; } | if (false) { cycles.push(dir); return; }
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkFiles } from "../../scripts/lib/safeWalk.mjs";

const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "review-report.mjs");

type Run = { code: number; out: string };

function run(cwd: string, args: string[] = []): Run {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SWEEP_OUTPUT_DIR: join(cwd, "sweep-empty"), REVIEW_DIRS: "" },
    });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const png = (p: string) => {
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileSync(p, Buffer.from("89504e470d0a1a0a", "hex"));
  return p;
};

const record = (cwd: string, screenshot: string) => {
  mkdirSync(join(cwd, ".review"), { recursive: true });
  appendFileSync(
    join(cwd, ".review", "review-log.jsonl"),
    JSON.stringify({ screenshot: resolve(screenshot), screen: "s", checked: "c", verdict: "ok" }) + "\n",
  );
};

/** A tree shaped like ~/.lh-shots/bgloc-dd and ~/.lh-shots/stale-bundle. */
function brokenTree(): { cwd: string; shots: string } {
  // realpath: on macOS tmpdir() is /var/..., a link to /private/var/...,
  // and the report prints canonical paths.
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "review-links-")));
  mkdirSync(join(cwd, "sweep-empty"), { recursive: true });
  mkdirSync(join(cwd, "test-results"), { recursive: true });
  const shots = join(cwd, "shots");
  png(join(shots, "real.png"));
  // DerivedData-style dangling FILE link (relative target that is not there).
  mkdirSync(join(shots, "dd", "checkouts", "promises"), { recursive: true });
  symlinkSync("../../Sources/FBLPromises.h", join(shots, "dd", "checkouts", "promises", "FBLPromises.h"));
  // stale-bundle/current-style dangling DIRECTORY link.
  symlinkSync(join(shots, "dist-deleted"), join(shots, "current"));
  // A link to its own parent: a cycle a naive walk follows forever.
  symlinkSync(shots, join(shots, "dd", "loop"));
  // A GOOD link to a directory holding a capture: still reached and counted.
  png(join(cwd, "elsewhere", "linked.png"));
  symlinkSync(join(cwd, "elsewhere"), join(shots, "linked-dir"));
  return { cwd, shots };
}

describe("review:report survives broken links under a root", () => {
  it("does not crash on a dangling link, names it, and still reports the run", () => {
    const { cwd, shots } = brokenTree();
    try {
      record(cwd, join(shots, "real.png"));
      const r = run(cwd, [shots]);
      // The old walk threw ENOENT out of statSync here.
      expect(r.out).not.toMatch(/\bat walk\b|node:internal|Error: ENOENT/);
      expect(r.out).toMatch(/BROKEN LINK/);
      expect(r.out).toContain(join(shots, "current"));
      expect(r.out).toContain(join(shots, "dd", "checkouts", "promises", "FBLPromises.h"));
      // The good capture and the one behind the good link are both counted,
      // each once (the cycle does not duplicate or loop).
      expect(r.out).toMatch(/2 screenshot\(s\), 1 reviewed/);
      // Broken links are flagged, not a failure: the reviewed run passes.
      expect(r.code, r.out).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("still applies the normal rules on a tree with broken links", () => {
    const { cwd, shots } = brokenTree();
    try {
      png(join(shots, "x-diff.png"));
      record(cwd, join(shots, "real.png"));
      const r = run(cwd, [shots]);
      expect(r.out).toMatch(/BROKEN LINK/);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/1 failure\/changed screenshot\(s\) have no review entry/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("walkFiles", () => {
  it("reports dangling links, stops at a cycle, and follows a good link once", () => {
    const { cwd, shots } = brokenTree();
    try {
      const { files, broken, cycles } = walkFiles(shots, (p) => p.endsWith(".png"));
      expect(files.map((f) => relative(shots, f)).sort()).toEqual(["linked-dir/linked.png", "real.png"]);
      expect(broken.map((b) => relative(shots, b.path)).sort()).toEqual([
        "current",
        "dd/checkouts/promises/FBLPromises.h",
      ]);
      expect(broken.every((b) => b.reason === "ENOENT")).toBe(true);
      expect(cycles.map((c) => relative(shots, c))).toEqual(["dd/loop"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/** Every file that reads or writes the review log, plus scripts/review-*.mjs. */
function reviewTooling(): string[] {
  const out = new Set<string>();
  const scan = (dir: string) => {
    for (const ent of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
        scan(rel);
        continue;
      }
      if (!/\.(mjs|js|ts)$/.test(ent.name)) continue;
      const src = readFileSync(join(ROOT, rel), "utf8");
      if (/^review-.*\.mjs$/.test(ent.name) || /review-log\.jsonl|(?<![-\w])reviews\.jsonl/.test(src)) out.add(rel);
    }
  };
  scan("scripts");
  scan("e2e");
  return [...out].sort();
}

describe("every fs walk in the review tooling goes through safeWalk", () => {
  it("inventories the review tooling", () => {
    const files = reviewTooling();
    expect(files).toContain("scripts/review-report.mjs");
    expect(files).toContain("e2e/reviewLog.ts");
    expect(files).toContain("scripts/check-visual-notes.mjs");
    expect(files.length).toBeGreaterThan(2);
  });

  it("no review-tooling file walks the filesystem by hand", () => {
    const offenders = reviewTooling().flatMap((rel) => {
      const src = blankComments(readFileSync(join(ROOT, rel), "utf8"));
      return /\b(readdirSync|statSync|readdir|opendirSync|opendir)\s*\(/.test(src)
        ? [`${rel}: walk it with walkFiles() from scripts/lib/safeWalk.mjs`]
        : [];
    });
    expect(offenders).toEqual([]);
  });

  it("review-report.mjs uses safeWalk", () => {
    const src = blankComments(readFileSync(SCRIPT, "utf8"));
    expect(src).toMatch(/from\s+["']\.\/lib\/safeWalk\.mjs["']/);
    expect(relative(ROOT, SCRIPT)).toBe("scripts/review-report.mjs");
  });
});
