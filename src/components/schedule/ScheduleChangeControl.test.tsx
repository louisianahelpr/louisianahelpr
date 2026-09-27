/**
 * Q407 (8): the change-request control on a booked one-time job. The person
 * a request is addressed to gets Accept / Decline; the asker sees it waiting;
 * a request past its original start is not shown (it has expired); both
 * parties' cards carry the control.
 *
 * @mutate src/lib/scheduleChange.ts |   if (!row \|\| Date.parse(row.expires_at) <= now.getTime()) return null; |   if (!row) return null;
 * @mutate src/components/schedule/ScheduleChangeControl.tsx |   const askedOfMe = !!pending && pending.responder_id === userId; |   const askedOfMe = !!pending;
 * @mutate src/pages/posts/PostedJobCard.tsx |               <ScheduleChangeControl | <span data-x
 * @mutate src/pages/jobs/AppliedJobCard.tsx |             <ScheduleChangeControl | <span data-x
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const row = vi.hoisted(() => ({ value: null as unknown }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.maybeSingle = () => Promise.resolve({ data: row.value, error: null });
  return { supabase: { from: () => c, rpc } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ScheduleChangeControl } from "./ScheduleChangeControl";
import { fetchPendingScheduleChange } from "@/lib/scheduleChange";

const POSTER = "poster-1";
const HELPR = "helpr-1";
const req = (over: Record<string, unknown> = {}) => ({
  id: "r1", job_id: "j1", requested_by: POSTER, responder_id: HELPR,
  old_date: "2026-09-10", old_start_time: "09:00:00", new_date: "2026-09-12", new_start_time: "14:30:00",
  status: "pending", expires_at: "2026-09-10T14:00:00Z", ...over,
});
const renderIt = (userId: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScheduleChangeControl jobId="j1" jobTitle="Paint" userId={userId} dateNeeded="2026-09-10" startTime="09:00:00" />
    </QueryClientProvider>,
  );

describe("ScheduleChangeControl", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T17:00:00Z"));
    rpc.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("the person asked sees Accept and Decline, and Accept calls respond_job_schedule_change", async () => {
    row.value = req();
    rpc.mockResolvedValue({ data: { status: "accepted" }, error: null });
    renderIt(HELPR);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("respond_job_schedule_change", { p_request_id: "r1", p_accept: true }));
  });

  it("the asker cannot answer their own request; they see it waiting", async () => {
    row.value = req();
    renderIt(POSTER);
    expect(await screen.findByText(/You asked to move this to/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("a request past its original start is expired: the read drops it, so nothing can be answered", async () => {
    row.value = req({ expires_at: "2026-09-05T16:00:00Z" });
    await expect(fetchPendingScheduleChange("j1")).resolves.toBeNull();
    row.value = req({ expires_at: "2026-09-05T18:00:00Z" });
    await expect(fetchPendingScheduleChange("j1")).resolves.toMatchObject({ id: "r1" });
  });

  it("asking sends request_job_schedule_change with the picked date and time", async () => {
    row.value = null;
    rpc.mockResolvedValue({ data: { request_id: "r2" }, error: null });
    renderIt(POSTER);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a new date or time" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-13" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "15:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("request_job_schedule_change", { p_job_id: "j1", p_date: "2026-09-13", p_start_time: "15:00:00" }),
    );
  });

  it("both parties' cards carry it", () => {
    expect(readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8")).toMatch(/<ScheduleChangeControl\s/);
    expect(readFileSync("src/pages/jobs/AppliedJobCard.tsx", "utf8")).toMatch(/<ScheduleChangeControl\s/);
  });
});
