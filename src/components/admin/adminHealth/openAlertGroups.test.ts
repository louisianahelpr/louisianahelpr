/**
 * NOID-24 M7 (admin audit E4, 2026-10-30): the Health page's Open Alerts were one flat list of up to 50 rows by last seen,
 * so a critical item sat among ~80 errors (and could fall past the 50th), and the admin home's "Open errors" counted
 * CI rows. Lead instruction (b108 handoff): don't count CI rows (source nightly-red) in the home's open errors; never
 * close or delete ledger rows.
 *
 * The CI marker, measured from the code (not from prod): CI rows are written with source_kind 'nightly_red' and
 * source 'nightly-red' by main-red-watch.yml:150 (`record --source-kind nightly_red --source "nightly-red"`) and by
 * the label sync in scripts/ops-alert-ledger.mjs:246 (source = the issue label, ALERT_ISSUE_LABELS "nightly-red").
 * The other nightly_red labels (prod-down, prod-errors, supabase-usage, schedule-stalled, migration-drift) are real
 * ops alerts and stay counted.
 *
 * @mutate src/components/admin/adminHealth/useOpenAlerts.ts | .neq("source", CI_SOURCE) | .neq("source", "__none__")
 * @mutate src/components/admin/adminHealth/useOpenAlerts.ts |   const rank = (r: LedgerRow) => (r.source === CI_SOURCE ? 2 : SEVERITY_GROUP[r.severity] ?? 1); |   const rank = (_r: LedgerRow) => 1;
 * @mutate src/components/admin/adminHealth/useOpenAlerts.ts |     .limit(OPEN_ALERT_LIMIT); |     .limit(50);
 */
import { describe, expect, it, vi } from "vitest";

const calls: { table: string; op: string; args: unknown[] }[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "neq", "in", "order", "limit", "eq"]) {
      b[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return b; };
    }
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});

import { CI_SOURCE, OPEN_ALERT_LIMIT, fetchOpenAlerts, openAlertChecks, seriousOpenAlertCount, type LedgerRow } from "./useOpenAlerts";

const row = (id: string, severity: string, last: string, over: Partial<LedgerRow> = {}): LedgerRow => ({
  id, severity, status: "open", source_kind: "error_logs", source: "app", title: `t-${id}`, count: 1, last_seen: last,
  verify_kind: "manual", verify_note: null, ...over,
});

describe("NOID-24 M7: Open Alerts grouped, critical first, CI rows apart and not counted", () => {
  it("the CI marker is the code's own: source 'nightly-red'", () => {
    expect(CI_SOURCE).toBe("nightly-red");
  });

  it("groups: critical (fatal + critical) first, then errors, then CI, then warnings and notes; newest first inside each", () => {
    const out = openAlertChecks([
      row("w", "warning", "2026-10-30T10:00:00Z"),
      row("e-old", "error", "2026-10-01T10:00:00Z"),
      row("ci", "error", "2026-10-30T11:00:00Z", { source_kind: "nightly_red", source: "nightly-red" }),
      row("e-new", "error", "2026-10-29T10:00:00Z"),
      row("c-old", "critical", "2026-09-01T10:00:00Z"),
      row("prod-down", "critical", "2026-10-30T09:00:00Z", { source_kind: "nightly_red", source: "prod-down" }),
      row("f", "fatal", "2026-10-15T10:00:00Z"),
      row("i", "info", "2026-10-30T12:00:00Z"),
    ]);
    expect(out.filter((c) => c.groupStart).map((c) => c.group)).toEqual(["Critical", "Errors", "CI and nightly checks", "Warnings and notes"]);
    expect(out.map((c) => [c.id, c.group])).toEqual([
      ["prod-down", "Critical"],
      ["f", "Critical"],
      ["c-old", "Critical"],
      ["e-new", "Errors"],
      ["e-old", "Errors"],
      ["ci", "CI and nightly checks"],
      ["i", "Warnings and notes"],
      ["w", "Warnings and notes"],
    ]);
  });

  it("reads past the old 50-row cap, and the home's serious count leaves CI rows out", async () => {
    expect(OPEN_ALERT_LIMIT).toBeGreaterThanOrEqual(200);
    calls.length = 0;
    await seriousOpenAlertCount();
    const ops = calls.filter((c) => c.table === "ops_alert_ledger").map((c) => [c.op, ...c.args]);
    expect(ops).toContainEqual(["neq", "status", "closed"]);
    expect(ops).toContainEqual(["in", "severity", ["fatal", "critical", "error"]]);
    expect(ops).toContainEqual(["neq", "source", "nightly-red"]);
    calls.length = 0;
    await fetchOpenAlerts();
    const list = calls.filter((c) => c.table === "ops_alert_ledger").map((c) => [c.op, ...c.args]);
    expect(list).toContainEqual(["limit", OPEN_ALERT_LIMIT]);
    // The Health list keeps CI rows (in their own group): only the home's count leaves them out.
    expect(list).not.toContainEqual(["neq", "source", "nightly-red"]);
  });
});
