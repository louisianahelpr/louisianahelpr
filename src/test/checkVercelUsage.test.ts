/**
 * docs/OPEN.md "Vercel usage alert" (owner: finish up, 2026-09-14).
 *
 * scripts/check-vercel-usage.mjs asks GET /v1/billing/charges (FOCUS v1.3
 * JSONL) for the team and compares five metrics against the Pro plan's
 * published included amounts (scripts/lib/vercelUsage.mjs has the citations).
 * These tests exercise the pure logic directly: JSONL parsing, the
 * threshold maths, the no-token skip, a 401/5xx failing loudly without
 * paging, and an unrecognised ServiceName being ignored rather than erroring.
 *
 * @mutate scripts/lib/vercelUsage.mjs |   if (rows.length === 0 && ignored.length === 0) { | \n  if (false) {\n * `runVercelUsageCheck` takes an injected `fetch` the same way
 * findRecentDuplicate (supabase/functions/_shared/marketing/meta.ts) does —
 * stubbed globally, per src/test/marketingDuplicateScan.test.ts.
 */
// @mutate scripts/lib/vercelUsage.mjs | const warn = anyCritical(evals); | const warn = false;
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  METRICS,
  aggregateByMetric,
  anyCritical,
  buildReportMarkdown,
  evaluateMetrics,
  formatSummary,
  matchMetric,
  parseFocusJsonl,
  runVercelUsageCheck,
} from "../../scripts/lib/vercelUsage.mjs";

const FROM = "2026-09-07T00:00:00.000Z";
const TO = "2026-09-14T00:00:00.000Z";

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n");

const okResponse = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/jsonl" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseFocusJsonl", () => {
  it("parses one object per line and collects malformed lines instead of throwing", () => {
    const text = [
      JSON.stringify({ ServiceName: "Edge Requests", ConsumedQuantity: 100 }),
      "",
      "{not json",
      JSON.stringify({ ServiceName: "Builds", ConsumedQuantity: 5 }),
    ].join("\n");
    const { rows, errors } = parseFocusJsonl(text);
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toContain("{not json");
  });

  it("returns nothing for an empty body", () => {
    expect(parseFocusJsonl("")).toEqual({ rows: [], errors: [] });
  });
});

describe("matchMetric / aggregateByMetric", () => {
  it("sums ConsumedQuantity per metric across multiple rows", () => {
    const rows = [
      { ServiceName: "Edge Requests", ConsumedQuantity: 300_000, ConsumedUnit: "requests" },
      { ServiceName: "Edge Requests", ConsumedQuantity: 220_000, ConsumedUnit: "requests" },
      { ServiceName: "Fast Data Transfer", ConsumedQuantity: 12, ConsumedUnit: "GB" },
    ];
    const { byMetric } = aggregateByMetric(rows);
    expect(byMetric["Edge Requests"].consumed).toBe(520_000);
    expect(byMetric["Fast Data Transfer"].consumed).toBe(12);
    expect(byMetric["Build Minutes"].consumed).toBe(0);
  });

  it("an unknown ServiceName is ignored (not an error) and logged with its total", () => {
    const rows = [
      { ServiceName: "Observability Plus", ConsumedQuantity: 4_500_000 },
      { ServiceName: "Observability Plus", ConsumedQuantity: 500_000 },
      { ServiceName: "Web Analytics Plus", ConsumedQuantity: 1 },
    ];
    const { byMetric, ignored } = aggregateByMetric(rows);
    // Nothing crashed, and none of the five known metrics absorbed it.
    for (const m of METRICS) expect(byMetric[m.name].consumed).toBe(0);
    expect(ignored).toEqual(
      expect.arrayContaining([
        { serviceName: "Observability Plus", consumed: 5_000_000 },
        { serviceName: "Web Analytics Plus", consumed: 1 },
      ]),
    );
    expect(matchMetric("Observability Plus")).toBeNull();
  });

  it("matches Deployment Storage and Function Invocations by name", () => {
    expect(matchMetric("Deployment Storage")?.name).toBe("Deployment Storage");
    expect(matchMetric("Function Invocations")?.name).toBe("Function Invocations");
    expect(matchMetric("Builds")?.name).toBe("Build Minutes");
  });
});

