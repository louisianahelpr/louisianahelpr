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
 * Pro plan's published included amounts.
 *
 * WHAT "INCLUDED (PRO)" ACTUALLY MEANS TODAY (checked 2026-09-14/15 against
 * vercel.com/docs — Vercel moved Pro to credit-based billing; most resources
 * no longer have a fixed free quota, they draw from the $20/month platform
 * credit from the first unit):
 *
 *   - Edge Requests & Fast Data Transfer: Pro DOES include a fixed amount —
 *     the lowest Flat Rate CDN tier, at no extra cost:
 *       "Included with Pro | 1M | 1 TB"
 *       https://vercel.com/docs/pricing/flat-rate-cdn#flat-rate-cdn-tiers
 *     (also restated in https://vercel.com/docs/plans/pro-plan under
 *     "Monthly credit": "a capacity of 1 million CDN requests and 1 TB of
 *     data transfer each month"). CDN requests appear as "Edge Requests" in
 *     Vercel's own billing dashboard (same flat-rate-cdn page). 1 TB is
 *     taken as 1000 GB, matching Vercel's own decimal usage (their Hobby
 *     tables read "100 GB" / "10 GB", not GiB).
 *
 *   - Function Invocations, Build Minutes, Deployment Storage: Pro has NO
 *     published fixed included quantity — each is billed from the shared
 *     $20/month credit starting at the first unit:
 *       Function Invocations: the Vercel Functions table lists "N/A" under
 *       Pro (Hobby's "1 million included" has no Pro counterpart) —
 *       https://vercel.com/docs/pricing#vercel-functions
 *       Build Minutes: "Basic usage is billed at $0.0035 per CPU minute"
 *       with no free Pro allotment described —
 *       https://vercel.com/docs/builds/managing-builds#build-machines
 *       Deployment Storage: "$0.10 per GB-month ... Your plan or contract
 *       may also include an allowance. Use Usage and your invoice to
 *       confirm your team's allowance" — no number Vercel publishes —
 *       https://vercel.com/docs/deployment-storage#pricing
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

export const TEAM_ID = "team_UQHppAVoPIPQbyh2b43y21BG";

export const CHARGES_URL = "https://api.vercel.com/v1/billing/charges";

export const SKIP_MESSAGE =
  "Vercel usage check skipped — no VERCEL_TOKEN repo secret. OWNER ACTION: create a " +
  "Vercel token with read scope for team Helpr (vercel.com -> Settings -> Tokens) and " +
  "add it as the repo secret VERCEL_TOKEN; see docs/OPEN.md (\"Vercel usage alert\").";

/**
 * The five metrics docs/OPEN.md asks for, each with the regex that matches
 * its ServiceName in the FOCUS JSONL, its Pro-included amount (`null` when
 * Vercel publishes none — see the file header), a display unit, and the
 * doc URL the number came from.
 */
export const METRICS = [
  {
    name: "Edge Requests",
    match: /edge request|cdn request/i,
    limit: 1_000_000,
    unit: "requests/7d window",
    sourceUrl: "https://vercel.com/docs/pricing/flat-rate-cdn#flat-rate-cdn-tiers",
    note: "Flat Rate CDN's lowest tier, included free with Pro.",
  },
  {
    name: "Fast Data Transfer",
    match: /fast data transfer/i,
    limit: 1000, // 1 TB, taken as 1000 GB (Vercel's own decimal convention)
    unit: "GB/7d window",
    sourceUrl: "https://vercel.com/docs/pricing/flat-rate-cdn#flat-rate-cdn-tiers",
    note: "Flat Rate CDN's lowest tier, included free with Pro.",
  },
  {
    name: "Function Invocations",
    match: /function invocation|^invocations$/i,
    limit: null,
    unit: "invocations/7d window",
    sourceUrl: "https://vercel.com/docs/pricing#vercel-functions",
    note: "No published Pro quota — billed from the shared $20/month credit from the first invocation.",
  },
  {
    name: "Build Minutes",
    match: /build/i,
    limit: null,
    unit: "CPU minutes/7d window",
    sourceUrl: "https://vercel.com/docs/builds/managing-builds#build-machines",
    note: "No published Pro quota — $0.0035/CPU-minute from the first minute, funded by the shared credit.",
  },
  {
    name: "Deployment Storage",
    match: /deployment storage/i,
    limit: null,
    unit: "GB-months",
    sourceUrl: "https://vercel.com/docs/deployment-storage#pricing",
    note: "No published Pro quota — $0.10/GB-month; Vercel says only \"your plan may include an allowance\", with no number given.",
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
export function evaluateMetrics(byMetric, { thresholdPercent = 80, metrics = METRICS } = {}) {
  return metrics.map((m) => {
    const agg = byMetric?.[m.name] ?? { consumed: 0, reportedUnits: [] };
    const consumed = agg.consumed;
    const pct = m.limit == null ? null : (consumed / m.limit) * 100;
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
      .map((e) => `${e.name} at ${e.pct.toFixed(1)}% of the Pro-included ${fmtQty(e.limit)} ${e.unit} (${fmtQty(e.consumed)} used)`)
      .join("; ")}`;
  }
  const measured = evals.filter((e) => e.limit != null);
  if (!measured.length) return "no metric with a published Pro quota was measured this run";
  return `ok — under ${thresholdPercent}% of every Pro-included limit measured`;
}

/** The full markdown report written to vercel-usage-report.md and the job summary. */
export function buildReportMarkdown({ evals, ignored, thresholdPercent, from, to, parseErrors = [] }) {
  const rows = evals.map((e) => {
    const limitCell = e.limit == null ? "no published Pro quota" : `${fmtQty(e.limit)} ${e.unit}`;
    const pctCell = e.pct == null ? `— (${e.note})` : `${e.pct.toFixed(1)}%`;
    return `| ${e.name} | ${fmtQty(e.consumed)} ${e.unit} | ${limitCell} | ${pctCell} |`;
  });
  const lines = [
    "## Vercel Pro usage",
    "",
    `Window: ${from} to ${to} · Warn threshold: ${thresholdPercent}%`,
    "",
    "| Metric | Used | Pro-included limit | Share |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "Sources (fetched 2026-09-14/15, re-verify if this starts to drift):",
    ...evals.map((e) => `- [${e.name}](${e.sourceUrl})`),
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
  const evals = evaluateMetrics(byMetric, { thresholdPercent, metrics });
  const warn = anyCritical(evals);
  const summary = formatSummary(evals, thresholdPercent);
  const report = buildReportMarkdown({ evals, ignored, thresholdPercent, from, to, parseErrors });
  return { outcome: "ok", warn, summary, report, evals, ignored, parseErrors };
}
