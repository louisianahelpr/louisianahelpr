/**
 * Vercel usage alert — pure logic, no I/O (network and file writes live in
 * scripts/check-vercel-usage.mjs, which calls `runVercelUsageCheck` below and
 * uses the global `fetch`, matching the injected-fetch pattern already used
 * by supabase/functions/_shared/marketing/meta.ts and tested the same way in
 * src/test/marketingDuplicateScan.test.ts — `vi.stubGlobal("fetch", ...)`).
 *
 * docs/OPEN.md 2026-09-14 ("Vercel usage alert", owner: "finish up"):
 * GET https://api.vercel.com/v1/billing/charges returns FOCUS v1.3 JSONL
 * (one JSON object per line: ServiceName, ConsumedQuantity, ConsumedUnit,
 * ChargePeriodStart/End, ...) for a team over a date range. This sums
 * ConsumedQuantity per ServiceName and compares five metrics against the
 * included amounts of the plan the team is ACTUALLY on.
 *
 * THE PLAN IS HOBBY (FREE), measured 2026-09-23 (docs/OPEN.md Q221). This file
 * used to grade against the Pro plan's included amounts (Flat Rate CDN 1M
 * requests / 1 TB transfer, read 2026-09-14/15), which is ten times the Hobby
 * transfer allowance: a Hobby team could be at 100% and read 10%. The limits
 * now come from the ONE definition, PLAN_LIMITS in scripts/lib/quotaMonitor.mjs,
 * shared with quota-monitor.yml and scripts/supabase-usage-check.mjs; each
 * `source` there says where the number came from and that it was not re-read
 * on 2026-09-23 (vendor pages are egress-blocked from the cloud session).
 *
 * WINDOW. Hobby allowances are MONTHLY; this check reads a trailing window
 * (7 days, scripts/check-vercel-usage.mjs). The window's consumption is
 * projected to 30 days before grading (`windowDays`), the same projection
 * quota-monitor.yml makes for edge invocations. Grading 7 days of use against
 * a monthly allowance under-read every metric by ~4x.
 *
 * A metric with `limit: null` NEVER pages — there is nothing to be 80% of.
 * It is only ever logged (consumed quantity, for visibility), exactly like
 * scripts/supabase-usage-check.mjs reports a metric it cannot measure as
 * "not exposed" rather than inventing a number for it.
 *
 * A ServiceName that matches none of the five `match` patterns below is
 * IGNORED — not an error. Vercel's ServiceName is a free-text display name
 * (no published enum), so an unrecognised one (e.g. "Observability Plus",
 * "Web Analytics") is expected and is logged, never silently dropped and
 * never treated as a fetch failure.
 */

import { PLAN_LIMITS, PLANS } from "./quotaMonitor.mjs";

export const TEAM_ID = "team_UQHppAVoPIPQbyh2b43y21BG";

/** The plan the grading is against, from the shared definition. */
export const PLAN = PLANS.vercel;

export const CHARGES_URL = "https://api.vercel.com/v1/billing/charges";

export const SKIP_MESSAGE =
  "Vercel usage check skipped — no VERCEL_TOKEN repo secret. OWNER ACTION: create a " +
  "Vercel token with read scope for team Helpr (vercel.com -> Settings -> Tokens) and " +
  "add it as the repo secret VERCEL_TOKEN; see docs/OPEN.md (\"Vercel usage alert\").";

/**
 * The five metrics docs/OPEN.md asks for, each with the regex that matches
 * its ServiceName in the FOCUS JSONL, its MONTHLY included amount on the
 * team's plan from PLAN_LIMITS (`null` when none is published — see
 * quotaMonitor.mjs), a display unit, and the doc URL for the metric.
 */
export const METRICS = [
  {
    name: "Edge Requests",
    match: /edge request|cdn request/i,
    limit: PLAN_LIMITS.vercel_edge_requests_month.value,
    unit: "requests/month",
    sourceUrl: "https://vercel.com/docs/limits",
    note: PLAN_LIMITS.vercel_edge_requests_month.source,
  },
  {
    name: "Fast Data Transfer",
    match: /fast data transfer/i,
    limit: PLAN_LIMITS.vercel_fast_data_transfer_gb_month.value,
    unit: "GB/month",
    sourceUrl: "https://vercel.com/docs/limits",
    note: PLAN_LIMITS.vercel_fast_data_transfer_gb_month.source,
  },
  {
    name: "Function Invocations",
    match: /function invocation|^invocations$/i,
    limit: PLAN_LIMITS.vercel_function_invocations_month.value,
    unit: "invocations/month",
    sourceUrl: "https://vercel.com/docs/pricing#vercel-functions",
    note: PLAN_LIMITS.vercel_function_invocations_month.source,
  },
  {
    name: "Build Minutes",
    match: /build/i,
    limit: PLAN_LIMITS.vercel_build_minutes_month.value,
    unit: "CPU minutes/month",
    sourceUrl: "https://vercel.com/docs/builds/managing-builds#build-machines",
    note: PLAN_LIMITS.vercel_build_minutes_month.source,
  },
  {
    name: "Deployment Storage",
    match: /deployment storage/i,
    limit: PLAN_LIMITS.vercel_deployment_storage_gb_month.value,
    unit: "GB-months",
    sourceUrl: "https://vercel.com/docs/deployment-storage#pricing",
    note: PLAN_LIMITS.vercel_deployment_storage_gb_month.source,
  },
];

