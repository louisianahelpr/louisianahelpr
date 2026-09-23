#!/usr/bin/env node
/**
 * request-budget — sum a CI run's backend requests and fail the run over its
 * budget (docs/OPEN.md Q104).
 *
 *   node scripts/e2e/request-budget.mjs --label journeys [--label …] [--dir request-budget]
 *
 * Reads every sample e2e/requestMeter.mjs wrote (one per Playwright worker or
 * metered script), sums them per label, prints a table (and appends it to
 * $GITHUB_STEP_SUMMARY), writes <dir>/summary.json, and checks each label
 * against e2e/request-budgets.json:
 *
 *  - ceilingPerMinute (every label): the busiest wall-clock minute of the run
 *    must stay at or under it. One-way on purpose: it is a load POLICY, not a
 *    measurement (see the budgets file for where the number comes from).
 *  - perTest / signIns: MEASURED budgets, TWO-WAY. Over the budget fails; under
 *    half of it also fails ("stale budget, lower it"), because a loose budget
 *    hides the next regression. `null` means not calibrated yet: the run
 *    prints its measured value as the number to write down and does not fail
 *    on that line.
 *
 * Exits non-zero when any check fails. A label with no samples is reported as zero
 * load (every test skipped); a spec that is not METERED is caught from source
 * by src/test/requestBudget.test.ts, which is exact where a run is not.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Under this fraction of a measured budget, the budget is stale. */
export const STALE_FRACTION = 0.5;

/** Sum samples per label. */
export function aggregate(samples) {
  const by = {};
  for (const s of samples) {
    const a = (by[s.label] ??= { label: s.label, total: 0, byClass: {}, signIns: 0, duplicates: 0, tests: 0, minutes: {}, topDuplicates: {}, samples: 0 });
    a.samples++;
    a.total += s.total;
    a.signIns += s.signIns;
    a.duplicates += s.duplicates;
    a.tests += s.tests;
    for (const [k, v] of Object.entries(s.byClass ?? {})) a.byClass[k] = (a.byClass[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.minutes ?? {})) a.minutes[k] = (a.minutes[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.topDuplicates ?? {})) a.topDuplicates[k] = (a.topDuplicates[k] ?? 0) + v;
  }
  for (const a of Object.values(by)) {
    a.peakPerMinute = Math.max(0, ...Object.values(a.minutes));
    a.perTest = a.tests > 0 ? Math.round((a.total / a.tests) * 10) / 10 : a.total;
  }
  return by;
}

/** Budget for a label: the label's own entry over the "*" defaults. */
export function budgetFor(budgets, label) {
  return { ...(budgets["*"] ?? {}), ...(budgets[label] ?? {}) };
}

/**
 * Judge one label. Returns { failures: string[], notes: string[] }.
 * A two-way measured budget fails above it and under STALE_FRACTION of it.
 */
export function judge(agg, budget) {
  const failures = [];
  const notes = [];
  if (typeof budget.ceilingPerMinute !== "number") {
    failures.push(`no ceilingPerMinute for ${agg.label}: every run needs a load ceiling`);
  } else if (agg.peakPerMinute > budget.ceilingPerMinute) {
    failures.push(`${agg.label}: ${agg.peakPerMinute} backend requests in its busiest minute, over the ${budget.ceilingPerMinute}/min ceiling`);
  }
  for (const [field, measured] of [["perTest", agg.perTest], ["signIns", agg.signIns]]) {
    const b = budget[field];
    if (b === null || b === undefined) {
      notes.push(`${agg.label}: ${field} not calibrated; measured ${measured} this run (write it to e2e/request-budgets.json)`);
      continue;
    }
    if (measured > b) failures.push(`${agg.label}: ${field} ${measured} is over its budget ${b}`);
    else if (measured < b * STALE_FRACTION) failures.push(`${agg.label}: ${field} ${measured} is under half its budget ${b}: stale budget, lower it to ${measured}`);
  }
  return { failures, notes };
}

export function table(aggs) {
  const rows = [
    "| run | tests | requests | per test | busiest min | rest | rpc | auth | fn | storage | realtime | sign-ins | dup GETs |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const a of aggs) {
    const c = a.byClass;
    rows.push(`| ${a.label} | ${a.tests} | ${a.total} | ${a.perTest} | ${a.peakPerMinute} | ${c.rest ?? 0} | ${c.rpc ?? 0} | ${c.auth ?? 0} | ${c.functions ?? 0} | ${c.storage ?? 0} | ${c.realtime ?? 0} | ${a.signIns} | ${a.duplicates} |`);
  }
  return rows.join("\n");
}

function readSamples(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "summary.json")
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

function main(argv) {
  const labels = [];
  let dir = process.env.REQUEST_BUDGET_DIR || "request-budget";
  let budgetsFile = "e2e/request-budgets.json";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--label") labels.push(argv[++i]);
    else if (argv[i] === "--dir") dir = argv[++i];
    else if (argv[i] === "--budgets") budgetsFile = argv[++i];
  }
  const budgets = JSON.parse(readFileSync(budgetsFile, "utf8")).budgets;
  const by = aggregate(readSamples(dir));
  const wanted = labels.length ? labels : Object.keys(by);
  const failures = [];
  const notes = [];
  const aggs = [];
  if (!wanted.length) failures.push(`no --label given and no samples in ${dir}: nothing to judge`);
  for (const label of wanted) {
    const a = by[label];
    if (!a) {
      // Zero load, not a failure: every test in the job skipped, or none
      // reached the backend. "The spec was never metered" is caught from
      // source instead (src/test/requestBudget.test.ts), where it is exact.
      notes.push(`${label}: no metered backend requests in ${dir} (no test ran, or none reached the backend)`);
      continue;
    }
    aggs.push(a);
    const j = judge(a, budgetFor(budgets, label));
    failures.push(...j.failures);
    notes.push(...j.notes);
  }
  const out = [
    "### Backend request budget (Q104)",
    "",
    table(aggs),
    "",
    ...aggs.flatMap((a) => {
      const top = Object.entries(a.topDuplicates).sort((x, y) => y[1] - x[1]).slice(0, 5);
      return top.length ? [`Top repeated GETs (${a.label}): ${top.map(([k, v]) => `\`${k.slice(0, 120)}\` ×${v}`).join(", ")}`, ""] : [];
    }),
    ...notes.map((n) => `- note: ${n}`),
    ...failures.map((f) => `- **FAIL**: ${f}`),
  ].join("\n");
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out}\n`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ aggs, failures, notes }, null, 2));
  for (const n of notes) console.log(`::warning::${n}`);
  for (const f of failures) console.log(`::error::${f}`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
