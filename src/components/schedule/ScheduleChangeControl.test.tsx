/**
 * Q407 (8): the change-request control on a booked one-time job. The person
 * a request is addressed to gets Accept / Decline; the asker sees it waiting;
 * a request past its original start is not shown (it has expired); both
 * parties' cards carry the control.
 *
 * @mutate src/lib/scheduleChange.ts |   if (!row \|\| Date.parse(row.expires_at) <= now.getTime()) return null; |   if (!row) return null;
 * @mutate src/components/schedule/ScheduleChangeControl.tsx |   const askedOfMe = !!pending && pending.responder_id === userId; |   const askedOfMe = !!pending;
 * @mutate src/pages/posts/PostedJobCard.tsx | <ScheduleChangeForJob job={job} userId={userId} viewer="poster" expanded={isExpanded} /> | <span data-x />
 * @mutate src/pages/jobs/AppliedJobCard.tsx | <ScheduleChangeForJob job={job} userId={userId} viewer="helper" expanded={isExpanded} /> | <span data-x />
 * @mutate src/components/series/JobSeriesCardControls.tsx |     <ScheduleChangeControl | <span data-x
 * @mutate src/components/schedule/ScheduleChangeControl.tsx | primaryDisabled={busy \|\| !date \|\| unchanged} | primaryDisabled={busy \|\| !date}
 * @mutate src/components/schedule/ScheduleChangeControl.tsx | const unchanged = date === dateNeeded && time === (startTime ?? "").slice(0, 5); | const unchanged = date === dateNeeded;
 * Q1262(2): a clash at accept is said as a clash, not as "expired".
 * @mutate src/lib/scheduleChange.ts |   if (reply.status === "declined" && reply.reason === "schedule_change_clash") return "clash"; |   if (false) return "clash";
 * @mutate src/components/schedule/ScheduleChangeControl.tsx |                   if (s === "clash") return | if (false) return
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
import { toast } from "sonner";

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

  it("Q1262(2): an accept the server declines for a clash says the Helpr is booked, not that it expired", async () => {
    row.value = req();
    rpc.mockResolvedValue({ data: { status: "declined", reason: "schedule_change_clash" }, error: null });
    renderIt(HELPR);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/already booked at that time/)));
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/expired/));
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

  it("Send waits for a change: the job's own date and time cannot be sent (Q772, the RPC refuses schedule_change_same)", async () => {
    row.value = null;
    renderIt(POSTER);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a new date or time" }));
    const send = () => screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    expect(send().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "09:00" } });
    expect(send().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-11" } });
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  });

  it("both parties' cards carry it", () => {
    // PostedJobCard renders the poster's Q407 controls through PostedJobSeriesControls.
    expect(readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8")).toMatch(/<PostedJobSeriesControls job=\{job\}/);
    // Since 2026-10-05 the poster card renders it itself, last in the expanded body.
    expect(readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8")).toMatch(/<ScheduleChangeForJob job=\{job\} userId=\{userId\} viewer="poster"/);
    expect(readFileSync("src/pages/jobs/AppliedJobCard.tsx", "utf8")).toMatch(/<ScheduleChangeForJob job=\{job\} userId=\{userId\} viewer="helper"/);
    expect(readFileSync("src/components/series/JobSeriesCardControls.tsx", "utf8")).toMatch(/<ScheduleChangeControl\s/);
  });
});