/**
 * Parse newline-delimited JSON. A line that fails to parse is collected in
 * `errors` (with the offending text) rather than throwing — one bad line
 * must not blank out every metric this run could otherwise report.
 */
export function parseFocusJsonl(text) {
  const rows = [];
  const errors = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (e) {
      errors.push({ line: line.slice(0, 200), error: String(e?.message || e) });
    }
  }
  return { rows, errors };
}

/** First metric whose `match` tests true against a ServiceName, else null. */
export function matchMetric(serviceName, metrics = METRICS) {
  if (!serviceName) return null;
  return metrics.find((m) => m.match.test(serviceName)) ?? null;
}

/**
 * Sum ConsumedQuantity per metric across every FOCUS row. Rows whose
 * ServiceName matches no metric are summed per-ServiceName into `ignored`
 * instead of being dropped.
 */
export function aggregateByMetric(rows, metrics = METRICS) {
  const byMetric = new Map(metrics.map((m) => [m.name, { consumed: 0, units: new Set() }]));
  const ignored = new Map();
  for (const row of rows ?? []) {
    const serviceName = row?.ServiceName;
    const qty = Number(row?.ConsumedQuantity ?? 0);
    const finiteQty = Number.isFinite(qty) ? qty : 0;
    const metric = matchMetric(serviceName, metrics);
    if (!metric) {
      if (serviceName) ignored.set(serviceName, (ignored.get(serviceName) ?? 0) + finiteQty);
      continue;
    }
    const entry = byMetric.get(metric.name);
    entry.consumed += finiteQty;
    if (row?.ConsumedUnit) entry.units.add(row.ConsumedUnit);
  }
  const byMetricObj = {};
  for (const [name, v] of byMetric.entries()) {
    byMetricObj[name] = { consumed: v.consumed, reportedUnits: [...v.units] };
  }
  return {
    byMetric: byMetricObj,
    ignored: [...ignored.entries()].map(([serviceName, consumed]) => ({ serviceName, consumed })),
  };
}

/**
 * Evaluate each metric against its limit. `pct`/`critical` are null/false
 * for a `limit: null` metric — it is measured and logged, never paged.
 */
export function evaluateMetrics(byMetric, { thresholdPercent = 80, metrics = METRICS, windowDays = 30 } = {}) {
  // Monthly allowances: project the window's consumption to 30 days. A
  // 30-day window (the default) grades the raw number.
  const scale = 30 / windowDays;
  return metrics.map((m) => {
    const agg = byMetric?.[m.name] ?? { consumed: 0, reportedUnits: [] };
    const consumed = agg.consumed;
    const pct = m.limit == null ? null : ((consumed * scale) / m.limit) * 100;
    return {
      name: m.name,
      consumed,
      unit: m.unit,
      reportedUnits: agg.reportedUnits,
      limit: m.limit,
      pct,
      critical: pct != null && pct >= thresholdPercent,
      sourceUrl: m.sourceUrl,
      note: m.note,
    };
  });
}

export function anyCritical(evals) {
  return evals.some((e) => e.critical);
}

function fmtQty(n) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** One-line summary for Slack and the workflow's `summary` output. */
export function formatSummary(evals, thresholdPercent) {
  const critical = evals.filter((e) => e.critical);
  if (critical.length) {
    return `WARN — ${critical
      .map((e) => `${e.name} at ${e.pct.toFixed(1)}% of the ${PLAN}-included ${fmtQty(e.limit)} ${e.unit} (${fmtQty(e.consumed)} used in the window)`)
      .join("; ")}`;
  }
  const measured = evals.filter((e) => e.limit != null);
  if (!measured.length) return `no metric with a published ${PLAN} quota was measured this run`;
  return `ok — under ${thresholdPercent}% of every ${PLAN}-included limit measured`;
}

