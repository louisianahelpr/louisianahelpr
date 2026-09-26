/*
 * GUARD (docs/OPEN.md Q9): a money / authz / data-model commit that lands with
 * no recorded review is REPORTED (it never blocks). Drives the real CLI on a
 * fixture repo, pins the classifier against this repo's own tree, and pins the
 * wiring (workflow runs it, --strict only on main, main-red-watch watches it).
 */
// @mutate scripts/lib/sensitiveReview.mjs |   if (/^supabase\/migrations\/.+\.sql$/.test(path)) return true; |   if (/^supabase\/migrations\/.+\.sql$/.test(path)) return false;
// @mutate scripts/lib/sensitiveReview.mjs |   if (/^supabase\/functions\//.test(path)) return true; |   if (/^supabase\/functions\//.test(path)) return false;
// @mutate scripts/lib/sensitiveReview.mjs | return SRC_SENSITIVE.test(path); | return false;
// @mutate scripts/lib/sensitiveReview.mjs |   if (/\.(test\|spec)\.[cm]?[jt]sx?$/.test(path) | if (/\.(never)\.[cm]?[jt]sx?$/.test(path)
// @mutate scripts/lib/sensitiveReview.mjs |     if (reviewer === "not-needed" \|\| REVIEWERS.includes(reviewer)) found = | found =
// @mutate scripts/lib/sensitiveReview.mjs |   return { rows, missing: rows.filter((r) => !r.review) }; |   return { rows, missing: [] };
// @mutate scripts/lib/sensitiveReview.mjs |     if (c.date.slice(0, 10) < since) continue; |     if (true) continue;
// @mutate scripts/check-sensitive-review.mjs | if (strict && (missing.length \|\| errors.length)) process.exit(1); | if (false) process.exit(1);
// @mutate .github/workflows/sensitive-review.yml |         run: node scripts/check-sensitive-review.mjs --range origin/main --strict |         run: node scripts/check-sensitive-review.mjs --range origin/main
// @mutate .github/workflows/main-red-watch.yml |       - Sensitive review record\n |
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { isSensitive, trailerReview, parseLog, audit, REVIEWERS } from "../../scripts/lib/sensitiveReview.mjs";

const ROOT = join(__dirname, "..", "..");
const CLI = join(ROOT, "scripts", "check-sensitive-review.mjs");
const ENV = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e",
  GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_DATE: "2026-09-27T12:00:00Z", GIT_COMMITTER_DATE: "2026-09-27T12:00:00Z",
};
let repo = "";
const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", env: { ...process.env, ...ENV } }).trim();
function commit(file: string, message: string) {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), String(Math.random()));
  git("add", file);
  git("-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}
const run = (...a: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...a], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...ENV } });
  return { status: r.status, out: r.stdout + r.stderr };
};

describe("which paths are money / authz / data-model (this repo's own tree)", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const sensitive = tracked.filter(isSensitive);

  it("covers every migration and every edge function source, and no test", () => {
    const migrations = tracked.filter((p) => /^supabase\/migrations\/.+\.sql$/.test(p));
    const fns = tracked.filter((p) => /^supabase\/functions\/.+\.ts$/.test(p) && !/\.test\.ts$/.test(p));
    expect(migrations.length).toBeGreaterThan(300);
    expect(fns.length).toBeGreaterThan(60);
    for (const p of [...migrations, ...fns]) expect(isSensitive(p), p).toBe(true);
    expect(sensitive.filter((p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p))).toEqual([]);
  });

  it("covers the client money/auth modules CLAUDE.md names", () => {
    for (const p of ["src/lib/supabaseResult.ts", "src/lib/mutationResult.ts"]) expect(isSensitive(p), p).toBe(true);
    const src = sensitive.filter((p) => p.startsWith("src/"));
    expect(src.length).toBeGreaterThan(50);
    expect(src.some((p) => /escrow|payment|payout|refund|dispute/i.test(p))).toBe(true);
  });

  it("leaves docs, plain UI and tests alone", () => {
    for (const p of ["docs/OPEN.md", "src/components/ui/button.tsx", "src/lib/cancellationFee.parity.test.ts", "e2e/x.spec.ts"]) expect(isSensitive(p), p).toBe(false);
  });
});

