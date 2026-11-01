/**
 * JOBS-3 follow-up (lead 10-31, screenshot ~/.lh-shots/l18/shots/jobpage-cancel-375.png): when every crew member was
 * reported a no-show, "Cancel and get a refund" (Posted card) and the job page's "Cancel job" open the generic
 * CancellationDialog. It marked "Before a Helpr is selected: YOU ARE HERE" and said "Most of your payment comes
 * back", contradicting "you get all your money back". For that crew (crewNobodyLeft) the dialog now says all of the
 * money comes back, shows no policy step, and "Back to you" is still only the server's cancel_quote number.
 * Both entry points open the dialog through tryCancelJob, whose own roster read (empty, job under way) marks the job
 * crewNobodyLeft; ActivityDialogs passes it on. A roster map is not used: it reads {} before it has loaded.
 *
 * @mutate src/components/CancellationDialog.tsx |           {nobodyLeft && ( |           {false && (
 * @mutate src/components/CancellationDialog.tsx |           {!nobodyLeft && (<> |           {true && (<>
 * @mutate src/components/job-card/ActivityDialogs.tsx |           nobodyLeft={(props.cancelDialogJob as { crewNobodyLeft?: boolean }).crewNobodyLeft === true} |           nobodyLeft={false}
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |         setCancelDialogJob({ ...job, crewNobodyLeft: job.status === "in_progress" } as Job); |         setCancelDialogJob(job);
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn(), hapticLight: vi.fn(), hapticMedium: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })) })) })),
    })),
    rpc: vi.fn(),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

import { CancellationDialog } from "@/components/CancellationDialog";

const props = {
  jobId: "job-crew", jobTitle: "Move a sectional and a piano", jobDate: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10),
  jobStartTime: null, jobBudget: 120, hasHelper: false, wasFunded: true,
  crew: { needed: 3, members: [] as Array<{ share_cents: number | null; confirmed: boolean }> },
  open: true, onClose: vi.fn(), onCancelled: vi.fn(),
};

describe("cancel dialog for a crew where nobody came", () => {
  beforeEach(() => {
    invoke.mockReset();
    // 12,651 is not anything the screen could derive from the $120 budget.
    invoke.mockResolvedValue({ data: { can_cancel: true, fee_cents: 0, fee_percent: 0, back_to_you_cents: 12651, unquoted_reason: null, charge_state: "captured" }, error: null });
  });

  it("says all of the money comes back, shows no step, and Back to you is the server's number", async () => {
    render(<CancellationDialog {...props} nobodyLeft />);
    expect(screen.getByTestId("cancel-nobody-left")).toHaveTextContent("Cancel now and all of your money comes back to your card.");
    expect(document.body.textContent).not.toMatch(/YOU ARE HERE/);
    expect(document.body.textContent).not.toMatch(/Most of your payment/);
    expect(document.body.textContent).not.toMatch(/Before a Helpr is selected/);
    await waitFor(() => expect(screen.getByTestId("cancel-back-to-you")).toHaveTextContent("$126.51"));
    expect(screen.getByRole("button", { name: /^cancel job$/i })).toBeInTheDocument();
  });

  it("control: any other cancel still shows the two-step policy", async () => {
    render(<CancellationDialog {...props} />);
    expect(screen.queryByTestId("cancel-nobody-left")).toBeNull();
    expect(document.body.textContent).toMatch(/YOU ARE HERE/);
    await waitFor(() => expect(screen.getByTestId("cancel-back-to-you")).toHaveTextContent("$126.51"));
  });

  it("tryCancelJob marks the job from its own roster read; ActivityDialogs passes it on", () => {
    const h = blankComments(readFileSync("src/components/job-card/activityActions/useLifecycleHandlers.ts", "utf8"));
    expect(h).toContain('setCancelDialogJob({ ...job, crewNobodyLeft: job.status === "in_progress" } as Job);');
    const f = blankComments(readFileSync("src/components/job-card/ActivityDialogs.tsx", "utf8"));
    expect(f).toContain("nobodyLeft={(props.cancelDialogJob as { crewNobodyLeft?: boolean }).crewNobodyLeft === true}");
  });
});
