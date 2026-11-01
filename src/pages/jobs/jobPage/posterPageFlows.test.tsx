/**
 * LEAD-JOBPAGE-LAYOUT, the money half (owner 2026-10-31): the job page's "Approve and release", "Cancel job",
 * "Edit job" and "More options" run the Posted card's OWN flows on the page (usePosterPageFlows), never a trip to
 * /posts. This proves the wiring through the real pieces: the card's PostedJobActions (its InProgressStep opens
 * the approve sheet), createLifecycleHandlers (completeJob is create-payment's `release`; tryCancelJob checks the
 * tracking row, then opens the cancel dialog) and ActivityDialogs. The sheet and the dialog are stubs that print
 * what they were handed; their own behaviour is their own tests. JobPage.test.tsx proves the page's buttons call these.
 *
 * Replaces src/test/jobPageApproveOpensSheet.test.tsx (the card half of the old one-shot trip, now gone).
 *
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx |     approve: () => setCompletionRequest((n) => n + 1), |     approve: () => {},
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx |         onComplete={(id) => void handlers.completeJob(id)} |         onComplete={() => {}}
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx |     cancel: () => void handlers.tryCancelJob(job), |     cancel: () => setCancelDialogJob(job),
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx | JOB_READABLE_COLUMNS}, materials_note, onboarding_fee_amount, poster_marked_done_at` | JOB_READABLE_COLUMNS}`
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx | .eq("id", jobId).eq("customer_id", userId).limit(1)); | .eq("id", jobId).limit(1));
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx |     <div data-poster-more="" hidden> |     <div data-poster-more="">
 * @mutate src/components/job-card/JobStepCard.tsx | ...moreChips.filter((c) => !(isValidElement(c) && c.key === "message"))] | ...moreChips]
 * @mutate src/components/job-card/JobStepCard.tsx | menu?.secondHost && menuCount === 1 ? | menu?.secondHost && menuCount === 2 ?
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx |     crewRoster: job.is_group_job && detail ? detail.groupHelpersByJob?.[job.id] ?? [] : undefined, |     crewRoster: undefined,
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls = vi.hoisted(() => ({ from: [] as Array<{ table: string; select?: string; eq: Array<[string, unknown]> }>, invoke: [] as unknown[][] }));
const JOB = vi.hoisted(() => ({
  id: "job-1", title: "Fence", budget: 100, status: "in_progress", payment_status: "escrow",
  customer_id: "poster-1", helper_id: "helper-1", is_group_job: false, date_needed: "2033-01-10", start_time: "09:00",
  helper_confirmed_at: "2026-10-27T12:00:00Z", poster_confirmed_arrival_at: "2026-10-28T12:30:00Z",
  helper_arrived_at: "2026-10-28T12:30:00Z", helper_completed_at: "2026-10-28T15:00:00Z", poster_completed_at: null,
  proof_before_urls: [], proof_after_urls: [], onboarding_fee_amount: 2, urgent_fee: null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const rec: { table: string; select?: string; eq: Array<[string, unknown]> } = { table, eq: [] };
    calls.from.push(rec);
    const b: Record<string, unknown> = {};
    for (const m of ["not", "in", "order", "limit", "is", "or", "neq", "gte", "lte", "maybeSingle", "single"]) b[m] = () => b;
    b.select = (s: string) => { rec.select = s; return b; };
    b.eq = (c: string, v: unknown) => { rec.eq.push([c, v]); return b; };
    b.then = (res: (v: unknown) => void) => res({ data: table === "jobs" ? [JOB] : [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => build(t),
      auth: { getUser: async () => ({ data: { user: { id: "poster-1" } } }) },
      rpc: async (name: string) => ({ data: name === "get_safe_profiles" ? [{ user_id: "helper-1", full_name: "Hallie Hebert", avatar_url: null }] : null, error: null }),
      functions: { invoke: async (...a: unknown[]) => { calls.invoke.push(a); return { data: { bothDone: false }, error: null }; } },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "poster-1" }, profile: null }) }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null, PhotoProofDialog: () => null, PhotoProofRequirementNote: () => null }));
// The card's approve sheet: open or not, and its confirm (the release) when pressed. Portaled to the body like the
// real Radix sheet, so it shows while More options (its host) is closed.
vi.mock("@/pages/posts/CompletionChoiceSheet", async () => {
  const { createPortal } = await import("react-dom");
  return {
    CompletionChoiceSheet: ({ open, helperName, onConfirm }: { open: boolean; helperName: string; onConfirm: () => void }) =>
      open ? createPortal(<div role="dialog" aria-label="approve sheet"><button onClick={onConfirm}>{`Release to ${helperName}`}</button></div>, document.body) : null,
  };
});
// The card's cancel dialog: what the Posted list's mount hands it (the fee kept needs the Posted row's column).
vi.mock("@/components/CancellationDialog", () => ({
  CancellationDialog: ({ jobId, setupFeeKept, hasHelper }: { jobId: string; setupFeeKept: number | null; hasHelper: boolean }) =>
    <div role="dialog" aria-label="cancel dialog">{`${jobId} fee=${setupFeeKept} helper=${hasHelper}`}</div>,
}));

import { usePosterPageFlows } from "./usePosterPageFlows";

// Whether the page's options sheet (its list host) is open in this harness.
const listOpen = { value: false };

function Harness() {
  const f = usePosterPageFlows({ jobId: "job-1", enabled: true, trackingStatus: null, onChanged: () => {} });
  return (
    <>
      <p data-testid="ready">{String(f.ready)}</p>
      <p data-testid="nobody">{String(f.crewNobodyLeft)}</p>
      <p data-testid="roster">{f.crewRoster === undefined ? "none" : `rows=${f.crewRoster.length}`}</p>
      <button onClick={f.approve}>approve</button>
      <button onClick={f.cancel}>cancel</button>
      <p data-testid="count">{f.moreCount}</p>
      <div data-testid="second" ref={f.setSecondHost} />
      {listOpen.value && <div data-testid="list" ref={f.setListHost} />}
      {f.panel}
      {f.dialogs}
    </>
  );
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Harness /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  cleanup();
  calls.from.length = 0;
  calls.invoke.length = 0;
  listOpen.value = false;
});

describe("the job page runs the Posted card's own flows (usePosterPageFlows)", () => {
  it("reads the Posted list's row for this job, the poster's own (the cancel quote's onboarding_fee_amount rides it)", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    const read = calls.from.find((c) => c.table === "jobs");
    expect(read?.select).toMatch(/onboarding_fee_amount/);
    expect(read?.eq).toEqual([["id", "job-1"], ["customer_id", "poster-1"]]);
  });

  it("Approve opens the card's own approve sheet; its confirm is create-payment's release, once", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(screen.queryByRole("dialog", { name: "approve sheet" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "approve" }));
    const sheet = await screen.findByRole("dialog", { name: "approve sheet" });
    expect(calls.invoke).toEqual([]);
    fireEvent.click(sheet.querySelector("button")!);
    await waitFor(() => expect(calls.invoke).toEqual([["create-payment", { body: { action: "release", jobId: "job-1" } }]]));
    expect(sheet.textContent).toContain("Hallie");
  });

  it("Cancel checks the tracking row, then opens the card's cancel dialog with the Posted row (fee kept, Helpr committed)", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    const dialog = await screen.findByRole("dialog", { name: "cancel dialog" });
    expect(dialog.textContent).toBe("job-1 fee=2 helper=true");
    expect(calls.from.some((c) => c.table === "job_tracking" && c.eq.some(([k, v]) => k === "job_id" && v === "job-1"))).toBe(true);
  });

  // JOBS-3 / JA-32 (audit 11-01): an under-way crew. Its roster is the PAGE's (JobPage "Your crew", from crewRoster),
  // never hidden in More options; with no roster row left (every member reported) nobody is left, so Cancel job shows.
  it("an under-way crew: the roster is handed to the page, not hidden in More options; an empty roster means nobody is left", async () => {
    const saved = { is_group_job: JOB.is_group_job, helper_id: JOB.helper_id, helper_completed_at: JOB.helper_completed_at };
    Object.assign(JOB, { is_group_job: true, helper_id: null, helper_completed_at: null, helpers_needed: 2 });
    try {
      const { container } = mount();
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
      await waitFor(() => expect(screen.getByTestId("roster").textContent).toBe("rows=0"));
      expect(container.querySelector("[data-poster-more]")!.textContent).not.toContain("Your crew");
      expect(screen.getByTestId("nobody").textContent).toBe("true");
    } finally {
      Object.assign(JOB, saved);
      delete (JOB as { helpers_needed?: number }).helpers_needed;
    }
  });

  it("a one-Helpr job has no crew roster and is never 'nobody left'", async () => {
    const { container } = mount();
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(screen.getByTestId("roster").textContent).toBe("none");
    expect(container.textContent).not.toContain("Your crew");
    expect(screen.getByTestId("nobody").textContent).toBe("false");
  });

  // Owner 2026-11-01: one tap to the options. The card stays mounted out of sight; its actions (minus Message, which
  // the page has) reach the page: one is the page's second button, two or more are the options sheet's list.
  it("the card is mounted but never shown; a lone action (No-Show while the Helpr is on the way) is the page's second button", async () => {
    const saved = { ...JOB };
    Object.assign(JOB, { date_needed: "2026-01-10", helper_on_the_way_at: "2026-01-10T14:00:00Z", helper_arrived_at: null,
      poster_confirmed_arrival_at: null, helper_completed_at: null });
    try {
      const { container } = mount();
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
      expect((container.querySelector("[data-poster-more]") as HTMLElement).hidden).toBe(true);
      await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
      const second = screen.getByTestId("second");
      const noShow = second.querySelector("button") as HTMLButtonElement;
      expect(noShow.textContent).toBe("No-Show");
      expect(second.textContent).not.toMatch(/Message/);
    } finally {
      Object.assign(JOB, saved);
      delete (JOB as { helper_on_the_way_at?: string }).helper_on_the_way_at;
    }
  });
});