describe("evaluateMetrics — threshold maths", () => {
  it("flags critical only at or above the threshold, for a metric WITH a published limit", () => {
    const [under, atThreshold, over] = ["Edge Requests"].flatMap(() => [799_999, 800_000, 999_999]).map((consumed) =>
      evaluateMetrics({ "Edge Requests": { consumed, reportedUnits: [] } }, { thresholdPercent: 80 }).find(
        (e) => e.name === "Edge Requests",
      )!,
    );
    expect(under.critical).toBe(false);
    expect(under.pct).toBeCloseTo(79.9999, 3);
    expect(atThreshold.critical).toBe(true);
    expect(atThreshold.pct).toBe(80);
    expect(over.critical).toBe(true);
  });

  it("a metric with no published limit is never critical, whatever it consumed", () => {
    const evals = evaluateMetrics(
      { "Function Invocations": { consumed: 50_000_000, reportedUnits: [] } },
      { thresholdPercent: 80 },
    );
    const fi = evals.find((e) => e.name === "Function Invocations")!;
    expect(fi.limit).toBeNull();
    expect(fi.pct).toBeNull();
    expect(fi.critical).toBe(false);
  });

  it("anyCritical / formatSummary reflect the worst metric", () => {
    const evals = evaluateMetrics(
      {
        "Edge Requests": { consumed: 900_000, reportedUnits: [] },
        "Fast Data Transfer": { consumed: 10, reportedUnits: [] },
      },
      { thresholdPercent: 80 },
    );
    expect(anyCritical(evals)).toBe(true);
    expect(formatSummary(evals, 80)).toMatch(/^WARN — Edge Requests at 90\.0%/);

    const okEvals = evaluateMetrics(
      { "Edge Requests": { consumed: 100, reportedUnits: [] } },
      { thresholdPercent: 80 },
    );
    expect(anyCritical(okEvals)).toBe(false);
    expect(formatSummary(okEvals, 80)).toMatch(/^ok — under 80%/);
  });

  it("buildReportMarkdown lists every metric, ignored services, and each source URL", () => {
    const evals = evaluateMetrics({}, { thresholdPercent: 80 });
    const report = buildReportMarkdown({
      evals,
      ignored: [{ serviceName: "Observability Plus", consumed: 3 }],
      thresholdPercent: 80,
      from: FROM,
      to: TO,
    });
    for (const m of METRICS) {
      expect(report).toContain(m.name);
      expect(report).toContain(m.sourceUrl);
    }
    expect(report).toContain("Observability Plus");
    expect(report).toContain("no published Pro quota");
  });
});

