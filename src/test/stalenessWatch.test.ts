// @mutate scripts/check-staleness.mjs | if (hours > MAX_EVIDENCE_HOURS) { | if (hours > MAX_EVIDENCE_HOURS * 1000) {
// @mutate scripts/check-staleness.mjs |     if (days > MAX_REPORT_DAYS) { |     if (days > MAX_REPORT_DAYS * 1000) {
// @mutate scripts/check-staleness.mjs | && !recordDirs.some((d) => f.startsWith(d)) && !exempt.has(f) | && false
/*
 * The staleness watch (scripts/check-staleness.mjs, run nightly by
 * staleness-watch.yml) must itself be able to fail — a freshness check that
 * always says "fresh" is the thing it exists to prevent.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs script, no declaration file
import { checkEvidence, checkLedger, checkReports, checkWorkflowBound, evidenceTimestamp, listEvidence, listReports, LIVE_DOCS, MAX_EVIDENCE_HOURS, MAX_LEDGER_COMMITS, MAX_REPORT_DAYS, WORKFLOW_BOUND } from "../../scripts/check-staleness.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { RECORD_DIRS } from "../../scripts/check-stated-counts.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const NOW = new Date("2026-09-23T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 36e5);
const never = () => null;

describe("staleness watch", () => {
  it("finds the repo's timestamped evidence (the scan is real)", () => {
    const files = (listEvidence() as { file: string }[]).map((e) => e.file);
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files).toContain("docs/audit/loading-states/baseline.json");
  });

  it("reads each supported timestamp key and ignores non-evidence", () => {
    expect(evidenceTimestamp({ generatedAt: "2026-09-21" })?.key).toBe("generatedAt");
    expect(evidenceTimestamp({ measuredAt: "2026-09-21T00:00:00Z" })?.key).toBe("measuredAt");
    expect(evidenceTimestamp({ name: "x" })).toBeNull();
    expect(evidenceTimestamp({ generated: "not a date" })).toBeNull();
  });

  it("is RED on evidence past the age limit, green inside it", () => {
    const old = [{ file: "a.json", at: hoursAgo(MAX_EVIDENCE_HOURS + 1), covers: null }];
    const fresh = [{ file: "b.json", at: hoursAgo(1), covers: null }];
    expect(checkEvidence(old, NOW, never)).toHaveLength(1);
    expect(checkEvidence(fresh, NOW, never)).toHaveLength(0);
  });

  it("is RED when code the evidence declares it covers changed after it was measured", () => {
    const e = [{ file: "c.json", at: hoursAgo(5), covers: ["src/x.ts"] }];
    expect(checkEvidence(e, NOW, () => hoursAgo(1))).toHaveLength(1);
    expect(checkEvidence(e, NOW, () => hoursAgo(10))).toHaveLength(0);
  });

  it("is RED on a ledger too many commits behind", () => {
    expect(checkLedger("L.md", MAX_LEDGER_COMMITS + 1)).toHaveLength(1);
    expect(checkLedger("L.md", MAX_LEDGER_COMMITS)).toHaveLength(0);
  });
});

describe("staleness watch — currency proven by something better than age", () => {
  it("skips files proven per push (regenerated, two-way, historical), but not others", () => {
    const old = [
      { file: "proven.json", at: hoursAgo(MAX_EVIDENCE_HOURS + 100), covers: null },
      { file: "aging.json", at: hoursAgo(MAX_EVIDENCE_HOURS + 100), covers: null },
    ];
    const stale = checkEvidence(old, NOW, never, new Set(["proven.json"]));
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("aging.json");
  });

  it("is RED when a workflow-bound baseline's checking run has not passed within its window", () => {
    const b = [{ file: "o.json", workflow: "ui-sweep.yml", maxDays: 8 }];
    expect(checkWorkflowBound(b, () => hoursAgo(24 * 9), NOW)).toHaveLength(1);
    expect(checkWorkflowBound(b, () => null, NOW)).toHaveLength(1);
    expect(checkWorkflowBound(b, () => hoursAgo(24 * 2), NOW)).toHaveLength(0);
  });

  it("binds the overlay baseline to the Friday overlay cron, not any green ui-sweep run", () => {
    const overlay = (WORKFLOW_BOUND as { file: string; event?: string; weekdayUtc?: number }[]).find((b) => b.file.includes("overlay-sweep"));
    expect(overlay).toMatchObject({ event: "schedule", weekdayUtc: 5 });
  });
});

describe("staleness watch — docs/audit reports (Q165)", () => {
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 864e5);

  it("is RED on a report untouched for longer than the limit, green inside it", () => {
    const touched: Record<string, Date> = {
      "docs/audit/old-report.md": daysAgo(MAX_REPORT_DAYS + 1),
      "docs/audit/new-report.md": daysAgo(MAX_REPORT_DAYS - 1),
    };
    const stale = checkReports(Object.keys(touched), NOW, (f: string) => touched[f]) as string[];
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("docs/audit/old-report.md");
    expect(checkReports(["docs/audit/untracked.md"], NOW, () => null)).toHaveLength(1);
  });

  it("counts only reports: not dated records, generated files, live docs or anything outside docs/audit", () => {
    const files = [
      "docs/audit/old-report.md",
      "docs/audit/launch-2026-09/NESTED.md",
      "docs/audit/morning/2026-09-12.md",
      "docs/audit/launch-2026-09/lanes/lh-x.md",
      "docs/audit/launch-2026-09/SURFACE.md",
      "docs/audit/launch-2026-09/PROTOCOL.md",
      "docs/audit/data.json",
      "docs/archive/old-report.md",
    ];
    const reports = listReports(files, RECORD_DIRS, new Set(["docs/audit/launch-2026-09/SURFACE.md"]));
    expect(reports).toEqual(["docs/audit/old-report.md", "docs/audit/launch-2026-09/NESTED.md"]);
  });

  it("scans the real tree (the inventory is not empty)", () => {
    const tracked = execFileSync("git", ["ls-files", "docs/audit"], { encoding: "utf8" }).split("\n").filter(Boolean);
    const reports = listReports(tracked, RECORD_DIRS, new Set()) as string[];
    expect(reports.length).toBeGreaterThan(3);
    expect(reports.some((f) => f.startsWith("docs/archive/"))).toBe(false);
  });

  it("every LIVE_DOCS exemption exists and its named consumer still names it (two-way)", () => {
    const entries = Object.entries(LIVE_DOCS as Record<string, { consumer: string; why: string }>);
    expect(entries.length).toBeGreaterThan(0);
    for (const [doc, { consumer, why }] of entries) {
      expect(existsSync(doc), doc).toBe(true);
      expect(why.length, doc).toBeGreaterThan(10);
      const base = (p: string) => p.split("/").pop() as string;
      expect(existsSync(consumer), consumer).toBe(true);
      const linked = consumer !== doc && (readFileSync(consumer, "utf8").includes(base(doc)) || readFileSync(doc, "utf8").includes(base(consumer)));
      expect(linked, `${doc} and its consumer ${consumer} no longer name each other`).toBe(true);
    }
  });
});
