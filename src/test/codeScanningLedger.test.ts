// @mutate scripts/lib/codeScanningLedger.mjs | const serious = alerts.some( | const serious = false && alerts.some(
// @mutate scripts/lib/codeScanningLedger.mjs | if (!prev) return true; | if (!prev) return false;
// @mutate scripts/lib/codeScanningLedger.mjs | return prev.length !== numbers.length \|\| prev.some( | return prev.length !== numbers.length && prev.some(
// @mutate scripts/ops-alert-ledger.mjs | sample: item.sample, sampleRef: item.sampleRef, verifyKind: "manual", | sample: item.sample, sampleRef: item.sampleRef, verifyKind: "workflow", verifyRef: "prod-errors.yml",
// @mutate .github/workflows/prod-errors.yml |   security-events: read | 
/**
 * GitHub code-scanning alerts reach the ops alert ledger (2026-10-03).
 *
 * 63 code-scanning alerts were open on main and no session had seen them: the
 * session-start summary, /admin?view=health and the Slack digest read only the
 * ledger. The hourly sync now keeps ONE item listing the open alerts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
// @ts-expect-error - plain .mjs tool script, no types
import { CODE_SCANNING_JQ, codeScanningChanged, summarizeCodeScanning } from "../../scripts/lib/codeScanningLedger.mjs";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("summarizeCodeScanning", () => {
  it("no open alerts: no item (the sync closes the old one)", () => {
    expect(summarizeCodeScanning([])).toBeNull();
  });

  it("a high or critical alert makes the item an ERROR; it lists rules by count and keeps sorted numbers", () => {
    const s = summarizeCodeScanning([
      { number: 12, rule: "js/redos", severity: "high" },
      { number: 3, rule: "js/incomplete-sanitization", severity: "medium" },
      { number: 7, rule: "js/redos", severity: "high" },
    ]);
    expect(s?.severity).toBe("error");
    expect(s?.sample).toBe("3 open: 2 js/redos, 1 js/incomplete-sanitization");
    expect(s?.sampleRef).toEqual({ alerts: [3, 7, 12] });
  });

  it("only medium/low findings: a WARNING", () => {
    expect(summarizeCodeScanning([{ number: 1, rule: "actions/missing-workflow-permissions", severity: "medium" }])?.severity).toBe(
      "warning",
    );
  });
});

describe("codeScanningChanged", () => {
  it("bumps the item only when the set of open alerts changes, so an hourly sync does not inflate its count", () => {
    expect(codeScanningChanged(undefined, [1, 2])).toBe(true);
    expect(codeScanningChanged({ alerts: [1, 2] }, [1, 2])).toBe(false);
    expect(codeScanningChanged({ alerts: [1, 2] }, [1, 3])).toBe(true);
    expect(codeScanningChanged({ alerts: [1, 2] }, [1])).toBe(true);
  });
});

describe("the hourly sync reads code scanning and can never close the item on a green run", () => {
  const src = read("scripts/ops-alert-ledger.mjs");

  it("sync() asks GitHub for the OPEN alerts with the shared jq filter", () => {
    expect(src).toContain("repos/${repo}/code-scanning/alerts?state=open&per_page=100");
    expect(src).toContain("CODE_SCANNING_JQ");
    expect(CODE_SCANNING_JQ).toMatch(/security_severity_level/);
  });

  it("the item is verified by hand (manual), so step 3 cannot close it just because prod-errors.yml ran green", () => {
    const record = src.slice(src.indexOf("title: CODE_SCANNING_TITLE"), src.indexOf("title: CODE_SCANNING_TITLE") + 220);
    expect(record).toContain('verifyKind: "manual"');
    expect(record).not.toContain("verifyRef");
  });

  it("prod-errors.yml's token may read code-scanning alerts", () => {
    const wf = parse(read(".github/workflows/prod-errors.yml")) as { permissions?: Record<string, string> };
    expect(wf.permissions?.["security-events"]).toBe("read");
  });
});
