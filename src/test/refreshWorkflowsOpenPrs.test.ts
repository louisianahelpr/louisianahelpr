// @mutate .github/workflows/scoreboard.yml | uses: ./.github/actions/refresh-pr | uses: ./.github/actions/nightly-issue-sync
// @mutate .github/workflows/loading-states-refresh.yml | pull-requests: write | pull-requests: read
// @mutate .github/workflows/staleness-watch.yml | if: github.event_name != 'push' && needs.generated-current.result != 'cancelled' | if: needs.generated-current.result != 'cancelled'
// @mutate .github/actions/refresh-pr/action.yml | --auto --squash | --squash
// @mutate .github/actions/refresh-pr/action.yml | if git diff --cached --quiet; then | if false; then
/*
 * CLASS GUARD (docs/OPEN.md Q57): a scheduled workflow that PROVES a committed
 * file stale must also LAND the fresh copy, through the one shared step.
 *
 * Until 2026-09-23 GitHub Actions here could not push or open PRs, so every
 * scheduled re-measurement (loading states, the scoreboard, the write-contract
 * snapshot) ended as a job summary or an artifact and a person had to commit
 * it by hand — which is exactly how numbers went stale. The owner turned on
 * "Read and write" + "Allow GitHub Actions to create and approve pull
 * requests"; .github/actions/refresh-pr now rebuilds ONE bot branch per
 * refresh from latest main, opens or updates ONE PR and enables auto-merge.
 *
 * The inventory is DERIVED, not listed: every workflow with a `schedule:`
 * trigger whose steps run a generator registered in
 * scripts/check-generated-current.mjs (GENERATED or EVIDENCE, directly or via
 * an `npm run` script, or check-generated-current.mjs itself). Each one either
 * uses the shared step in a job of its own that holds the workflow's only
 * write permissions, or is in NOT_LANDED with the reason a bot must not
 * commit its output. Both lists are two-way: an entry the derivation no
 * longer produces, or that uses the step anyway, fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parse } from "yaml";
import {
  GENERATED,
  EVIDENCE,
  // @ts-expect-error — plain .mjs script, no declaration file
} from "../../scripts/check-generated-current.mjs";

const ROOT = resolve(__dirname, "../..");
const WF_DIR = join(ROOT, ".github/workflows");
const ACTION = "./.github/actions/refresh-pr";
const ACTION_FILE = join(ROOT, ".github/actions/refresh-pr/action.yml");

/** Stale-proving scheduled workflows whose output a bot must NOT commit. */
const NOT_LANDED: Record<string, string> = {
  "ui-sweep.yml":
    "the overlay baseline is a findings ratchet: a key may be ADDED only after a person shows the finding is not a regression (spec header), and the spec has no writer mode — auto-landing it would bless new defects",
  "vacuity.yml":
    "its committed output is the --no-mutate static report, the same generator staleness-watch.yml regenerates and lands nightly; a second committer for one file would race it, and this job mutates source for hours before the report step",
  "prod-audit.yml":
    "its `npm run vacuity -- --only` step runs only on a manual vacuity_only dispatch (Q89) to re-prove five service-role guards; the committed vacuity report belongs to staleness-watch.yml, and this job mutates source before any report step",
  "db-drift-detect.yml":
    "a stale types.ts means prod's schema moved: the fix is `npm run db:types` PLUS the code changes the new types force (the workflow's own FIX line), and a drift here can be a migration-ledger mismatch to investigate, not bless",
};

/** Workflows that use the step without running a registered generator. */
const ALSO_LANDED: Record<string, string> = {
  "morning-page.yml":
    "docs/morning/<date>.md is a DATED daily record (WRITES_NOT_COMMITTED in check-generated-current.mjs), not a living inventory; Q67 is ticked when the first one lands on main through this step",
  "ios-icon-sync.yml":
    "regenerates the AppIcon set via `bundle exec fastlane ios sync_app_icon`, not a scripts/check-generated-current.mjs generator; Q285 moved its old direct `git push` onto this shared step because a manual dispatch on main was rejected by branch protection",
  "ios-metadata.yml":
    "regenerates the Xcode project/Info.plist/capacitor.config.ts and the App Store name/URL/category files via `bundle exec fastlane ios sync_xcode_metadata`, not a scripts/check-generated-current.mjs generator; Q285 moved its old direct `git push` onto this shared step for the same branch-protection reason",
};

