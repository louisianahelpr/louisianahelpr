/**
 * Q417 (c): an admin can end a recurring series from the admin console.
 *
 * The server half (rpc_admin_end_recurring_series, 20261012194707: admin
 * only, never a party, a reason in admin_audit_log, idempotent) was built and
 * proven by src/test/pglite/seriesEndByPlatform.pglite.mjs; nothing in the app
 * called it, so ending a series as the platform still meant SQL by hand.
 *
 * Held here (pure functions plus the wiring, no mocked backend):
 *   - the section shows for a series and for one of its visits, and for
 *     nothing else;
 *   - the reason floor the button enforces is the server's own;
 *   - the RPC is called only after the biometric prompt says yes;
 *   - the admin job dialog renders it;
 *   - what the admin is told matches each answer the RPC gives.
 * NOT LOOKED AT on a real screen yet (no browser work in this lane).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { END_SERIES_REASON_MIN, endSeriesResultMessage, isSeriesJob, offersSeriesEnd } from "@/components/admin/adminJobs/EndSeriesSection";
import { ADMIN_RPC_ERROR_COPY } from "@/components/admin/adminRpcErrorCopy";

// Shown able to fail: each line alone reds this test.
// @mutate src/components/admin/adminJobs/EndSeriesSection.tsx | return (Array.isArray(job.recurrence_days) && job.recurrence_days.length > 0) \|\| !!job.parent_job_id; | return Array.isArray(job.recurrence_days) && job.recurrence_days.length > 0;
// @mutate src/components/admin/adminJobs/EndSeriesSection.tsx | export const END_SERIES_REASON_MIN = 10; | export const END_SERIES_REASON_MIN = 3;
// @mutate src/components/admin/adminJobs/EndSeriesSection.tsx | const ok = await requireBiometric("Confirm ending this recurring series"); | const ok = true;
// @mutate src/components/admin/adminJobs/EndSeriesSection.tsx | return !(job.parent_job_id == null && job.status === "cancelled"); | return true;
// @mutate src/components/admin/adminJobs/EndSeriesSection.tsx | if (busy) return;\n    setBusy(true);\n    const ok | const ok
// @mutate src/components/admin/adminJobs/JobDetailDialog.tsx | && <EndSeriesSection job={detailJob} />} | && null}
// @mutate src/components/admin/adminJobs/EndSeriesSection.tsx | if (r.action === "already_ended") | if (r.action === "ended")
// @mutate src/components/admin/adminJobs/EndSeriesSection.tsx | if (action !== "ended" && action !== "already_ended") { | if (false) {

const ROOT = process.cwd();
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

describe("Q417 (c): an admin ends a recurring series from the job dialog", () => {
  it("shows for a series and for one of its visits, never for a one-off job", () => {
    expect(isSeriesJob({ recurrence_days: [1, 3], parent_job_id: null })).toBe(true);
    expect(isSeriesJob({ recurrence_days: null, parent_job_id: "parent-1" })).toBe(true);
    expect(isSeriesJob({ recurrence_days: null, parent_job_id: null })).toBe(false);
    expect(isSeriesJob({ recurrence_days: [], parent_job_id: null })).toBe(false);
    expect(isSeriesJob({})).toBe(false);
    // A cancelled series parent has ended already: not offered (review of 0faa957c8, #3).
    expect(offersSeriesEnd({ recurrence_days: [1], parent_job_id: null, status: "cancelled" })).toBe(false);
    expect(offersSeriesEnd({ recurrence_days: [1], parent_job_id: null, status: "open" })).toBe(true);
    // A visit's own cancel says nothing about its series.
    expect(offersSeriesEnd({ recurrence_days: null, parent_job_id: "p", status: "cancelled" })).toBe(true);
    expect(offersSeriesEnd({ recurrence_days: null, parent_job_id: null, status: "open" })).toBe(false);
  });

  it("the reason floor is the server's own", () => {
    const def = effectiveDefs(join(ROOT, "supabase/migrations")).get("rpc_admin_end_recurring_series");
    const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");
    expect(body.length).toBeGreaterThan(500);
    const floor = body.match(/IF length\(btrim\(COALESCE\(p_reason, ''\)\)\) < (\d+) THEN RAISE EXCEPTION 'end_series_needs_reason'/);
    expect(floor?.[1]).toBe(String(END_SERIES_REASON_MIN));
  });

  it("calls the RPC only after the biometric prompt, with the trimmed reason, and the dialog renders it", () => {
    const src = read("src/components/admin/adminJobs/EndSeriesSection.tsx");
    const gate = src.indexOf(`const ok = await requireBiometric("Confirm ending this recurring series");`);
    const rpc = src.indexOf(`supabase.rpc("rpc_admin_end_recurring_series", { p_job_id: job.id, p_reason: reason.trim() })`);
    expect(gate).toBeGreaterThan(0);
    expect(rpc).toBeGreaterThan(gate);
    expect(src.slice(gate, rpc)).toMatch(/if \(!ok\) \{\s*setBusy\(false\);\s*return;/);
    // Busy before the prompt, so a double press sends one call (review of 0faa957c8, #4).
    const busyAt = src.indexOf("if (busy) return;\n    setBusy(true);");
    expect(busyAt).toBeGreaterThan(0);
    expect(busyAt).toBeLessThan(gate);
    expect(src).toContain("disabled={busy || reason.trim().length < END_SERIES_REASON_MIN}");
    expect(src).toContain("if (!offersSeriesEnd(job)) return null;");
    // An answer that is not ended / already_ended is never shown as success.
    const guard = src.indexOf(`if (action !== "ended" && action !== "already_ended") {`);
    const success = src.indexOf("confirmConsequential(endSeriesResultMessage(data));");
    expect(guard).toBeGreaterThan(rpc);
    expect(success).toBeGreaterThan(guard);
    const dialog = read("src/components/admin/adminJobs/JobDetailDialog.tsx");
    expect(dialog).toContain("<EndSeriesSection job={detailJob} />");
  });

  it("tells the admin what the RPC answered", () => {
    expect(endSeriesResultMessage({ action: "ended", ended_on: "2026-10-15", booked_visits_remaining: 0 })).toMatch(/^Series ended\. No new visits/);
    // Who the server tells: the poster (when there is one) and the Helprs booked on it (review of 0faa957c8, #2).
    expect(endSeriesResultMessage({ action: "ended" })).toMatch(/the poster and the Helprs booked on it were told/);
    expect(endSeriesResultMessage({ action: "ended", booked_visits_remaining: 1 })).toMatch(/1 visit already booked still goes ahead unless cancelled\.$/);
    expect(endSeriesResultMessage({ action: "ended", booked_visits_remaining: 2 })).toMatch(/2 visits already booked still go ahead unless cancelled\.$/);
    expect(endSeriesResultMessage({ action: "already_ended", ended_on: "2026-10-01" })).toBe("This series had already ended (2026-10-01). Nothing changed.");
  });

  it("every refusal an admin can reach has words (inventory floor)", () => {
    const codes = Object.keys(ADMIN_RPC_ERROR_COPY.rpc_admin_end_recurring_series);
    expect(codes.length).toBeGreaterThan(3);
    for (const c of ["end_series_needs_reason", "admin_is_party", "not_a_series", "job_not_found"]) expect(codes).toContain(c);
  });
});
