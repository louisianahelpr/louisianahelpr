/**
 * Q63: every quota the monitor reads is its own scoreboard row, graded from
 * the newest quota-monitor.yml run's report table: OK is PASS, the 70% step
 * WARN, the 90% and 100% steps FAIL, and a quota nothing can read UNKNOWN
 * with its reason (never PASS). No table in the log is one UNKNOWN row, never
 * an empty list that reads as "nothing is near a limit".
 *
 * @mutate scripts/scoreboard.mjs | export const QUOTA_STATUS = { OK: "PASS", WARN: "WARN", HIGH: "FAIL", OVER: "FAIL" }; | export const QUOTA_STATUS = { OK: "PASS", WARN: "WARN", HIGH: "WARN", OVER: "FAIL" };
 * @mutate scripts/scoreboard.mjs |   if (!table) return [unknown("quotas", signal, `run ${run.id} has no quota table in its log`, { source: "quota-monitor.yml" })]; |   if (!table) return [];
 * @mutate scripts/scoreboard.mjs |     return { ...base, status: stale ? "STALE" : mapped, | return { ...base, status: mapped,
 * @mutate scripts/scoreboard.mjs |   rows.push(...quotaRows(wf.runsByFile.get("quota-monitor.yml"), now, (id) => sh("gh", ["run", "view", String(id), "--log"], { timeout: 90000 }))); |   // quota rows dropped
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import * as sb from "../../scripts/scoreboard.mjs";

const ROOT = join(__dirname, "..", "..");
const NOW = new Date("2026-09-27T22:00:00Z");
const pre = "Quotas and limits (Q63)\tRead every quota\t2026-09-27T20:44:50.3927250Z ";
const LOG = [
  "## Quota and limit monitor (Q63)",
  "| Service | Quota | Used | Limit | % | Status | Window | Note |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| Supabase | Database size | 88.9 MB | 8.00 GB  | 1.1% | **OK** | now |  |",
  "| Resend | Emails sent (last 24h) | 75 | 100 emails/day | 75% | **WARN** | trailing 24h | a \\| b |",
  "| Resend | Emails sent this calendar month | 2,800 | 3,000 emails/month | 93.3% | **HIGH** | month |  |",
  "| Sentry | Session replays | 644 | 50 replays/month | 1288% | **OVER** | this usage period |  |",
  "| Supabase | Egress | — | 250.00 GB /month | — | **NOT-MONITORED** | billing cycle | No readable API. |",
  "",
  "### Where each limit comes from",
].map((l) => pre + l).join("\n");
const run = (daysAgo = 0.05) => ({ id: 7, conclusion: "failure", event: "schedule", url: "u", updatedAt: new Date(NOW.getTime() - daysAgo * 864e5).toISOString() });

describe("scoreboard: one row per quota (Q63)", () => {
  it("grades each quota: OK PASS, 70% WARN, 90%/100% FAIL, unreadable UNKNOWN with a reason", () => {
    const rows = sb.quotaRows([run()], NOW, () => LOG);
    expect(rows.map((r: { signal: string; status: string }) => [r.signal, r.status])).toEqual([
      ["Supabase: Database size", "PASS"],
      ["Resend: Emails sent (last 24h)", "WARN"],
      ["Resend: Emails sent this calendar month", "FAIL"],
      ["Sentry: Session replays", "FAIL"],
      ["Supabase: Egress", "UNKNOWN"],
    ]);
    expect(rows[1].note).toContain("75 of 100 emails/day (75%)");
    expect(rows[1].note).toContain("a | b");
    expect(rows[4].note).toMatch(/^UNKNOWN: quota monitor says NOT-MONITORED/);
    for (const r of rows) expect(() => sb.renderRow(r)).not.toThrow();
  });

  it("an old run is STALE, never PASS", () => {
    const rows = sb.quotaRows([run(sb.MAX_RUN_AGE_DAYS + 1)], NOW, () => LOG);
    expect(rows[0].status).toBe("STALE");
  });

  it("no table, no run or an unreadable log is one UNKNOWN row, never an empty list", () => {
    for (const rows of [
      sb.quotaRows([run()], NOW, () => pre + "nothing here"),
      sb.quotaRows([], NOW, () => LOG),
      sb.quotaRows([run()], NOW, () => { throw new Error("gh down"); }),
    ]) {
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("UNKNOWN");
      expect(rows[0].note).toMatch(/^UNKNOWN: \S/);
    }
    expect(sb.parseQuotaReport(pre + "nothing")).toBeNull();
  });

  it("liveRows includes the quota rows", () => {
    const src = readFileSync(join(ROOT, "scripts/scoreboard.mjs"), "utf8");
    const live = src.slice(src.indexOf("export async function liveRows"));
    expect(live).toMatch(/rows\.push\(\.\.\.quotaRows\(wf\.runsByFile\.get\("quota-monitor\.yml"\)/);
  });
});
