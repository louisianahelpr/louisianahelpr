#!/usr/bin/env node
/**
 * `npm run release:gate -- <sha>` — the pre-release gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * `bundle exec fastlane ios beta` (local, the way TestFlight builds are cut)
 * and .github/workflows/ios-beta.yml both archived whatever the checkout held
 * and uploaded it. Nothing between "the audits are green" and "this build is
 * on a tester's phone" checked that the audits were green FOR THIS COMMIT:
 * Test was red at HEAD on 2026-09-12 and nothing in the release path would
 * have said so. A local `npm run typecheck` is not evidence either — it is
 * one machine's opinion of one check.
 *
 * So this script asks GitHub Actions, for the exact sha being shipped, whether
 * every required workflow ran to green. It trusts NOTHING local: no vitest
 * output, no "it was green yesterday", no run on a neighbouring commit.
 *
 * WHAT COUNTS AS GREEN
 * --------------------
 * A run counts only when, for that exact head sha:
 *   · its conclusion is `success` (not cancelled, not skipped, not in flight);
 *   · at least one job matching the check's `job` pattern itself concluded
 *     `success`. Several of these workflows have a cheap gatekeeper job that
 *     skips the real one (a11y-axe skips its legs on a docs-only diff; the
 *     journeys skip when the account secrets are missing) — and a run whose
 *     only successes are the gatekeeper is a green run in which the audit did
 *     not happen. That is the hole this clause closes.
 * The newest completed run for the sha decides; an older red is superseded by
 * a later green re-run, which is what a re-run is for.
 *
 * USAGE
 *   node scripts/release-gate.mjs <sha>            report; exit 1 unless all green
 *   node scripts/release-gate.mjs <sha> --dispatch  also start every workflow
 *                                                   that is missing or red for
 *                                                   that sha, then exit 1 (the
 *                                                   gate is still not met —
 *                                                   re-run once they finish)
 *   node scripts/release-gate.mjs <sha> --json      machine-readable result
 *   node scripts/release-gate.mjs <sha> --wait      poll until nothing is in
 *                                                   flight, then decide
 *
 * `--dispatch` uses `workflow_dispatch`, which takes a branch or tag, never a
 * sha. When the sha is the tip of origin/main it dispatches on `main`;
 * otherwise it pushes a lightweight tag `release-gate/<sha7>` at the sha and
 * dispatches on that, so the run's head sha is the one being gated.
 *
 * REQUIRES `gh` authenticated for the repo (`gh auth status`). No other
 * credentials; nothing is written except the optional tag.
 */
import { execFileSync, spawnSync } from "node:child_process";

/**
 * The audits a build must pass. `workflow` is the workflow name as GitHub
 * reports it (the `name:` key of the file); `file` is what `gh workflow run`
 * takes; `job` must match at least one job that concluded success.
 *
 * Every entry here is a workflow that runs against PROD or the real bundle:
 * the owner's standing order is that mocked results never count as
 * verification, and press-every-control / the a11y sweeps are being moved to
 * prod by their owning lanes — the gate keys on the workflow names, so it
 * picks those up the day they land.
 */
export const REQUIRED_CHECKS = [
  { id: "test", workflow: "Test", file: "test.yml", job: /^Lint, type-check, build, test/ },
  { id: "e2e-real-backend", workflow: "E2E real backend", file: "e2e-real-backend.yml", job: /^Authenticated journeys/ },
  { id: "journeys", workflow: "E2E user journeys", file: "e2e-journeys.yml", job: /^Journeys \(/ },
  { id: "press-every-control", workflow: "Press every control", file: "press-every-control.yml", job: /^Press every control/ },
  // The ONE a11y sweep: prod, Chromium + WebKit, then the engine diff. The
  // mocked a11y-axe.yml is not a release check (owner: mocked results never
  // count as verification).
  { id: "a11y-prod", workflow: "A11y in WebKit (prod)", file: "a11y-webkit-prod.yml", job: /^WebKit-only violations/ },
  { id: "write-contract", workflow: "Write contract snapshot refresh", file: "write-contract-refresh.yml", job: /^refresh$/ },
];

function gh(args, opts = {}) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function resolveSha(ref) {
  const sha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`could not resolve ${ref} to a commit`);
  return sha;
}

