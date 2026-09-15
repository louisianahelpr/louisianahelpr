#!/usr/bin/env node
/**
 * Vercel usage alert — how close is the team to a Pro plan limit?
 *
 * docs/OPEN.md 2026-09-14 ("Vercel usage alert", owner: "finish up"). Reads
 * the last 7 days of GET /v1/billing/charges (FOCUS v1.3 JSONL) for team
 * team_UQHppAVoPIPQbyh2b43y21BG and compares five metrics — Edge Requests,
 * Fast Data Transfer, Function Invocations, Build Minutes, Deployment
 * Storage — against the Pro plan's published included amounts. All the
 * maths, the metric table (with its source-URL citations) and the FOCUS
 * JSONL parsing live in scripts/lib/vercelUsage.mjs, tested in
 * src/test/checkVercelUsage.test.ts; this file is only env/IO plumbing.
 *
 * No VERCEL_TOKEN repo secret -> prints ONE skip line and exits 0 (green).
 * A 401/5xx or a network failure -> ::error and exit 1 (red), but the
 * `warn`/`summary` outputs are deliberately never written on that path, so
 * the workflow's Slack step (gated on `outputs.warn == 'true'`) cannot fire
 * — a broken token fails this step loudly without ever paging Slack.
 *
 * Outputs (GITHUB_OUTPUT): skip=true|false, warn=true|false, summary=<line>.
 * Writes vercel-usage-report.md always (except on the fail path, where
 * there is nothing measured yet to report).
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { TEAM_ID, runVercelUsageCheck } from "./lib/vercelUsage.mjs";

const THRESHOLD = Number(process.env.WARN_AT_PERCENT || 80);
const TEAM = process.env.VERCEL_TEAM_ID || TEAM_ID;
const to = new Date();
const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

function writeOutputs(kv) {
  if (!process.env.GITHUB_OUTPUT) return;
  const body = Object.entries(kv)
    .map(([k, v]) => `${k}=${String(v).replace(/\n/g, " ")}\n`)
    .join("");
  appendFileSync(process.env.GITHUB_OUTPUT, body);
}

const result = await runVercelUsageCheck({
  token: process.env.VERCEL_TOKEN,
  teamId: TEAM,
  from: from.toISOString(),
  to: to.toISOString(),
  thresholdPercent: THRESHOLD,
});

if (result.outcome === "skip") {
  console.log(result.message);
  writeFileSync("vercel-usage-report.md", `## Vercel Pro usage\n\nSKIPPED — ${result.message}\n`);
  writeOutputs({ skip: "true", warn: "false", summary: result.summary });
  process.exit(0);
}

if (result.outcome === "fail") {
  console.error(`::error::${result.error}`);
  writeFileSync(
    "vercel-usage-report.md",
    `## Vercel Pro usage\n\n**FAILED** — ${result.error}\n\nNothing was measured this run; the Slack page was NOT sent.\n`,
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