/** The full markdown report written to vercel-usage-report.md and the job summary. */
export function buildReportMarkdown({ evals, ignored, thresholdPercent, from, to, parseErrors = [], windowDays = 30 }) {
  const rows = evals.map((e) => {
    const limitCell = e.limit == null ? `no published ${PLAN} quota` : `${fmtQty(e.limit)} ${e.unit}`;
    const pctCell = e.pct == null ? `— (${e.note})` : `${e.pct.toFixed(1)}%`;
    return `| ${e.name} | ${fmtQty(e.consumed)} | ${limitCell} | ${pctCell} |`;
  });
  const lines = [
    `## Vercel ${PLAN} usage`,
    "",
    `Window: ${from} to ${to} (${windowDays} days, projected to 30 for the share) · Warn threshold: ${thresholdPercent}%`,
    "",
    `| Metric | Used in the window | ${PLAN}-included limit | Share (projected month) |`,
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "Limits: PLAN_LIMITS in scripts/lib/quotaMonitor.mjs (one definition; not re-read from Vercel on 2026-09-23):",
    ...evals.map((e) => `- [${e.name}](${e.sourceUrl}) — ${e.note}`),
  ];
  if (ignored.length) {
    lines.push(
      "",
      "### ServiceName values not mapped to a metric (ignored, not an error)",
      "",
      ...ignored.map((i) => `- \`${i.serviceName}\`: ${fmtQty(i.consumed)}`),
    );
  }
  if (parseErrors.length) {
    lines.push("", `**${parseErrors.length} JSONL line(s) failed to parse and were skipped.**`);
  }
  return lines.join("\n");
}

/**
 * The whole check: no token -> 'skip' (no fetch); non-2xx or a network
 * throw -> 'fail' with `warn` left false so the caller's Slack step (gated
 * on `warn === true`) can never fire on a broken fetch — "fail loudly, no
 * page spam" is the point, not a contradiction. Otherwise -> 'ok' with the
 * evaluated metrics, the summary line, and the full report.
 */
export async function runVercelUsageCheck({
  token,
  teamId = TEAM_ID,
  from,
  to,
  thresholdPercent = 80,
  metrics = METRICS,
  windowDays = 30,
} = {}) {
  if (!token) {
    return { outcome: "skip", warn: false, summary: "skipped — no VERCEL_TOKEN repo secret", message: SKIP_MESSAGE };
  }

  const url = `${CHARGES_URL}?${new URLSearchParams({ teamId, from, to }).toString()}`;
  let res;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/jsonl" } });
  } catch (e) {
    return { outcome: "fail", warn: false, error: `Vercel billing/charges request failed: ${String(e?.message || e)}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      outcome: "fail",
      warn: false,
      status: res.status,
      error: `Vercel billing/charges returned HTTP ${res.status}: ${body.slice(0, 400)}`,
    };
  }

  const text = await res.text();
  const { rows, errors: parseErrors } = parseFocusJsonl(text);
  const { byMetric, ignored } = aggregateByMetric(rows, metrics);

  /*
   * A 200 CARRYING NOTHING IS NOT "UNDER QUOTA" — it is a failed measurement.
   *
   * Without this, an empty body walks the happy path: `parseFocusJsonl("")`
   * gives `{rows: []}`, every metric evaluates to 0%, `anyCritical` is false,
   * and the weekly job reports "ok — under 80% of every Pro-included limit
   * measured" while having measured NOTHING. Vercel renaming every
   * ServiceName, changing the response shape, or answering 200 with an empty
   * body all produce that, and the Slack step is gated on `warn === true`, so
   * nobody is paged either.
   *
   * That is the shape this whole burn-down exists to kill: green is what a
   * check reports when it is looking at nothing. Found 2026-09-20 while
   * proving `checkVercelUsage` able to fail — the guard was honest, the
   * behaviour it certified was the bug.
   *
   * `rows + ignored` rather than `rows` alone: an unrecognised ServiceName is
   * a real measurement we chose not to map, so it still proves the fetch
   * worked. Zero of BOTH means we learned nothing, which is a `fail` — and
   * `fail` leaves `warn` false, so this reports loudly in the job without
   * paging Slack for what is an instrumentation fault, not a quota event.
   */
  if (rows.length === 0 && ignored.length === 0) {
    return {
      outcome: "fail",
      warn: false,
      error:
        "Vercel billing/charges returned 200 with no usable rows " +
        `(${text.length} bytes, ${parseErrors.length} parse error(s)). ` +
        "Reporting 0% against every quota would be a measurement that did not happen — " +
        "check the endpoint shape and the ServiceName mapping in scripts/lib/vercelUsage.mjs.",
      parseErrors,
    };
  }

  const evals = evaluateMetrics(byMetric, { thresholdPercent, metrics, windowDays });
  const warn = anyCritical(evals);
  const summary = formatSummary(evals, thresholdPercent);
  const report = buildReportMarkdown({ evals, ignored, thresholdPercent, from, to, parseErrors, windowDays });
  return { outcome: "ok", warn, summary, report, evals, ignored, parseErrors };
}
