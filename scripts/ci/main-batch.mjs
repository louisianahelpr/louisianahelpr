/**
 * MAIN BATCH DISPATCHER (owner, 2026-10-02: stay on GitHub Free, trim CI).
 *
 * The heavy non-required checks of main used to run on EVERY push to main,
 * which on GitHub Free's 20-job cap queued the required checks behind them.
 * .github/workflows/main-batch.yml runs this on push and every 20 minutes
 * (the prod-deploy.yml pattern). For each target it dispatches ONE run of
 * main HEAD with `batch: true`, but only when:
 *   - the newest non-cancelled batch run is not already of HEAD, and
 *   - that batch run is at least DEBOUNCE_MS old (at most one per ~15 min), and
 *   - for a target with `paths`, a file matching them changed since that
 *     batch's commit (ui-sweep: the list that was its in-job paths-filter).
 * Every unknown dispatches (fail closed): no prior batch, an unreadable or
 * truncated compare. Any gh error throws, so the workflow goes red.
 *
 * A batch run is titled "<workflow> (main batch <sha>)" by the target's
 * run-name. That title is how this script finds earlier batches, how
 * main-red-watch.yml reports a red batch, and how the shared-accounts lock
 * (scripts/e2e/wait-shared-accounts.mjs, scripts/canary/shared-accounts-busy.mjs)
 * knows the run touches no shared account.
 *
 *   node scripts/ci/main-batch.mjs   (needs gh, GH_TOKEN, GITHUB_REPOSITORY)
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The run-name marker every batch run carries. */
export const BATCH_MARK = "(main batch ";

/** At most one batch per target per this long (cron is every 20 min). */
export const DEBOUNCE_MS = 15 * 60 * 1000;

/** GitHub's compare API lists at most 300 files; at or past it the list may be truncated. */
export const COMPARE_FILE_CAP = 300;

/** What makes an empty-state sweep worth re-running. Moved verbatim from ui-sweep.yml's old paths-filter step. */
export const UI_PATHS = [
  "src/**",
  "public/**",
  "index.html",
  "vite.config.ts",
  "tailwind.config.ts",
  "package.json",
  "package-lock.json",
  "playwright.config.ts",
  "e2e/happy-path/**",
  ".github/workflows/ui-sweep.yml",
];

/** The workflows dispatched as main batches. A target without `paths` runs for every new HEAD. */
export const TARGETS = [
  { file: "e2e-real-backend.yml", paths: [] },
  { file: "ui-sweep.yml", paths: UI_PATHS },
];

/** Does `file` match any pattern (exact path, or `dir/**` prefix)? */
export function matchesPaths(file, patterns) {
  return patterns.some((p) => (p.endsWith("/**") ? file.startsWith(p.slice(0, -2)) : file === p));
}

/** Earlier batch runs, newest first, ignoring cancelled ones (a cancelled run checked nothing). */
export function batchRuns(runs) {
  return runs
    .filter((r) => typeof r.display_title === "string" && r.display_title.includes(BATCH_MARK) && r.conclusion !== "cancelled")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/**
 * Decide one target. `changedFiles` is the file list from the last batch's
 * commit to HEAD, or null when it could not be read.
 * Returns { action: "dispatch" | "skip", reason, base }.
 */
export function decide({ head, runs, now, paths = [], changedFiles = null }) {
  const last = batchRuns(runs)[0];
  if (!last) return { action: "dispatch", reason: "no earlier main batch", base: null };
  if (last.head_sha === head) return { action: "skip", reason: `HEAD ${head.slice(0, 9)} already batched`, base: last.head_sha };
  const age = now - Date.parse(last.created_at);
  if (!(age >= DEBOUNCE_MS)) return { action: "skip", reason: `last batch is ${Math.round(age / 60000)} min old (< ${DEBOUNCE_MS / 60000})`, base: last.head_sha };
  if (paths.length > 0 && Array.isArray(changedFiles) && changedFiles.length > 0 && changedFiles.length < COMPARE_FILE_CAP) {
    if (!changedFiles.some((f) => matchesPaths(f, paths))) {
      return { action: "skip", reason: `none of ${changedFiles.length} changed file(s) is a watched path`, base: last.head_sha };
    }
  }
  return { action: "dispatch", reason: `HEAD moved past ${last.head_sha.slice(0, 9)}`, base: last.head_sha };
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  const head = gh(["api", `repos/${repo}/commits/main`, "--jq", ".sha"]).trim();
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error(`could not read main HEAD (got "${head}")`);
  const now = Date.now();
  for (const t of TARGETS) {
    const runs = JSON.parse(gh(["api", `repos/${repo}/actions/workflows/${t.file}/runs?event=workflow_dispatch&branch=main&per_page=30`, "--jq", ".workflow_runs"]));
    let changedFiles = null;
    const prior = batchRuns(runs)[0];
    if (t.paths.length > 0 && prior && prior.head_sha !== head) {
      try {
        changedFiles = JSON.parse(gh(["api", `repos/${repo}/compare/${prior.head_sha}...${head}`, "--jq", "[.files[].filename]"]));
      } catch (e) {
        console.log(`::warning::${t.file}: compare ${prior.head_sha.slice(0, 9)}...${head.slice(0, 9)} failed, dispatching anyway (${String(e.message).split("\n")[0]})`);
      }
    }
    const d = decide({ head, runs, now, paths: t.paths, changedFiles });
    console.log(`${t.file}: ${d.action} -- ${d.reason}`);
    if (d.action === "dispatch") gh(["workflow", "run", t.file, "--repo", repo, "--ref", "main", "-f", "batch=true"]);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