describe("what counts as a recorded review", () => {
  it("a Sensitive-Review trailer with a known reviewer, or not-needed with a reason", () => {
    expect(trailerReview("x\n\nSensitive-Review: lh-authz-rls: clean")?.reviewer).toBe("lh-authz-rls");
    expect(trailerReview("x\n\nSensitive-Review: not-needed: comment-only")?.reviewer).toBe("not-needed");
    expect(trailerReview("x\n\nSensitive-Review: my-friend: fine")).toBeNull();
    expect(trailerReview("x\n\nreviewed by lh-authz-rls")).toBeNull();
  });

  it("the review log rejects malformed lines instead of dropping them", () => {
    const { bySha, errors } = parseLog('{"sha":"abcdef1","reviewer":"lh-money-escrow","verdict":"ok"}\n{"sha":"zz","reviewer":"x"}\n');
    expect(bySha.size).toBe(1);
    expect(errors).toHaveLength(1);
    expect(REVIEWERS).toContain("lh-silent-failure");
  });

  it("history before START_DATE is not reported", () => {
    const c = { sha: "a".repeat(40), date: "2026-09-20T00:00:00Z", message: "m", files: ["supabase/migrations/fixture_old.sql"] };
    expect(audit([c], new Map()).rows).toEqual([]);
  });
});

describe("the CLI on a fixture repo", () => {
  let bare = "";
  let reviewed = "";
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "lh-sensrev-")));
    git("init", "-q", "-b", "main");
    commit("README.md", "docs only");
    bare = commit("supabase/migrations/fixture_add_policy.sql", "add a policy");
    reviewed = commit("supabase/functions/release-payout/index.ts", "release fix\n\nSensitive-Review: lh-money-escrow: clean");
    commit("src/lib/payoutMath.ts", "client money math");
  });
  afterAll(() => { if (repo) rmSync(repo, { recursive: true, force: true }); });

  it("reports the two unreviewed sensitive commits, not the reviewed one or the docs one", () => {
    const r = run("--range", "HEAD");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/3 touch a sensitive path, \*\*2 with no recorded review/);
    expect(r.out).toContain(bare.slice(0, 9));
    expect(r.out).not.toContain(`\`${reviewed.slice(0, 9)}\``);
  });

  it("--strict goes red while any is missing (main only), and green once recorded", () => {
    expect(run("--range", "HEAD", "--strict").status).toBe(1);
    expect(run("record", bare, "lh-authz-rls", "clean").status).toBe(0);
    const head = git("rev-parse", "HEAD");
    expect(run("record", head, "lh-money-escrow", "clean").status).toBe(0);
    const r = run("--range", "HEAD", "--strict");
    expect(r.out).toMatch(/\*\*0 with no recorded review/);
    expect(r.status).toBe(0);
  });
});

describe("wiring", () => {
  const wf = readFileSync(join(ROOT, ".github/workflows/sensitive-review.yml"), "utf8");
  it("main runs --strict; PRs only annotate", () => {
    expect(wf).toMatch(/if: github\.event_name != 'pull_request'\n\s+run: node scripts\/check-sensitive-review\.mjs --range origin\/main --strict/);
    expect(wf).toMatch(/if: github\.event_name == 'pull_request'\n\s+run: node scripts\/check-sensitive-review\.mjs --range "[^"]+"\n/);
    expect(wf).toMatch(/fetch-depth: 0/);
  });
  it("main-red-watch turns a red main run into a nightly-red issue + ledger item", () => {
    const name = /^name: (.+)$/m.exec(wf)![1];
    expect(readFileSync(join(ROOT, ".github/workflows/main-red-watch.yml"), "utf8")).toContain(`      - ${name}\n`);
  });
});