type Step = { run?: string; uses?: string; with?: Record<string, unknown> };
type Job = { steps?: Step[]; permissions?: Record<string, string> | string; if?: string; needs?: string | string[] };
type Wf = { file: string; on: Record<string, unknown>; permissions?: Record<string, string> | string; jobs: Record<string, Job> };

const pkgScripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

const workflows: Wf[] = readdirSync(WF_DIR)
  .filter((f) => f.endsWith(".yml"))
  .map((file) => {
    const d = parse(readFileSync(join(WF_DIR, file), "utf8")) as Record<string | number, unknown>;
    const on = (d.on ?? d["true"]) as unknown;
    return {
      file,
      on: on && typeof on === "object" ? (on as Record<string, unknown>) : {},
      permissions: d.permissions as Wf["permissions"],
      jobs: (d.jobs ?? {}) as Record<string, Job>,
    };
  });

/** Words that identify a registered generator in a `run:` block. */
export function generatorNeedles(): string[] {
  const scripts = [...(GENERATED as { script: string }[]), ...(EVIDENCE as { script: string }[])].map((g) => g.script);
  scripts.push("scripts/check-generated-current.mjs");
  const out = new Set<string>();
  for (const s of scripts) {
    out.add(s);
    // A spec is selected by its bare name (`playwright test overlay-sweep`).
    if (s.endsWith(".spec.ts")) out.add(basename(s, ".spec.ts"));
  }
  return [...out];
}

function runs(w: Wf): string {
  return Object.values(w.jobs).flatMap((j) => (j.steps ?? []).map((s) => (typeof s.run === "string" ? s.run : ""))).join("\n");
}

export function staleProving(all: Wf[], needles = generatorNeedles()): string[] {
  const hit = (text: string) => needles.some((n) => new RegExp(`(^|[^\\w/.-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`, "m").test(text));
  return all
    .filter((w) => "schedule" in w.on)
    .filter((w) => {
      const text = runs(w);
      if (hit(text)) return true;
      return [...text.matchAll(/npm run ([\w:.-]+)/g)].some((m) => hit(pkgScripts[m[1]] ?? ""));
    })
    .map((w) => w.file)
    .sort();
}

const landJobs = (w: Wf) => Object.entries(w.jobs).filter(([, j]) => (j.steps ?? []).some((s) => s.uses === ACTION));
const grantsWrite = (p: Job["permissions"]) =>
  p === "write-all" || (typeof p === "object" && p !== null && (p.contents === "write" || p["pull-requests"] === "write"));