describe("runVercelUsageCheck", () => {
  it("skips without calling fetch when VERCEL_TOKEN is missing", async () => {
    const result = await runVercelUsageCheck({ token: undefined, from: FROM, to: TO });
    expect(result.outcome).toBe("skip");
    expect(result.warn).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the same way for an empty-string token", async () => {
    const result = await runVercelUsageCheck({ token: "", from: FROM, to: TO });
    expect(result.outcome).toBe("skip");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails loudly on 401 without ever setting warn — no page spam on a broken token", async () => {
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const result = await runVercelUsageCheck({ token: "bad-token", from: FROM, to: TO });
    if (result.outcome !== "fail") throw new Error(`expected 'fail', got ${result.outcome}`);
    expect(result.warn).toBe(false);
    expect(result.error).toMatch(/HTTP 401/);
  });

  /*
   * THE DEFECT THIS PINS, found 2026-09-20 while proving this guard able to
   * fail: a 200 carrying nothing walked the HAPPY path. `parseFocusJsonl("")`
   * gives no rows, every metric evaluates to 0%, `anyCritical` is false, and
   * the weekly job reported "ok — under 80% of every Pro-included limit
   * measured" having measured NOTHING. Vercel renaming every ServiceName,
   * changing the response shape, or answering 200 with an empty body all land
   * there, and Slack is gated on `warn === true`, so nobody is paged.
   *
   * Zero rows is a failed measurement, not a quota result.
   */
  it("a 200 with an empty body is a FAILED MEASUREMENT, not 'under quota'", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const result = await runVercelUsageCheck({ token: "tok", from: FROM, to: TO });
    if (result.outcome !== "fail") throw new Error(`expected 'fail', got ${result.outcome}`);
    expect(result.warn).toBe(false); // an instrumentation fault must not page Slack
    expect(result.error).toMatch(/no usable rows/);
  });

  it("a 200 whose ServiceNames we no longer recognise still counts as measured", async () => {
    // An unmapped ServiceName is a real measurement we chose not to grade, so
    // it proves the fetch worked. Only zero of BOTH rows and ignored is a
    // failure — otherwise a Vercel rename would page as an outage.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ServiceName: "Some Brand New Thing", ConsumedQuantity: 42 }), { status: 200 }),
    );
    const result = await runVercelUsageCheck({ token: "tok", from: FROM, to: TO });
    if (result.outcome !== "ok") throw new Error(`expected 'ok', got ${result.outcome}`);
    expect(result.ignored.some((i) => i.serviceName === "Some Brand New Thing")).toBe(true);
  });

  it("fails loudly on a 500 the same way", async () => {
    fetchMock.mockResolvedValue(new Response("server error", { status: 500 }));
    const result = await runVercelUsageCheck({ token: "tok", from: FROM, to: TO });
    if (result.outcome !== "fail") throw new Error(`expected 'fail', got ${result.outcome}`);
    expect(result.warn).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
  });

  it("fails loudly when the network throws", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const result = await runVercelUsageCheck({ token: "tok", from: FROM, to: TO });
    if (result.outcome !== "fail") throw new Error(`expected 'fail', got ${result.outcome}`);
    expect(result.warn).toBe(false);
    expect(result.error).toContain("ECONNRESET");
  });

  it("parses a real response, warns at/above threshold, and reports the request it made", async () => {
    fetchMock.mockResolvedValue(
      okResponse(
        jsonl([
          { ServiceName: "Edge Requests", ConsumedQuantity: 850_000, ConsumedUnit: "requests" },
          { ServiceName: "Fast Data Transfer", ConsumedQuantity: 5, ConsumedUnit: "GB" },
          { ServiceName: "Some New Product Vercel Ships Later", ConsumedQuantity: 42 },
        ]),
      ),
    );
    const result = await runVercelUsageCheck({ token: "tok", teamId: "team_UQHppAVoPIPQbyh2b43y21BG", from: FROM, to: TO, thresholdPercent: 80 });
    if (result.outcome !== "ok") throw new Error(`expected 'ok', got ${result.outcome}`);
    expect(result.warn).toBe(true);
    expect(result.summary).toContain("Edge Requests at 85.0%");
    expect(result.ignored).toEqual([{ serviceName: "Some New Product Vercel Ships Later", consumed: 42 }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://api.vercel.com/v1/billing/charges");
    expect(String(url)).toContain("teamId=team_UQHppAVoPIPQbyh2b43y21BG");
    expect(String(url)).toContain(encodeURIComponent(FROM));
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("stays green (ok, not warn) when every measured metric is under threshold", async () => {
    fetchMock.mockResolvedValue(
      okResponse(jsonl([{ ServiceName: "Edge Requests", ConsumedQuantity: 10_000, ConsumedUnit: "requests" }])),
    );
    const result = await runVercelUsageCheck({ token: "tok", from: FROM, to: TO });
    expect(result.outcome).toBe("ok");
    expect(result.warn).toBe(false);
  });
});
