#!/usr/bin/env node
/**
 * Vercel usage alert — how close is the team to a plan limit? (Pro since 2026-10-03, Q1152; Q221)
 *
 * docs/OPEN.md 2026-09-14 ("Vercel usage alert", owner: "finish up"). Reads
 * the last 7 days of GET /v1/billing/charges (FOCUS v1.3 JSONL) for team
 * team_UQHppAVoPIPQbyh2b43y21BG and compares five metrics — Edge Requests,
 * Fast Data Transfer, Function Invocations, Build Minutes, Deployment
 * Storage — against the monthly included amounts of the team's plan
 * (PLAN_LIMITS in scripts/lib/quotaMonitor.mjs, the one definition; the
 * 7-day window is projected to 30 days before grading). All the
 * maths, the metric table (with its source-URL citations) and the FOCUS
 * JSONL parsing live in scripts/lib/vercelUsage.mjs, tested in
 * src/test/checkVercelUsage.test.ts; this file is only env/IO plumbing.
 *
 * No VERCEL_TOKEN repo secret -> prints ONE skip line and exits 0 (green).
 * The "Plan not found" 404 (docs/OPEN.md Q720 on Hobby: no billing-cycle
 * usage export, checked 2026-09-27, no alternative endpoint exists; still 404
 * on Pro, measured 2026-10-04, Q1152) -> ::warning and exits 0, with the report and summary saying
 * UNMEASURED, never "ok"/"under quota" — a loud, non-failing gap, not a
 * green pretending to have measured something.
 * Any OTHER 401/404/5xx or a network failure -> ::error and exit 1 (red),
 * but the `warn`/`summary` outputs are deliberately never written on that
 * path, so the workflow's Slack step (gated on `outputs.warn == 'true'`)
 * cannot fire — a broken token fails this step loudly without ever paging
 * Slack.
 *
 * Outputs (GITHUB_OUTPUT): skip=true|false, warn=true|false, summary=<line>.
 * Writes vercel-usage-report.md always (except on the fail path, where
 * there is nothing measured yet to report).
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { PLAN, TEAM_ID, runVercelUsageCheck } from "./lib/vercelUsage.mjs";

const THRESHOLD = Number(process.env.WARN_AT_PERCENT || 80);
const TEAM = process.env.VERCEL_TEAM_ID || TEAM_ID;
const WINDOW_DAYS = 7;
const to = new Date();
const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

function writeOutputs(kv) {
  if (!process.env.GITHUB_OUTPUT) return;
  const body = Object.entries(kv)
    .map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, " ")}\n`)
    .join("");
  appendFileSync(process.env.GITHUB_OUTPUT, body);
}

const result = await runVercelUsageCheck({
  token: process.env.VERCEL_TOKEN,
  teamId: TEAM,
  from: from.toISOString(),
  to: to.toISOString(),
  thresholdPercent: THRESHOLD,
  windowDays: WINDOW_DAYS,
});

if (result.outcome === "skip") {
  console.log(result.message);
  writeFileSync("vercel-usage-report.md", `## Vercel ${PLAN} usage\n\nSKIPPED — ${result.message}\n`);
  writeOutputs({ skip: "true", warn: "false", summary: result.summary });
  process.exit(0);
}

if (result.outcome === "unmeasured") {
  console.log(`::warning::${result.message}`);
  writeFileSync(
    "vercel-usage-report.md",
    `## Vercel ${PLAN} usage\n\nUNMEASURED — ${result.message}\n`,
  );
  writeOutputs({ skip: "false", warn: "false", summary: "UNMEASURED — " + result.message });
  process.exit(0);
}

if (result.outcome === "fail") {
  console.error(`::error::${result.error}`);
  writeFileSync(
    "vercel-usage-report.md",
    `## Vercel ${PLAN} usage\n\n**FAILED** — ${result.error}\n\nNothing was measured this run; the Slack page was NOT sent.\n`,
  );
  // Deliberately no warn/summary output: see the file header.
  process.exit(1);
}

writeFileSync("vercel-usage-report.md", result.report + "\n");
console.log(result.report);
if (result.ignored.length) {
  console.log(
    `Ignored ServiceName values with no matching metric (${result.ignored.length}): ` +
      result.ignored.map((i) => `${i.serviceName} (${i.consumed})`).join(", "),
  );
}
if (result.parseErrors.length) {
  console.log(`::warning::${result.parseErrors.length} JSONL line(s) failed to parse and were skipped`);
}

writeOutputs({ skip: "false", warn: String(result.warn), summary: result.summary });
