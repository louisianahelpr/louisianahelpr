#!/usr/bin/env node
/**
 * Q2395: is the previous refresh PR still open with a red check?
 *
 * A scheduled refresh (scoreboard.yml's `land` job) re-uses ONE bot branch and PR (.github/actions/refresh-pr).
 * The job went green as soon as the PR was opened or updated, so a refresh PR that a red required check kept from
 * merging stayed silent for days: #3550 left the land queue on 'Vitest unit tests' on 10-22, 10-24, 10-26 and 10-29
 * while every scoreboard run concluded success, and docs/SCOREBOARD.md went 11 days without landing.
 *
 * Run BEFORE the refresh replaces the branch (a force-push resets the PR's checks). Writes `red=true|false|unknown`
 * and `message` to $GITHUB_OUTPUT; the workflow fails a later step unless red is false. A gh failure is `unknown`,
 * never false: we could not look, so we do not call it green.
 *
 *   node scripts/ci/previous-refresh-pr-red.mjs bot/refresh/scoreboard
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Check outcomes that keep a PR from merging. CANCELLED/SKIPPED/NEUTRAL are not red: a superseded run is cancelled. */
export const RED = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED", "ERROR"]);

/**
 * The open PRs that carry at least one red check, with the red checks' names.
 * `prs` is `gh pr list --json number,url,statusCheckRollup`: check runs carry name + conclusion, commit statuses
 * carry context + state.
 */
export function redPrs(prs) {
  const out = [];
  for (const pr of prs ?? []) {
    const red = (pr.statusCheckRollup ?? [])
      .filter((c) => RED.has(String(c.conclusion ?? c.state ?? "").toUpperCase()))
      .map((c) => c.name ?? c.context ?? "unnamed check");
    if (red.length) out.push({ number: pr.number, url: pr.url, red: [...new Set(red)] });
  }
  return out;
}

/** One line for the job log and the nightly-red issue. */
export function verdict(prs) {
  const red = redPrs(prs);
  if (!red.length) return { red: "false", message: "no open refresh PR has a red check" };
  const parts = red.map((p) => `#${p.number} (${p.red.join(", ")})`);
  return { red: "true", message: `the previous refresh PR is still open and red, so the last re-measurement never landed: ${parts.join("; ")}. Fix the red check on that PR; this run updated its branch.` };
}

function main() {
  const head = process.argv[2];
  if (!head) {
    console.error("usage: previous-refresh-pr-red.mjs <head-branch>");
    process.exit(2);
  }
  let result;
  try {
    const json = execFileSync("gh", ["pr", "list", "--head", head, "--state", "open", "--limit", "1000", "--json", "number,url,statusCheckRollup"], { encoding: "utf8" });
    result = verdict(JSON.parse(json));
  } catch (err) {
    result = { red: "unknown", message: `could not read the open refresh PRs for ${head}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
  console.log(`${result.red}: ${result.message}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `red=${result.red}\nmessage=${result.message.replace(/\n/g, " ")}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
