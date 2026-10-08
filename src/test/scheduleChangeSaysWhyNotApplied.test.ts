/**
 * Owner, 2026-10-08: "the poster accepted the Helpr's change time/date request
 * but that does not reflect anywhere". Measured: request 1f6349c9 asked for
 * 1:30 PM today, was accepted at 1:30:19 PM and expired; the accepter got a
 * green "expired" toast and the asker nothing. The server now refuses a new
 * start under an hour out and returns WHY an answer expired (and notifies the
 * asker; proof: src/test/pglite/scheduleChangeLeadAndExpiry.pglite.mjs). The
 * client says the reason, as a warning.
 *
 * @mutate src/lib/scheduleChange.ts |   if (reply.status === "expired" && reply.reason) return `expired:${reply.reason}`; |
 * @mutate src/components/schedule/ScheduleChangeControl.tsx |                   return { warn: expiredMessage(s) }; |                   return expiredMessage(s);
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { respondScheduleChange } from "@/lib/scheduleChange";
import { expiredMessage } from "@/components/schedule/ScheduleChangeControl";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

describe("a change that could not be applied says why", () => {
  it("the answer carries the server's reason", async () => {
    rpc.mockResolvedValueOnce({ data: { status: "expired", reason: "new_time_passed" }, error: null });
    expect(await respondScheduleChange("r1", true)).toBe("expired:new_time_passed");
  });

  it("each reason has its own sentence, all saying nothing changed and they were told", () => {
    expect(expiredMessage("expired:new_time_passed")).toMatch(/new time had already started/);
    expect(expiredMessage("expired:job_started")).toMatch(/original start arrived/);
    expect(expiredMessage("expired:job_changed")).toMatch(/job changed/);
    for (const r of ["new_time_passed", "job_started", "job_changed"]) expect(expiredMessage(`expired:${r}`)).toMatch(/told/);
  });

  it("an expired or clashing accept is a WARNING, never a success toast", () => {
    const src = readFileSync(join(process.cwd(), "src/components/schedule/ScheduleChangeControl.tsx"), "utf8");
    expect(src).toMatch(/return \{ warn: expiredMessage\(s\) \};/);
    expect(src).toMatch(/if \(s === "clash"\) return \{ warn:/);
  });

  it("asking for a start under an hour out has its own words", () => {
    expect(rpcErrorMessage("request_job_schedule_change", { message: "schedule_change_too_soon" } as never)).toMatch(/at least an hour/);
  });
});
