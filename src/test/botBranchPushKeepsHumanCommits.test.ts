// @mutate .github/actions/refresh-pr/action.yml | git commit -q -m "$REFRESH_TITLE" | git push --force "$REMOTE" "HEAD:refs/heads/$BRANCH"; git commit -q -m "$REFRESH_TITLE"
// @mutate .github/actions/refresh-pr/action.yml | cp scripts/ci/bot-branch-push.sh "$PUSHER" | cp /dev/null "$PUSHER"
// @mutate scripts/ci/bot-branch-push.sh | --force-with-lease="$REF:$REMOTE_SHA" | --force
// @mutate scripts/ci/bot-branch-push.sh | FOREIGN+=("$c") | :
// @mutate scripts/ci/bot-branch-push.sh | EVIL+=("$c") | :
// @mutate scripts/ci/bot-branch-push.sh | UNSHALLOW=(--unshallow) | UNSHALLOW=()
// @mutate scripts/ci/bot-branch-push.sh | refuse "the fresh measurement conflicts with the non-bot commits" | git cherry-pick --abort
/*
 * CLASS GUARD (2026-09-30): a bot never discards a commit it did not make.
 *
 * .github/actions/refresh-pr rebuilt bot/refresh/<id> from latest main and
 * `git push --force`d it every run. 90fa25368 (a person's fix pushed onto
 * bot/refresh/loading-states to make PR #1932 green) was wiped by the next bot
 * run (926ebcbe0), so the PR could never go green.
 *
 * The class is "a workflow force-pushes a bot branch". The rule:
 *   1. No workflow or composite action under .github/ runs `git push` itself.
 *      Every bot-branch push goes through scripts/ci/bot-branch-push.sh, which
 *      replaces the branch only when every commit on it is the bot's, replays
 *      non-bot commits under the fresh one otherwise, and refuses (exit 3,
 *      nothing pushed, the commits named) on a conflict.
 *   2. That script pushes only with --force-with-lease=<ref>:<sha it read>.
 *   3. The script's behaviour is exercised against a throwaway local remote.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = resolve(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/ci/bot-branch-push.sh");
const ACTION_FILE = join(ROOT, ".github/actions/refresh-pr/action.yml");

/** Blank shell/YAML `#` comments (outside quotes); line count preserved. */
function blankHashComments(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      let q: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === "\\" && q === '"') i++;
          else if (ch === q) q = null;
        } else if (ch === "'" || ch === '"') q = ch;
        else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

function walkYaml(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkYaml(p, out);
    else if (/\.ya?ml$/.test(e.name)) out.push(p);
  }
  return out;
}

const GIT_PUSH = /\bgit\b[^\n;&|]*?\spush\b/;

