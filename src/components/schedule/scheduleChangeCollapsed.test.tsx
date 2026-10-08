/**
 * Owner, 2026-10-08 (Q1551): "if they didn't click into the job to open it they
 * have no way of knowing they asked for a different time".
 *
 * The class: a date/time request waiting on THIS person is on their collapsed
 * card, with Accept and Decline; nothing else of the control is (the ask, and
 * a request this person sent, stay behind the expand).
 *
 * @mutate src/components/schedule/ScheduleChangeControl.tsx |   if (askedOfMeOnly && !askedOfMe) return null; |
 * @mutate src/components/series/JobSeriesCardControls.tsx |           askedOfMeOnly={!expanded} |           askedOfMeOnly={false}
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import { ScheduleChangeForJob } from "@/components/series/JobSeriesCardControls";

const job = {
  id: "j1", title: "Mow", status: "accepted", customer_id: "poster", helper_id: "helper",
  helper_confirmed_at: "2026-10-07T12:00:00Z", date_needed: "2099-10-20", start_time: "14:00:00",
  parent_job_id: null, recurrence_days: null, is_group_job: false,
  // useActivityData tags a job whose request waits on this person (one read for the list).
  schedule_change_asked_of_me: true,
};
const pending = (asker: string, responder: string) => ({
  id: "r1", job_id: "j1", requested_by: asker, responder_id: responder, new_date: "2099-10-21", new_start_time: "15:00:00",
  status: "pending", expires_at: "2099-10-20T19:00:00Z",
});

function renderCard(userId: string, viewer: "poster" | "helper", request: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["schedule-change", "j1"], request);
  return render(
    <QueryClientProvider client={qc}>
      <ScheduleChangeForJob job={job as never} userId={userId} viewer={viewer} expanded={false} hideAsk />
    </QueryClientProvider>,
  );
}

describe("a date/time request shows on the collapsed card of the person asked", () => {
  it("asked of the poster: Accept and Decline on the collapsed card", () => {
    renderCard("poster", "poster", pending("helper", "poster"));
    expect(screen.getByRole("button", { name: /Accept/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Decline/ })).toBeTruthy();
  });
  it("sent BY this person: nothing collapsed", () => {
    const { container } = renderCard("helper", "helper", pending("helper", "poster"));
    expect(container.querySelector("[data-schedule-change]")).toBeNull();
  });
  it("an untagged job mounts nothing collapsed (no per-card query)", () => {
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <ScheduleChangeForJob job={{ ...job, schedule_change_asked_of_me: false } as never} userId="poster" viewer="poster" expanded={false} hideAsk />
      </QueryClientProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("no request: nothing collapsed (the ask stays behind the expand)", () => {
    const { container } = renderCard("poster", "poster", null);
    expect(container.querySelector("[data-schedule-change]")).toBeNull();
  });
});
