// @mutate scripts/audit/prune-loading-baseline.mjs | const kept = allow.filter((a) => !gone.has(`${a.key}\|${a.kind}`)); | const kept = allow;
// @mutate scripts/audit/prune-loading-baseline.mjs | return { baseline: { ...baseline, allow: kept }, removed: stale }; | return { baseline: { ...baseline, allow: kept, byDesign: [] }, removed: stale };
// @mutate scripts/audit/prune-loading-baseline.mjs | staleEntries(results, allow.filter((a) => a.path), breaches(results)) | staleEntries(results, allow, breaches(results))
// @mutate .github/workflows/loading-states-refresh.yml | node scripts/audit/prune-loading-baseline.mjs | true
// @mutate .github/workflows/loading-states-refresh.yml | paths: \| | paths: >
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pruneBaseline } from "../../scripts/audit/prune-loading-baseline.mjs";

/**
 * Q1695: the loading-states refresh PR could never land (#2627 .. #4152,
 * 2026-10-09..11-07). loadingStateShape grades the fresh measurement against
 * main's baseline in both directions, so every FIXED skeleton turned the bot's
 * own PR red ("entry no longer breaches, delete it") until a person edited the
 * baseline on the bot branch; main kept the 2026-10-07 measurement for a month.
 * The refresh's land job now deletes the fixed `allow` entries itself, by the
 * check's own staleEntries rule, and NEVER adds one, so a new breach still
 * holds the PR. Red before: the workflow neither ran the prune nor committed
 * baseline.json.
 */
const ROOT = resolve(__dirname, "../..");
const measured = (clusters: { path: string; rowH: [number, number] }[], url = "/posts") => ({
  results: [
    {
      status: "measured",
      persona: "customer",
      url,
      clusters: clusters.map((c) => ({ realBox: {}, path: c.path, rowH: c.rowH, deltaRowH: c.rowH[1] - c.rowH[0], rows: [1, 1], media: [0, 0] })),
    },
  ],
});
const entry = (path?: string) => ({ key: "customer /posts #0", kind: "jump", ...(path ? { path } : {}), was: "row 60px -> 120px" });

describe("prune-loading-baseline only shrinks the allow list (Q1695)", () => {
  it("deletes an allow entry whose element no longer breaches", () => {
    const { baseline, removed } = pruneBaseline(measured([{ path: "main > ul", rowH: [60, 62] }]), { allow: [entry("main > ul")], byDesign: [] });
    expect(removed).toEqual(["customer /posts #0|jump"]);
    expect(baseline.allow).toEqual([]);
  });

  it("keeps an entry that still breaches", () => {
    const { baseline, removed } = pruneBaseline(measured([{ path: "main > ul", rowH: [60, 120] }]), { allow: [entry("main > ul")], byDesign: [] });
    expect(removed).toEqual([]);
    expect(baseline.allow).toHaveLength(1);
  });

  it("keeps an entry whose element was not measured this run (another element at #0)", () => {
    const { baseline, removed } = pruneBaseline(measured([{ path: "nav.bottom-nav", rowH: [60, 60] }]), { allow: [entry("main > ul")], byDesign: [] });
    expect(removed).toEqual([]);
    expect(baseline.allow).toHaveLength(1);
  });

  it("never prunes an entry that names no element (path), even when its key reads fixed", () => {
    const { baseline, removed } = pruneBaseline(measured([{ path: "main > ul", rowH: [60, 62] }]), { allow: [entry()], byDesign: [] });
    expect(removed).toEqual([]);
    expect(baseline.allow).toHaveLength(1);
  });

  it("never adds a new breach to allow and never touches byDesign", () => {
    const byDesign = [{ key: "customer /other #0", kind: "jump", ruling: "owner 2026-09-19" }];
    const { baseline } = pruneBaseline(measured([{ path: "main > ul", rowH: [60, 400] }]), { allow: [], byDesign });
    expect(baseline.allow).toEqual([]);
    expect(baseline.byDesign).toEqual(byDesign);
  });

  it("the committed baseline has nothing to prune against the committed measurement", () => {
    const m = JSON.parse(readFileSync(resolve(ROOT, "docs/audit/loading-states/measurements.json"), "utf8"));
    const b = JSON.parse(readFileSync(resolve(ROOT, "docs/audit/loading-states/baseline.json"), "utf8"));
    expect((b.allow ?? []).length).toBeGreaterThan(0);
    expect(pruneBaseline(m, b).removed).toEqual([]);
  });
});

describe("the loading-states refresh lands the pruned baseline with the measurement (Q1695)", () => {
  const wf = readFileSync(resolve(ROOT, ".github/workflows/loading-states-refresh.yml"), "utf8");
  const land = wf.slice(wf.indexOf("\n  land:"), wf.indexOf("\n  notify:"));

  it("commits baseline.json beside measurements.json", () => {
    expect(land).toMatch(/paths: \|\n\s+docs\/audit\/loading-states\/measurements\.json\n\s+docs\/audit\/loading-states\/baseline\.json\n/);
  });

  it("runs the prune on latest main after copying the fresh measurement", () => {
    const regen = land.slice(land.indexOf("regenerate: |"));
    const cp = regen.indexOf('cp "$MEASURED/docs/audit/loading-states/measurements.json"');
    const prune = regen.indexOf("node scripts/audit/prune-loading-baseline.mjs");
    expect(cp).toBeGreaterThan(-1);
    expect(prune).toBeGreaterThan(cp);
  });
});