describe("no workflow pushes a branch except through scripts/ci/bot-branch-push.sh", () => {
  const files = walkYaml(join(ROOT, ".github"));

  it("scans the whole .github tree (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((f) => f.endsWith("action.yml")).length).toBeGreaterThan(2);
  });

  it("no workflow or action runs `git push` itself", () => {
    const hits: string[] = [];
    for (const f of files) {
      blankHashComments(readFileSync(f, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (GIT_PUSH.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, "push bot branches with scripts/ci/bot-branch-push.sh, never a bare git push").toEqual([]);
  });

  it("refresh-pr pushes through a copy of the script", () => {
    const src = blankHashComments(readFileSync(ACTION_FILE, "utf8"));
    expect(src).toContain('cp scripts/ci/bot-branch-push.sh "$PUSHER"');
    expect(src.match(/bash "\$PUSHER" push\b/g)?.length ?? 0).toBeGreaterThan(1);
    expect(src).toMatch(/bash "\$PUSHER" foreign\b/);
  });

  it("the script itself pushes only with a lease on the sha it read", () => {
    const lines = blankHashComments(readFileSync(SCRIPT, "utf8"))
      .split("\n")
      .filter((l) => /\spush\s/.test(l) && /GITX|\bgit\b/.test(l));
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      expect(l).toMatch(/--force-with-lease="\$REF:(\$REMOTE_SHA)?"/);
      expect(l).not.toMatch(/--force(\s|$)|\s-f\s|\s"?\+/);
    }
  });
});

// ---------------------------------------------------------------------------
// Behaviour, against a throwaway bare remote.
const BOT = "41898282+github-actions[bot]@users.noreply.github.com";
const HUMAN = "person@example.com";
const BRANCH = "bot/refresh/x";

describe("bot-branch-push.sh against a local remote", () => {
  let dir = "";
  let remote = "";
  let work = "";
  const baseEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GITHUB_REPOSITORY: "",
  };
  const as = (email: string) => ({
    ...baseEnv,
    GIT_AUTHOR_NAME: email === BOT ? "github-actions[bot]" : "Person",
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: email === BOT ? "github-actions[bot]" : "Person",
    GIT_COMMITTER_EMAIL: email,
  });
  const git = (args: string[], email = BOT, cwd = work) =>
    execFileSync("git", args, { cwd, env: as(email), encoding: "utf8" }).trim();
  const commit = (file: string, body: string, msg: string, email: string) => {
    writeFileSync(join(work, file), body);
    git(["add", "-A"], email);
    git(["commit", "-q", "-m", msg], email);
    return git(["rev-parse", "HEAD"]);
  };
  const remoteSha = () => {
    const r = spawnSync("git", ["rev-parse", "--verify", "-q", `refs/heads/${BRANCH}`], {
      cwd: remote,
      env: baseEnv,
      encoding: "utf8",
    });
    return r.status === 0 ? r.stdout.trim() : "";
  };
  /** Publish the current HEAD as the remote bot branch (setup, not the script). */
  const seedBranch = () => git(["push", "-q", "--force", remote, `HEAD:refs/heads/${BRANCH}`]);
  /** What the action does: rebuild from main, return BASE. */
  const startRun = () => {
    git(["checkout", "-q", "--force", "-B", BRANCH, "main"]);
    return git(["rev-parse", "HEAD"]);
  };
  const run = (cmd: "push" | "foreign", base: string) =>
    spawnSync(
      "bash",
      [SCRIPT, cmd, "--remote", remote, "--branch", BRANCH, "--base", base, "--bot-email", BOT],
      { cwd: work, env: as(BOT), encoding: "utf8" },
    );
  const subjects = (base: string) =>
    git(["log", "--reverse", "--format=%s", `${base}..${remoteSha()}`], BOT, remote).split("\n").filter(Boolean);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bot-branch-push-"));
    remote = join(dir, "remote.git");
    work = join(dir, "work");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env: baseEnv });
    execFileSync("git", ["init", "-q", "-b", "main", work], { env: baseEnv });
    commit("data.json", "1\n", "base", HUMAN);
    commit("other.txt", "a\n", "other", HUMAN);
    git(["push", "-q", remote, "main"]);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the branch when it does not exist", () => {
    startRun();
    const head = commit("data.json", "2\n", "refresh", BOT);
    const r = run("push", "main");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(remoteSha()).toBe(head);
  });

  it("replaces the branch when every commit on it is the bot's", () => {
    startRun();
    commit("data.json", "2\n", "old refresh", BOT);
    seedBranch();
    const base = startRun();
    const head = commit("data.json", "3\n", "new refresh", BOT);
    expect(run("foreign", base).stdout.trim()).toBe("");
    const r = run("push", base);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(remoteSha()).toBe(head);
  });

  it("keeps a person's commit and puts the fresh measurement on top", () => {
    startRun();
    commit("data.json", "2\n", "old refresh", BOT);
    const human = commit("fix.txt", "fixed\n", "human fix", HUMAN);
    seedBranch();
    const base = startRun();
    commit("data.json", "3\n", "new refresh", BOT);
    expect(run("foreign", base).stdout).toContain(human.slice(0, 7));
    const r = run("push", base);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(subjects(base)).toEqual(["human fix", "new refresh"]);
    expect(git(["show", `${remoteSha()}:fix.txt`], BOT, remote)).toBe("fixed");
    expect(git(["show", `${remoteSha()}:data.json`], BOT, remote)).toBe("3");
  });

  it("keeps a person's commit when the refresh found nothing new", () => {
    startRun();
    commit("data.json", "2\n", "old refresh", BOT);
    commit("fix.txt", "fixed\n", "human fix", HUMAN);
    seedBranch();
    const base = startRun();
    const r = run("push", base);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(subjects(base)).toEqual(["human fix"]);
  });

  it("refuses and pushes nothing when the person's commit conflicts", () => {
    startRun();
    commit("data.json", "2\n", "old refresh", BOT);
    const human = commit("data.json", "human\n", "human edit of the data", HUMAN);
    seedBranch();
    const before = remoteSha();
    const base = startRun();
    const head = commit("data.json", "3\n", "new refresh", BOT);
    const r = run("push", base);
    expect(r.status, r.stdout + r.stderr).toBe(3);
    expect(r.stdout).toContain(human.slice(0, 7));
    expect(r.stdout).toContain("::error::");
    expect(remoteSha()).toBe(before);
    expect(git(["rev-parse", "HEAD"])).toBe(head);
    expect(existsSync(join(work, ".git/CHERRY_PICK_HEAD"))).toBe(false);
  });

  it("refuses when the fresh measurement conflicts with the person's commit", () => {
    startRun();
    const human = commit("data.json", "human\n", "human edit of the data", HUMAN);
    seedBranch();
    const before = remoteSha();
    const base = startRun();
    const head = commit("data.json", "3\n", "new refresh", BOT);
    const r = run("push", base);
    expect(r.status, r.stdout + r.stderr).toBe(3);
    expect(r.stdout).toContain("fresh measurement conflicts");
    expect(r.stdout).toContain(human.slice(0, 7));
    expect(remoteSha()).toBe(before);
    expect(git(["rev-parse", "HEAD"])).toBe(head);
  });

  it("drops a clean merge of main and replaces a bot-only branch", () => {
    startRun();
    commit("data.json", "2\n", "old refresh", BOT);
    git(["checkout", "-q", "main"]);
    commit("other.txt", "b\n", "main moved", HUMAN);
    git(["push", "-q", remote, "main"]);
    git(["checkout", "-q", BRANCH]);
    git(["merge", "-q", "--no-ff", "--no-edit", "main"], HUMAN);
    seedBranch();
    const base = startRun();
    const head = commit("data.json", "3\n", "new refresh", BOT);
    const r = run("push", base);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(remoteSha()).toBe(head);
  });

  // Morning page run 36904833835 (2026-10-01): refresh-pr runs in a DEPTH-1
  // checkout (actions/checkout default). BASE had no parents locally, so
  // BASE..remote listed the repo's whole history as "non-bot commits" and the
  // clean main-merge looked evil (no merge base): exit 3, nothing pushed.
  it("in a shallow (CI-shaped) checkout, a clean main-merge on a bot-only branch is replaced", () => {
    startRun();
    commit("data.json", "2\n", "old refresh", BOT);
    git(["checkout", "-q", "main"]);
    commit("other.txt", "b\n", "main moved", HUMAN);
    git(["push", "-q", remote, "main"]);
    git(["checkout", "-q", BRANCH]);
    git(["merge", "-q", "--no-ff", "--no-edit", "main"], HUMAN);
    seedBranch();
    const ci = join(dir, "ci");
    execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", "main", `file://${remote}`, ci], { env: baseEnv });
    expect(git(["rev-parse", "--is-shallow-repository"], BOT, ci)).toBe("true");
    git(["checkout", "-q", "--force", "-B", BRANCH, "main"], BOT, ci);
    const base = git(["rev-parse", "HEAD"], BOT, ci);
    writeFileSync(join(ci, "data.json"), "3\n");
    git(["commit", "-q", "-am", "new refresh"], BOT, ci);
    const head = git(["rev-parse", "HEAD"], BOT, ci);
    const runIn = (cmd: "push" | "foreign") =>
      spawnSync(
        "bash",
        [SCRIPT, cmd, "--remote", remote, "--branch", BRANCH, "--base", base, "--bot-email", BOT],
        { cwd: ci, env: as(BOT), encoding: "utf8" },
      );
    expect(runIn("foreign").stdout.trim()).toBe("");
    const r = runIn("push");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(remoteSha()).toBe(head);
  });

  it("refuses a merge commit that carries edits of its own", () => {
    startRun();
    commit("data.json", "2\n", "old refresh", BOT);
    git(["checkout", "-q", "main"]);
    commit("other.txt", "b\n", "main moved", HUMAN);
    git(["push", "-q", remote, "main"]);
    git(["checkout", "-q", BRANCH]);
    git(["merge", "-q", "--no-ff", "--no-commit", "main"], HUMAN);
    writeFileSync(join(work, "fix.txt"), "slipped into the merge\n");
    git(["add", "-A"], HUMAN);
    git(["commit", "-q", "--no-edit"], HUMAN);
    seedBranch();
    const before = remoteSha();
    const base = startRun();
    commit("data.json", "3\n", "new refresh", BOT);
    const r = run("push", base);
    expect(r.status, r.stdout + r.stderr).toBe(3);
    expect(remoteSha()).toBe(before);
  });

  // 2026-10-05/06: GitHub's "Update branch" merged main into
  // bot/refresh/open-auto-tick and resolved a conflict in a regenerated file
  // (OPEN.md/SCOREBOARD.md). That merge is not git's own result, so the bot
  // refused every run after it and nothing was auto-ticked. Edits that stay
  // inside the refresh's declared paths are the bot's to rebuild.
  // @mutate scripts/ci/bot-branch-push.sh |         if [ -n "$auto" ] && git diff --name-only "$auto" "$c^{tree}" \| in_regenerated; then |         if false; then
  // @mutate scripts/ci/bot-branch-push.sh |     [ "$hit" = 1 ] \|\| return 1 |     :
  const conflictedMainMerge = (extra?: string) => {
    startRun();
    commit("data.json", "2\n", "old refresh", BOT);
    git(["checkout", "-q", "main"]);
    commit("data.json", "main\n", "main moved the generated file", HUMAN);
    git(["push", "-q", remote, "main"]);
    git(["checkout", "-q", BRANCH]);
    spawnSync("git", ["merge", "-q", "--no-ff", "--no-edit", "main"], { cwd: work, env: as(HUMAN), encoding: "utf8" });
    writeFileSync(join(work, "data.json"), "resolved by hand\n");
    if (extra) writeFileSync(join(work, extra), "slipped in\n");
    git(["add", "-A"], HUMAN);
    git(["commit", "-q", "--no-edit"], HUMAN);
    seedBranch();
  };
  const runRegen = (base: string, regenerated: string) =>
    spawnSync(
      "bash",
      [SCRIPT, "push", "--remote", remote, "--branch", BRANCH, "--base", base, "--bot-email", BOT, "--regenerated", regenerated],
      { cwd: work, env: as(BOT), encoding: "utf8" },
    );

  it("replaces a conflicted main-merge whose own edits are only in the regenerated files", () => {
    conflictedMainMerge();
    const base = startRun();
    const head = commit("data.json", "3\n", "new refresh", BOT);
    const r = runRegen(base, "data.json\ndocs/");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(remoteSha()).toBe(head);
  });

  it("still refuses that merge when it also edits a file outside the regenerated paths", () => {
    conflictedMainMerge("fix.txt");
    const before = remoteSha();
    const base = startRun();
    commit("data.json", "3\n", "new refresh", BOT);
    const r = runRegen(base, "data.json");
    expect(r.status, r.stdout + r.stderr).toBe(3);
    expect(remoteSha()).toBe(before);
  });

  it("refresh-pr hands its declared paths to the pusher", () => {
    const action = readFileSync(join(ROOT, ".github/actions/refresh-pr/action.yml"), "utf8");
    const pushes = action.split("\n").filter((l) => l.includes('--bot-email "$BOT_EMAIL" --pr "$PR"'));
    expect(pushes.length).toBeGreaterThanOrEqual(2);
    for (const l of pushes) expect(l).toContain('--regenerated "$REFRESH_PATHS"');
  });

  it("only ever pushes bot/* branches", () => {
    const r = spawnSync(
      "bash",
      [SCRIPT, "push", "--remote", remote, "--branch", "main", "--base", "main", "--bot-email", BOT],
      { cwd: work, env: as(BOT), encoding: "utf8" },
    );
    expect(r.status).toBe(2);
  });
});