/** Newest completed run per workflow name for this sha, plus anything still running. */
function runsForSha(sha) {
  const runs = ghJson([
    "run", "list", "--commit", sha, "--limit", "100",
    "--json", "databaseId,workflowName,conclusion,status,event,createdAt,url,headSha",
  ]);
  // gh's --commit filter is exact on headSha, but make the contract explicit.
  return runs.filter((r) => r.headSha === sha).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function jobsForRun(id) {
  return ghJson(["run", "view", String(id), "--json", "jobs"]).jobs ?? [];
}

/**
 * One verdict per required check:
 *   green   – newest completed run succeeded and the real job ran
 *   red     – newest completed run did not succeed (failure/cancelled/…)
 *   hollow  – run succeeded but every audit job was skipped
 *   running – nothing completed yet, a run is in flight
 *   missing – no run at all for this sha
 */
export function evaluate(sha, runs, jobsFor = jobsForRun) {
  return REQUIRED_CHECKS.map((check) => {
    const mine = runs
      .filter((r) => r.workflowName === check.workflow)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const inFlight = mine.find((r) => r.status !== "completed");
    const done = mine.find((r) => r.status === "completed");
    if (!done) {
      return { ...check, state: inFlight ? "running" : "missing", run: inFlight ?? null };
    }
    if (done.conclusion !== "success") {
      return { ...check, state: inFlight ? "running" : "red", run: done, conclusion: done.conclusion };
    }
    const jobs = jobsFor(done.databaseId);
    const auditJobs = jobs.filter((j) => check.job.test(j.name));
    const ran = auditJobs.some((j) => j.conclusion === "success");
    return { ...check, state: ran ? "green" : "hollow", run: done, jobs: auditJobs.map((j) => `${j.name}=${j.conclusion}`) };
  });
}

function dispatchRef(sha) {
  let mainTip = "";
  try {
    mainTip = git(["rev-parse", "--verify", "origin/main^{commit}"]);
  } catch {
    /* no origin/main locally — fall through to the tag */
  }
  if (mainTip === sha) return "main";
  const tag = `release-gate/${sha.slice(0, 7)}`;
  const exists = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", tag], { encoding: "utf8" }).status === 0;
  if (!exists) {
    execFileSync("git", ["tag", "-f", tag, sha], { stdio: "inherit" });
    execFileSync("git", ["push", "origin", `refs/tags/${tag}`], { stdio: "inherit" });
  }
  return tag;
}

function dispatch(sha, verdicts) {
  const todo = verdicts.filter((v) => v.state === "missing" || v.state === "red" || v.state === "hollow");
  if (!todo.length) return [];
  const ref = dispatchRef(sha);
  const started = [];
  for (const v of todo) {
    try {
      gh(["workflow", "run", v.file, "--ref", ref]);
      started.push(`${v.workflow} (${v.file} @ ${ref})`);
    } catch (e) {
      started.push(`${v.workflow}: DISPATCH FAILED — ${String(e.stderr || e.message).trim().split("\n")[0]}`);
    }
  }
  return started;
}

function describe(v) {
  const where = v.run?.url ? ` ${v.run.url}` : "";
  switch (v.state) {
    case "green": return `  ✓ ${v.id.padEnd(20)} green${where}`;
    case "red": return `  ✗ ${v.id.padEnd(20)} RED (${v.conclusion})${where}`;
    case "hollow": return `  ✗ ${v.id.padEnd(20)} HOLLOW — run is green but no audit job ran [${(v.jobs ?? []).join(", ") || "no matching job"}]${where}`;
    case "running": return `  … ${v.id.padEnd(20)} still running${where}`;
    case "missing": return `  ✗ ${v.id.padEnd(20)} MISSING — no run of "${v.workflow}" for this sha`;
    default: return `  ? ${v.id} ${v.state}`;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const ref = argv.find((a) => !a.startsWith("--")) ?? "HEAD";
  const sha = resolveSha(ref);
  const wantJson = flags.has("--json");

  const pollMs = 60_000;
  let verdicts;
  for (;;) {
    verdicts = evaluate(sha, runsForSha(sha));
    const running = verdicts.some((v) => v.state === "running");
    if (!flags.has("--wait") || !running) break;
    if (!wantJson) console.error(`release-gate: ${sha.slice(0, 7)} still has runs in flight — polling again in ${pollMs / 1000}s`);
    await new Promise((r) => setTimeout(r, pollMs));
  }

  const blocking = verdicts.filter((v) => v.state !== "green");
  const started = flags.has("--dispatch") ? dispatch(sha, verdicts) : [];

  if (wantJson) {
    console.log(JSON.stringify({ sha, ok: blocking.length === 0, checks: verdicts.map(({ job: _job, ...v }) => v), dispatched: started }, null, 2));
  } else {
    console.log(`release-gate: ${sha} — ${REQUIRED_CHECKS.length} required checks on GitHub Actions`);
    for (const v of verdicts) console.log(describe(v));
    if (started.length) {
      console.log("\ndispatched:");
      for (const s of started) console.log(`  → ${s}`);
    }
    if (blocking.length) {
      console.log(
        `\nRELEASE BLOCKED: ${blocking.length} of ${REQUIRED_CHECKS.length} checks not green for ${sha.slice(0, 7)} ` +
          `(${blocking.map((v) => `${v.id}:${v.state}`).join(", ")}).` +
          (started.length ? " Re-run this gate once the dispatched workflows finish." : " Pass --dispatch to start the missing ones."),
      );
    } else {
      console.log(`\nrelease-gate: all ${REQUIRED_CHECKS.length} checks green for ${sha.slice(0, 7)} — clear to ship.`);
    }
  }
  process.exit(blocking.length ? 1 : 0);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`release-gate: ${e.message}`);
    process.exit(2);
  });
}
