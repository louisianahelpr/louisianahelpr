/*
 * GUARD (docs/OPEN.md Q47 + Q18): a LOCAL Claude session never commits from the
 * shared main checkout, is handed its own worktree at session start, and is
 * warned when it commits from a different tree than the one it recorded.
 * Drives scripts/session-worktree.mjs (the real CLI, as the SessionStart hook
 * and .husky/pre-commit run it) against a real fixture repo: origin + primary
 * clone + a linked worktree, with a fake $HOME.
 */
// @mutate scripts/lib/sessionWorktree.mjs |   if (tree.primary && !session.remote) { |   if (false) {
// @mutate scripts/lib/sessionWorktree.mjs | return { inSession: Boolean(id), id, | return { inSession: false, id,
// @mutate scripts/lib/sessionWorktree.mjs | primary: resolve(gitDir) === resolve(commonDir) } | primary: false }
// @mutate scripts/lib/sessionWorktree.mjs |   if (startTree && resolve(startTree) !== tree.toplevel) { |   if (false) {
// @mutate scripts/lib/sessionWorktree.mjs |   if (!tree.primary) return { action: "none" | if (tree.primary) return { action: "none"
// @mutate scripts/session-worktree.mjs |     process.exit(1); |     process.exitCode = 0;
// @mutate .husky/pre-commit | node scripts/session-worktree.mjs check-commit \|\| exit 1 | true
// @mutate .claude/settings.json | scripts/session-worktree.mjs\" start | scripts/session-worktree.mjs\" noop
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync, realpathSync, readFileSync, lstatSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const CLI = join(ROOT, "scripts", "session-worktree.mjs");
let base = "";
let main = "";
let linked = "";
let home = "";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e",
  GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
};
function git(cwd: string, ...argv: string[]) {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...GIT_ENV } }).trim();
}
/** Run the CLI as a hook would: a clean env, so the vitest process's own session vars never leak in. */
function run(cmd: "start" | "check-commit", cwd: string, env: Record<string, string>) {
  const r = spawnSync(process.execPath, [CLI, cmd], {
    cwd, encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: home, ...GIT_ENV, ...env },
  });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const LOCAL = (id: string) => ({ CLAUDE_CODE_SESSION_ID: id, CLAUDECODE: "1" });

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "lh-sessionwt-")));
  home = join(base, "home");
  mkdirSync(home);
  const origin = join(base, "origin.git");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  main = join(base, "main");
  git(base, "clone", "-q", origin, main);
  writeFileSync(join(main, "a.txt"), "a");
  mkdirSync(join(main, "node_modules"));
  writeFileSync(join(main, ".gitignore"), "node_modules\n");
  git(main, "add", "a.txt", ".gitignore");
  git(main, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "a");
  git(main, "push", "-q", "origin", "HEAD:main");
  git(main, "fetch", "-q", "origin");
  linked = join(base, "lane");
  git(main, "worktree", "add", "-q", "--detach", linked, "origin/main");
});
afterAll(() => { if (base) rmSync(base, { recursive: true, force: true }); });

describe("pre-commit: sessions never commit from the shared checkout (Q47)", () => {
  it("REFUSES a local Claude session committing from the primary checkout", () => {
    const r = run("check-commit", main, LOCAL("sess-aaaa1111"));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/SHARED main checkout/);
  });

  it("allows the same session from a linked worktree", () => {
    expect(run("check-commit", linked, LOCAL("sess-aaaa1111")).status).toBe(0);
  });

  it("allows the owner's own terminal (no session env) in the primary checkout", () => {
    expect(run("check-commit", main, {}).status).toBe(0);
  });

  it("allows a cloud session's private clone (CLAUDE_CODE_REMOTE=true)", () => {
    expect(run("check-commit", main, { ...LOCAL("sess-cloud"), CLAUDE_CODE_REMOTE: "true" }).status).toBe(0);
  });

  it("allows an explicit, logged override", () => {
    const r = run("check-commit", main, { ...LOCAL("sess-aaaa1111"), LH_SHARED_CHECKOUT_OK: "owner said so" });
    expect(r.status).toBe(0);
    expect(readFileSync(join(home, ".lh-hygiene", "shared-checkout-commits.log"), "utf8")).toMatch(/owner said so/);
  });

  it("is wired into .husky/pre-commit before anything else can pass the commit", () => {
    const hook = readFileSync(join(ROOT, ".husky", "pre-commit"), "utf8");
    const lines = hook.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(lines[0]).toBe("node scripts/session-worktree.mjs check-commit || exit 1");
  });
});

describe("session start: a local session in the shared checkout gets its own worktree (Q47)", () => {
  it("creates ~/.lh-wt/session-<id8> at origin/main with node_modules linked, and says so", () => {
    const r = run("start", main, LOCAL("abcd1234-rest-of-id"));
    expect(r.status).toBe(0);
    const wt = join(home, ".lh-wt", "session-abcd1234");
    expect(r.out).toContain(`cd ${wt}`);
    expect(existsSync(join(wt, "a.txt"))).toBe(true);
    expect(lstatSync(join(wt, "node_modules")).isSymbolicLink()).toBe(true);
    expect(git(wt, "rev-parse", "HEAD")).toBe(git(main, "rev-parse", "origin/main"));
    // idempotent: a resumed session reuses it
    expect(run("start", main, LOCAL("abcd1234-rest-of-id")).status).toBe(0);
  });

  it("creates nothing for a cloud session or a session already in a linked worktree", () => {
    run("start", main, { ...LOCAL("cloud999-x"), CLAUDE_CODE_REMOTE: "true" });
    run("start", linked, LOCAL("lane5555-x"));
    expect(existsSync(join(home, ".lh-wt", "session-cloud999"))).toBe(false);
    expect(existsSync(join(home, ".lh-wt", "session-lane5555"))).toBe(false);
  });

  it("is wired as a SessionStart hook", () => {
    const s = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
    const cmds: string[] = s.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(cmds).toContain('node "$CLAUDE_PROJECT_DIR/scripts/session-worktree.mjs" start');
  });
});

describe("pre-commit: a commit from a different tree than the session recorded (Q18)", () => {
  it("names the tree the session started in when its cwd drifted into the shared checkout", () => {
    // the session started in main and was moved to its worktree by the start hook
    const r = run("check-commit", main, LOCAL("abcd1234-rest-of-id"));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/Q18: this session started in .*session-abcd1234/);
  });

  it("warns (does not refuse) from a different linked worktree", () => {
    const r = run("check-commit", linked, LOCAL("abcd1234-rest-of-id"));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Q18: this session started in/);
  });

  it("stays quiet in the tree the session recorded", () => {
    run("start", linked, LOCAL("quiet777-x"));
    const r = run("check-commit", linked, LOCAL("quiet777-x"));
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch(/Q18/);
  });
});
