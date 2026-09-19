/**
 * The stuck-job queue screen, in the four states it can actually be in.
 *
 * The bug it exists for: `20260919143637_stalled_completion_nudges.sql` shipped
 * a sweep that escalates a job stuck `in_progress` — escrow held, nobody
 * marking it done — to an admin at +48h, and shipped with NO screen. The
 * escalation existed only as a notification and a Slack line.
 *
 * Four things are asserted, each of which has a real failure behind it:
 *   1. a row carries everything a decision needs, WITHOUT leaving the screen;
 *   2. a same-frame double tap resolves ONCE (the house in-flight guard);
 *   3. `false` from the RPC — the second tap, or someone else first — is told
 *      as "already cleared", never as success;
 *   4. the deploy-lag window (PGRST202) is SHOWN, not rendered as an empty
 *      queue, and no control on this screen moves money.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const rpcMock = vi.hoisted(() => vi.fn());
const profilesRows = vi.hoisted(() => ({
  value: [
    { user_id: "poster-1", full_name: "Pat Poster" },
    { user_id: "helper-1", full_name: "Hallie Helpr" },
  ] as unknown[],
}));
const toastMock = vi.hoisted(() => ({
  base: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      select: () => ({
        in: async () => ({ data: profilesRows.value, error: null }),
      }),
    }),
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(toastMock.base, { error: toastMock.error, success: toastMock.success }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn(async () => {}) }));

import AdminStalledJobs from "./AdminStalledJobs";
import type { StalledQueueRow } from "./adminStalledJobs/stalledQueue";

const JOB_ID = "6f1c3d12-0a4c-4f2f-9f2d-5c1f0b8a7e21";

const queueRow = (over: Partial<StalledQueueRow> = {}): StalledQueueRow => ({
  job_id: JOB_ID,
  title: "Haul off storm debris",
  customer_id: "poster-1",
  helper_id: "helper-1",
  budget: 240,
  date_needed: "2026-09-15",
  start_time: "09:00:00",
  estimated_hours: 3,
  status: "in_progress",
  payment_status: "escrow",
  first_sent_at: "2026-09-16T14:00:00Z",
  second_sent_at: "2026-09-17T14:00:00Z",
  escalated_at: "2026-09-18T14:00:00Z",
  resolved_at: null,
  ...over,
});

const renderQueue = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminStalledJobs />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const doubleClick = (button: HTMLElement) => {
  act(() => {
    button.click();
    button.click();
  });
};

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  rpcMock.mockReset();
  toastMock.base.mockReset();
  toastMock.error.mockReset();
  toastMock.success.mockReset();
});

describe("AdminStalledJobs — a row an admin can decide from", () => {
  it("carries the job, both parties, the money, the lateness and every nudge stage", async () => {
    rpcMock.mockImplementation(async () => ({ data: [queueRow()], error: null }));
    renderQueue();

    expect(await screen.findByText("Haul off storm debris")).toBeInTheDocument();
    // The money and the state it is in.
    expect(screen.getByText(/\$240 held · payment escrow/)).toBeInTheDocument();
    // How late, from the sweep's own arithmetic.
    expect(screen.getByText(/past the scheduled end/)).toBeInTheDocument();
    // Both parties, each linked to their profile — no leaving the screen to
    // find out who these people are.
    const poster = screen.getByRole("link", { name: "Pat Poster" });
    const helper = screen.getByRole("link", { name: "Hallie Helpr" });
    expect(poster).toHaveAttribute("href", "/user/poster-1");
    expect(helper).toHaveAttribute("href", "/user/helper-1");
    expect(screen.getByRole("link", { name: /Open the job/ })).toHaveAttribute("href", `/jobs/${JOB_ID}`);
    // The ladder: which nudges actually went out, and when.
    expect(screen.getByText(/Both parties reminded/)).toBeInTheDocument();
    expect(screen.getByText(/Reminded again/)).toBeInTheDocument();
    expect(screen.getByText(/Escalated to this queue/)).toBeInTheDocument();
  });

  it("offers NO money control — only the record-that-a-human-looked action", async () => {
    rpcMock.mockImplementation(async () => ({ data: [queueRow()], error: null }));
    renderQueue();
    await screen.findByText("Haul off storm debris");

    const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(labels.some((l) => /release|refund|pay out|payout|charge/i.test(l))).toBe(false);
    expect(labels.some((l) => /Mark Reviewed/.test(l))).toBe(true);
    expect(screen.getByText(/Nothing here moves money/)).toBeInTheDocument();
  });
});

describe("AdminStalledJobs — resolving", () => {
  it("a same-frame double tap calls resolve_stalled_job_flag ONCE", async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "admin_stalled_job_queue"
        ? { data: [queueRow()], error: null }
        : new Promise(() => {}), // the resolve stays in flight
    );
    renderQueue();

    doubleClick(await screen.findByRole("button", { name: "Mark Reviewed" }));
    await waitFor(() =>
      expect(rpcMock.mock.calls.filter((c) => c[0] === "resolve_stalled_job_flag")).toHaveLength(1),
    );
    await settle();
    expect(rpcMock.mock.calls.filter((c) => c[0] === "resolve_stalled_job_flag")).toHaveLength(1);
    expect(rpcMock.mock.calls.find((c) => c[0] === "resolve_stalled_job_flag")?.[1]).toEqual({
      p_job_id: JOB_ID,
    });
  });

  it("does not call success when the RPC returns false — that means someone else cleared it", async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "admin_stalled_job_queue"
        ? { data: [queueRow()], error: null }
        : { data: false, error: null },
    );
    renderQueue();

    (await screen.findByRole("button", { name: "Mark Reviewed" })).click();
    await waitFor(() => expect(toastMock.base).toHaveBeenCalled());
    expect(String(toastMock.base.mock.calls[0][0])).toMatch(/Already cleared/i);
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe("AdminStalledJobs — the states that are not a list of rows", () => {
  it("says the queue is not deployed yet on PGRST202 instead of claiming nothing is stuck", async () => {
    rpcMock.mockImplementation(async () => ({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.admin_stalled_job_queue" },
    }));
    renderQueue();

    expect(await screen.findByText("This queue isn't live yet")).toBeInTheDocument();
    expect(screen.queryByText("No jobs are stuck")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("shows a designed empty state when the queue is genuinely clear", async () => {
    rpcMock.mockImplementation(async () => ({ data: [], error: null }));
    renderQueue();

    expect(await screen.findByText("No jobs are stuck")).toBeInTheDocument();
  });

  it("shows an error state — not an empty queue — when the read really fails", async () => {
    rpcMock.mockImplementation(async () => ({
      data: null,
      error: { code: "42501", message: "permission denied for function admin_stalled_job_queue" },
    }));
    renderQueue();

    expect(await screen.findByText(/couldn't load the stuck-job queue/i)).toBeInTheDocument();
    expect(screen.queryByText("No jobs are stuck")).not.toBeInTheDocument();
  });
});
