/**
 * CLASS GUARD (docs/OPEN.md Q1184): a commit's closing keyword must never
 * close an issue labelled nightly-red.
 *
 * 584eef85c's body closed nightly-red issue #2200 on 2026-10-03, before its
 * workflow had gone green. scripts/lib/closingRefs.mjs extracts the closing
 * references from commit messages; scripts/check-closing-keywords.mjs asks gh
 * for each referenced issue's labels (fail closed when gh cannot answer);
 * scripts/land.sh runs it on origin/main..HEAD before it pushes.
 *
 * Proof it can fail: the cases below run a real git repo through the real
 * checker with a stand-in `gh` on PATH, and each @mutate line breaks one link
 * of the chain (extraction, label test, fail-closed, exit code, the land.sh call).
 */
// @mutate scripts/lib/closingRefs.mjs | (?<![\\w-])${KEYWORD} | ${KEYWORD}
// @mutate scripts/lib/closingRefs.mjs | else if (a.labels.includes(NIGHTLY_RED)) blocked.push({ sha, ref }); | else if (false) blocked.push({ sha, ref });
// @mutate scripts/lib/closingRefs.mjs | if (a.why !== undefined) unanswered.push({ sha, ref, why: a.why }); | if (a.why !== undefined) void 0;
// @mutate scripts/lib/closingRefs.mjs |     "\|([\\w.-]+/[\\w.-]+)#(\\d+)" + | "\|(?!)" +
// @mutate scripts/check-closing-keywords.mjs | if (blocked.length \|\| unanswered.length) process.exit(1); | if (blocked.length) process.exit(1);
// @mutate scripts/check-closing-keywords.mjs | if (r.status !== 0) throw new Error( | if (r.status !== 0) return []; (x) => new Error(
// @mutate scripts/check-closing-keywords.mjs | if (r.error) throw new Error( | if (r.error) return []; (x) => new Error(
// @mutate scripts/land.sh |   node scripts/check-closing-keywords.mjs --range origin/main..HEAD | :
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { closingReferences, judgeClosers, NIGHTLY_RED } from "../../scripts/lib/closingRefs.mjs";

const ROOT = resolve(__dirname, "../..");
const nums = (msg: string) => closingReferences(msg).map((r) => (r.repo ? `${r.repo}#${r.number}` : `#${r.number}`));

describe("Q1184: closingReferences extracts what GitHub would close", () => {
  it.each([
    "close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved",
    "Closes", "FIXED", "Resolves",
  ])("keyword %s #N", (kw) => {
    expect(nums(`${kw} #2200`)).toEqual(["#2200"]);
  });

  it("finds references at all (inventory floor)", () => {
    expect(closingReferences("Fixes #1\nCloses #2\nresolves a/b#3\nfixed GH-4").length).toBeGreaterThan(3);
  });

  it("takes a colon, a body line, several keywords, and each reference form", () => {
    expect(nums("Fixes: #1")).toEqual(["#1"]);
    expect(nums("subject\n\nbody text\nCloses #2\nand resolves #3.")).toEqual(["#2", "#3"]);
    expect(nums("fixes louisianahelpr/louisianahelpr#4")).toEqual(["louisianahelpr/louisianahelpr#4"]);
    expect(nums("closes https://github.com/louisianahelpr/louisianahelpr/issues/5")).toEqual(["louisianahelpr/louisianahelpr#5"]);
    expect(nums("resolved GH-6")).toEqual(["#6"]);
    expect(nums("fixes #7 and fixes #7 again")).toEqual(["#7"]);
  });

  it("ignores what GitHub ignores", () => {
    for (const msg of [
      "bugfix #3", "hotfix #3", "unfixed #3", "prefix #3", "see #3", "fixes", "fixes the thing #3",
      "Closes Q1184", "fixes #12abc", "refixes #3", "closes\n#3",
    ])
      expect(nums(msg), msg).toEqual([]);
  });
});

describe("Q1184: judgeClosers fails closed", () => {
  const commits = [
    { sha: "a".repeat(40), message: "work\n\nFixes #10 and closes #11" },
    { sha: "b".repeat(40), message: "other\n\nresolves #10" },
    { sha: "c".repeat(40), message: "no keyword, see #12" },
  ];

  it("blocks every commit that names a nightly-red issue, asking gh once per issue", () => {
    const asked: string[] = [];
    const r = judgeClosers(commits, (ref) => {
      asked.push(`${ref.number}`);
      return ref.number === 10 ? [NIGHTLY_RED, "bug"] : ["bug"];
    });
    expect(r.blocked.map((b) => [b.sha[0], b.ref.number])).toEqual([["a", 10], ["b", 10]]);
    expect(r.unanswered).toEqual([]);
    expect(asked).toEqual(["10", "11"]);
  });

  it("refuses a reference gh cannot answer", () => {
    const r = judgeClosers(commits, () => {
      throw new Error("gh did not run: ENOENT");
    });
    expect(r.unanswered.map((u) => u.ref.number)).toEqual([10, 11, 10]);
    expect(r.unanswered[0].why).toContain("ENOENT");
  });

  it("passes a landing with no closing keyword without asking gh at all", () => {
    const r = judgeClosers([commits[2]], () => {
      throw new Error("must not be asked");
    });
    expect(r).toEqual({ blocked: [], unanswered: [] });
  });
});

