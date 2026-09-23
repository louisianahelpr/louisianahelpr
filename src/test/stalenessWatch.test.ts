// @mutate scripts/check-staleness.mjs | if (hours > MAX_EVIDENCE_HOURS) { | if (hours > MAX_EVIDENCE_HOURS * 1000) {
/*
 * The staleness watch (scripts/check-staleness.mjs, run nightly by
 * staleness-watch.yml) must itself be able to fail — a freshness check that
 * always says "fresh" is the thing it exists to prevent.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs script, no declaration file
import { checkEvidence, checkLedger, evidenceTimestamp, listEvidence, MAX_EVIDENCE_HOURS, MAX_LEDGER_COMMITS } from "../../scripts/check-staleness.mjs";

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
