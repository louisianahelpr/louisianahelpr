/**
 * A DISABLED WORKFLOW IS A RED, SCHEDULED OR NOT (docs/OPEN.md Q1652).
 *
 * open-auto-tick.yml runs on `workflow_run` (after each prod deploy), not on a
 * cron, so schedule-heartbeat's WATCHED loop never looked at it. It sat
 * `disabled_manually` from 2026-10-07T00:19Z to 2026-10-12T03:46Z: five days in
 * which no `[~]` item was auto-ticked after a deploy, and no alert fired (the
 * SCOREBOARD showed it FAIL "runs nothing", and nobody reads the SCOREBOARD for
 * alerts).
 *
 * This lists EVERY workflow in the repo (the Actions API, never a hand list)
 * and reports each whose state is not `active` and whose file has no
 * `schedule:` trigger (a scheduled one is already reported by the heartbeat's
 * WATCHED loop, which scheduleHeartbeatWatchesEveryCron.test.ts keeps equal to
 * the cron files). A workflow left off on purpose goes in INTENTIONALLY_OFF
 * with its reason; the list is exact: an entry that is active again, or whose
 * file is gone, is itself a red row.
 *
 *   node scripts/ci/disabled-workflows.mjs   (needs gh + GH_TOKEN, REPO)
 *
 * Prints one markdown table row per finding, then `disabled=<n>` last.
 * Exits 2 when the workflow list could not be read: not checked is not clean.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** file -> why it stays off. Empty on 2026-10-12 (every workflow measured `active`). */
export const INTENTIONALLY_OFF = {};

const hasSchedule = (src) => /^\s*schedule:\s*$/m.test(src);

/**
 * Judge the API's workflow list. `workflows`: [{ path, state }]; `readFile(file)`
 * returns the workflow source or null when the file is not in the checkout.
 * Returns the red rows (markdown) and their count.
 */
export function judgeWorkflows(workflows, readFile, allow = INTENTIONALLY_OFF) {
  const rows = [];
  const seen = new Set();
  for (const w of workflows) {
    const file = String(w.path ?? "").replace(/^\.github\/workflows\//, "");
    if (!/\.ya?ml$/.test(file)) continue; // dynamic workflows (CodeQL default setup, Copilot) carry no file here
    if (w.state === "deleted") continue; // its file is gone; the API keeps listing it while it has run history
    seen.add(file);
    const src = readFile(file);
    if (w.state === "active") {
      if (file in allow) rows.push(`| \`${file}\` | active | — | 🔴 INTENTIONALLY_OFF lists it but it is active: remove the entry |`);
      continue;
    }
    if (file in allow) continue;
    if (src !== null && hasSchedule(src)) continue; // the WATCHED loop reports it
    rows.push(`| \`${file}\` | **state: ${w.state}** | — | 🔴 disabled (not scheduled): \`gh workflow enable ${file}\`, or list it in INTENTIONALLY_OFF with why |`);
  }
  for (const file of Object.keys(allow)) {
    if (!seen.has(file)) rows.push(`| \`${file}\` | gone | — | 🔴 INTENTIONALLY_OFF lists a workflow that no longer exists |`);
  }
  return { rows, count: rows.length };
}

function listWorkflows(repo) {
  const out = execFileSync("gh", ["api", "--paginate", `repos/${repo}/actions/workflows?per_page=100`, "--jq", ".workflows[] | {path, state}"], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repo = process.env.REPO;
  let workflows;
  try {
    if (!repo) throw new Error("REPO is not set");
    workflows = listWorkflows(repo);
    if (!workflows.length) throw new Error("the API listed no workflows");
  } catch (e) {
    console.error(`::error::disabled-workflows: could not list the workflows (${e instanceof Error ? e.message : e})`);
    process.exit(2);
  }
  const dir = resolve(process.cwd(), ".github/workflows");
  const readFile = (f) => (existsSync(resolve(dir, f)) ? readFileSync(resolve(dir, f), "utf8") : null);
  const { rows, count } = judgeWorkflows(workflows, readFile);
  for (const r of rows) console.log(r);
  for (const r of rows) console.error(`::error::${r.replace(/[|`*]/g, " ").replace(/\s+/g, " ").trim()}`);
  console.log(`disabled=${count}`);
}