describe("Q1184: the checker, run for real against a git range", () => {
  let dir: string;
  let bin: string;
  let base: string;
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" }).trim();
  const commit = (msg: string) => {
    writeFileSync(join(dir, "f.txt"), msg + Math.random());
    git("add", "f.txt");
    git("commit", "-q", "-m", msg);
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "closing-kw-"));
    bin = join(dir, "bin");
    execFileSync("mkdir", [bin]);
    // Stand-in gh: `gh issue view N --json labels [--repo r]`; labels come from GH_LABELS_<N>.
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        'echo "$@" >> "$GH_LOG"',
        '[ "$GH_FAIL" = 1 ] && { echo "HTTP 401" >&2; exit 1; }',
        'n="$3"',
        'v=$(printenv "GH_LABELS_$n")',
        '[ -n "$v" ] || { echo "no such issue" >&2; exit 1; }',
        'printf \'{"labels":%s}\\n\' "$v"',
      ].join("\n"),
    );
    chmodSync(join(bin, "gh"), 0o755);
    git("init", "-q", "-b", "main");
    commit("base");
    base = git("rev-parse", "HEAD");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (env: Record<string, string> = {}) => {
    const log = join(dir, `gh-${Math.random().toString(36).slice(2)}.log`);
    const r = spawnSync("node", [join(ROOT, "scripts/check-closing-keywords.mjs"), "--range", `${base}..HEAD`], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: log, ...env },
    });
    return { status: r.status, err: r.stderr, out: r.stdout, asked: existsSync(log) ? readFileSync(log, "utf8") : "" };
  };

  it("refuses a body that closes a nightly-red issue, reading the FULL message", () => {
    commit("fix: the thing\n\nA long body.\n\nCloses #2200");
    const r = run({ GH_LABELS_2200: '[{"name":"nightly-red"}]' });
    expect(r.status).toBe(1);
    expect(r.err).toContain("closes #2200");
    expect(r.err).toContain("nightly-red");
    expect(r.asked).toContain("issue view 2200 --json labels");
  });

  it("fails closed when gh cannot answer", () => {
    const r = run({ GH_FAIL: "1" });
    expect(r.status).toBe(1);
    expect(r.err).toContain("Refusing (fail closed)");
  });

  it("fails closed when gh is not installed at all", () => {
    const only = join(dir, "git-only");
    execFileSync("mkdir", ["-p", only]);
    symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(only, "git"));
    commit("fix: y\n\nCloses #31");
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/check-closing-keywords.mjs"), "--range", `${base}..HEAD`], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: only },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("gh did not run");
  });

  it("passes an ordinary issue and a cross-repo reference, asking with --repo", () => {
    git("reset", "-q", "--hard", base);
    commit("feat: x\n\nFixes #7\nresolves other/repo#8");
    const r = run({ GH_LABELS_7: '[{"name":"bug"}]', GH_LABELS_8: "[]" });
    expect(r.status).toBe(0);
    expect(r.asked).toContain("issue view 8 --json labels --repo other/repo");
  });

  it("passes with no closing keyword and never calls gh", () => {
    git("reset", "-q", "--hard", base);
    commit("chore: see #2200 and Q1184");
    const r = run({ GH_FAIL: "1" });
    expect(r.status).toBe(0);
    expect(r.asked).toBe("");
  });
});

describe("Q1184: scripts/land.sh runs the check before it pushes", () => {
  const code = readFileSync(join(ROOT, "scripts/land.sh"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  const call = "node scripts/check-closing-keywords.mjs --range origin/main..HEAD";

  it("calls the checker over origin/main..HEAD, after the rebase and refresh, before the first push", () => {
    const at = code.indexOf(call);
    expect(at, "land.sh must call scripts/check-closing-keywords.mjs").toBeGreaterThan(-1);
    expect(code.indexOf(call, at + 1), "exactly one call").toBe(-1);
    expect(at).toBeGreaterThan(code.indexOf("npm run -s inventories:refresh"));
    expect(at).toBeLessThan(code.indexOf("git push"));
  });

  it("is not wrapped in anything that swallows its exit status", () => {
    const line = code.split("\n").find((l) => l.includes(call)) ?? "";
    expect(line.trim()).toBe(call);
  });
});