describe("scheduled refresh workflows land their files through ONE auto-merging PR (Q57)", () => {
  const derived = staleProving(workflows);
  const users = workflows.filter((w) => landJobs(w).length > 0).map((w) => w.file).sort();

  it("the inventory is real (floors: a derivation that finds nothing must fail)", () => {
    expect(generatorNeedles().length).toBeGreaterThanOrEqual(12);
    expect(derived.length).toBeGreaterThanOrEqual(7);
    expect(derived).toContain("scoreboard.yml");
    expect(derived).toContain("loading-states-refresh.yml");
    expect(users.length).toBeGreaterThanOrEqual(5);
  });

  it("every stale-proving scheduled workflow uses the shared refresh step (or says why not)", () => {
    const missing = derived.filter((f) => !(f in NOT_LANDED) && !users.includes(f));
    expect(missing, `These prove a committed file stale on a schedule but cannot land the fresh copy. Add a land job using ${ACTION} (see scoreboard.yml), or list the file in NOT_LANDED with the reason a bot must not commit it.`).toEqual([]);
  });

  it("the step's users are exactly the derived set plus ALSO_LANDED (two-way)", () => {
    const expected = [...derived.filter((f) => !(f in NOT_LANDED)), ...Object.keys(ALSO_LANDED)].sort();
    expect(users).toEqual(expected);
    for (const f of Object.keys(NOT_LANDED)) {
      expect(derived, `NOT_LANDED lists ${f}, which no longer proves a registered file stale on a schedule — remove it`).toContain(f);
      expect(users, `NOT_LANDED lists ${f}, but it uses the step — remove it from NOT_LANDED`).not.toContain(f);
    }
    for (const f of Object.keys(ALSO_LANDED)) {
      expect(derived, `${f} is now derived; move it out of ALSO_LANDED`).not.toContain(f);
    }
    for (const why of [...Object.values(NOT_LANDED), ...Object.values(ALSO_LANDED)]) expect(why.length).toBeGreaterThan(60);
  });

  it("write permissions live ONLY on the land job; it never runs on push/PR; one id per refresh", () => {
    const ids = new Map<string, string>();
    const problems: string[] = [];
    for (const w of workflows.filter((x) => users.includes(x.file))) {
      if (grantsWrite(w.permissions)) problems.push(`${w.file}: top-level permissions grant write — put contents/pull-requests: write on the land job only`);
      const lands = landJobs(w);
      if (lands.length !== 1) problems.push(`${w.file}: ${lands.length} jobs use the step (want exactly one)`);
      for (const [name, j] of Object.entries(w.jobs)) {
        const isLand = lands.some(([n]) => n === name);
        if (!isLand && grantsWrite(j.permissions)) problems.push(`${w.file}/${name}: grants contents or pull-requests write but does not land a refresh`);
        if (!isLand) continue;
        const p = (typeof j.permissions === "object" ? j.permissions : {}) as Record<string, string>;
        if (p.contents !== "write" || p["pull-requests"] !== "write") problems.push(`${w.file}/${name}: needs explicit permissions contents: write + pull-requests: write`);
        if (("push" in w.on || "pull_request" in w.on) && !/github\.event_name != 'push'/.test(j.if ?? "")) problems.push(`${w.file}/${name}: the workflow runs on push/PR, so the land job must be gated \`github.event_name != 'push'\` (a refresh PR per push would race the pusher)`);
        const step = (j.steps ?? []).find((s) => s.uses === ACTION)!;
        const id = String(step.with?.id ?? "");
        if (!/^[a-z0-9-]+$/.test(id)) problems.push(`${w.file}/${name}: step id "${id}" is not a slug`);
        if (ids.has(id)) problems.push(`${w.file}: refresh id "${id}" also used by ${ids.get(id)} — two workflows would force-push one bot branch`);
        ids.set(id, w.file);
        if (!String(step.with?.["github-token"] ?? "").includes("REFRESH_PR_TOKEN")) problems.push(`${w.file}/${name}: github-token must prefer secrets.REFRESH_PR_TOKEN`);
        if (!String(step.with?.paths ?? "").trim()) problems.push(`${w.file}/${name}: no paths`);
      }
      if (/\bgit\s+push\b/.test(runs(w))) problems.push(`${w.file}: a run step pushes with git itself — only the shared step may push, and only to its bot branch`);
      const notify = Object.values(w.jobs).find((j) => (j.steps ?? []).some((s) => String(s.uses ?? "").includes("nightly-issue-sync")));
      const needs = notify ? ([] as string[]).concat(notify.needs ?? []) : [];
      if (notify && !lands.every(([n]) => needs.includes(n))) problems.push(`${w.file}: the notify job does not need the land job, so a failed landing never reaches nightly-red`);
    }
    expect(problems).toEqual([]);
  });

  it("the shared step: latest main, one bot branch, skip when unchanged, update not stack, auto-merge, never main", () => {
    const text = readFileSync(ACTION_FILE, "utf8");
    const action = parse(text) as { runs: { using: string; steps: { run: string }[] } };
    expect(action.runs.using).toBe("composite");
    const run = action.runs.steps.map((s) => s.run ?? "").join("\n");
    expect(run).toMatch(/BRANCH="bot\/refresh\/\$REFRESH_ID"/);
    expect(run).toMatch(/refs\/heads\/main:refs\/remotes\/origin\/main/);
    expect(run).toMatch(/checkout -q --force -B "\$BRANCH" origin\/main/);
    expect(run).toMatch(/if git diff --cached --quiet; then/);
    expect(run).toMatch(/gh pr list [^\n]*--head "\$BRANCH" --state open/);
    expect(run).toMatch(/gh pr merge "\$PR" [^\n]*--auto --squash/);
    const pushes = [...run.matchAll(/git\b[^\n]*\bpush\b[^\n]*/g)].map((m) => m[0]);
    expect(pushes.length).toBeGreaterThanOrEqual(1);
    for (const p of pushes) expect(p, "the step may push only to its bot branch").toMatch(/"HEAD:refs\/heads\/\$BRANCH"$/);
    expect(run).not.toMatch(/refs\/heads\/main"?\s*$/m);
  });

  it("derivation fixtures: a new scheduled generator run is found; unscheduled or unrelated ones are not", () => {
    const wf = (file: string, on: Record<string, unknown>, run: string): Wf => ({ file, on, jobs: { a: { steps: [{ run }] } } });
    const got = staleProving([
      wf("a.yml", { schedule: [] }, "node scripts/burndown-score.mjs"),
      wf("b.yml", { schedule: [] }, "npm run inventories:refresh"),
      wf("c.yml", { push: {} }, "node scripts/burndown-score.mjs"),
      wf("d.yml", { schedule: [] }, "gh run list --workflow scoreboard.yml"),
      wf("e.yml", { schedule: [] }, "npx playwright test overlay-sweep"),
    ]);
    expect(got).toEqual(["a.yml", "b.yml", "e.yml"]);
  });
});

/*
 * CLASS GUARD (Q285): NO workflow may push with git directly. ios-icon-sync.yml
 * and ios-metadata.yml each ended their "commit" step with a plain `git push`
 * using github.token — on a dispatch against `main` that push is rejected by
 * branch protection, so both workflows regenerated their files and then died
 * on the last step. Both were moved onto .github/actions/refresh-pr (this
 * file's own subject above): it rebuilds ONE bot branch from latest main,
 * opens/updates ONE PR and auto-merges it, and is itself the ONLY thing
 * allowed to push (only ever to its own `bot/refresh/<id>` branch, never
 * `main` — already asserted above).
 *
 * The inventory here is every file in .github/workflows (not
 * .github/actions — the composite lives there and is the one allowed
 * pusher, so it is out of scope by construction). Comments are stripped
 * first (whole-line, same convention as workflowFalseGreenShapes.test.ts's
 * `logicalLines`) so a comment that happens to mention "git push" in prose
 * cannot fail this guard, and so a `#`-commented-out `git push` cannot hide
 * from it either way — only live run-step text counts.
 */
describe("no workflow pushes with git directly — refresh-pr is the only pusher (Q285)", () => {
  /** Whole-line `#` comments dropped; a run step's shell text, not YAML. */
  function stripLineComments(text: string): string {
    return text
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
  }

  const GIT_PUSH = /\bgit\s+push\b/;

  function offenders(all: Wf[]): string[] {
    return all
      .filter((w) => GIT_PUSH.test(stripLineComments(runs(w))))
      .map((w) => w.file)
      .sort();
  }

  it("the detector matches a real `git push` run step and ignores one mentioned only in a comment (a check that finds nothing cannot fail)", () => {
    const wf = (file: string, run: string): Wf => ({ file, on: {}, jobs: { a: { steps: [{ run }] } } });
    // The exact shape ios-icon-sync.yml and ios-metadata.yml carried before
    // Q285: a plain `git push` as the last line of a "commit" step.
    expect(
      offenders([wf("x.yml", 'git config user.name "github-actions[bot]"\ngit add foo\ngit commit -m "x"\ngit push')]),
    ).toEqual(["x.yml"]);
    expect(offenders([wf("y.yml", "# do not git push here\necho hi")])).toEqual([]);
  });

  it("neither ios-icon-sync.yml nor ios-metadata.yml pushes directly any more (Q285)", () => {
    const named = workflows.filter((w) => w.file === "ios-icon-sync.yml" || w.file === "ios-metadata.yml");
    expect(named.map((w) => w.file).sort()).toEqual(["ios-icon-sync.yml", "ios-metadata.yml"]);
    expect(offenders(named)).toEqual([]);
  });

  it("no workflow in .github/workflows contains a `git push` run step", () => {
    expect(offenders(workflows)).toEqual([]);
  });
});
