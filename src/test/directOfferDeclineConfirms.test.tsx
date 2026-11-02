/**
 * Q2605 (Jobs audit 1102b row 19): one tap on "Decline" declined a direct job offer at once ("Declining…", no confirm,
 * no undo), right beside "Accept job". A direct offer now asks first, like an application offer: "Decline Lexi's
 * offer? The offer goes back to Lexi." Nothing is sent until the confirm's "Decline offer".
 *
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |           onClick={() => setConfirmOpen(true)} |           onClick={() => { if (!direct) return setConfirmOpen(true); setPressed("decline"); onHelperResponse(app, false); }}
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | `Decline ${posterFirst}’s offer?` | "Decline this job?"
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | `${endSentence(`The offer goes back to ${posterFirst ?? "the person who posted it"}`)} Declining isn't a strike.` | "You applied for this one and the person who posted it picked you. Declining isn't a strike."
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAcceptGate: () => ({ loading: false, reason: null, missing: [] }) }));
vi.mock("@/hooks/useAcceptPendingJobs", () => ({ useAcceptPendingJobs: () => new Set<string>() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn(), hapticSuccess: vi.fn() }));
import { OfferedActions } from "@/pages/jobs/appliedJobCard/OfferedActions";

afterEach(cleanup);

const job = {
  id: "job-1", title: "Rake the yard", category: "yard", budget: 120, customer_id: "poster-1", helper_id: null,
  date_needed: jobLocalDateISO(1), start_time: "09:00:00", status: "open", payment_status: "unpaid",
  direct_offer_status: "pending", direct_offer_expires_at: new Date(Date.now() + 20 * 3_600_000).toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as Job;
const app = { id: "direct-job-1", job_id: "job-1", helper_id: "helper-1", status: "pending", posterName: "Lexi L.", job } as unknown as AppliedApp;

describe("Q2605: declining a direct offer asks first", () => {
  it("the first tap opens the confirm and sends nothing; the confirm's Decline offer sends the decline", () => {
    const respond = vi.fn();
    render(<MemoryRouter><OfferedActions app={app} job={job} onHelperResponse={respond} respondingHelperAppId={null} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^Decline$/ }));
    expect(respond).not.toHaveBeenCalled();
    expect(screen.getByText("Decline Lexi’s offer?")).toBeTruthy();
    expect(screen.getByText(/The offer goes back to Lexi\. Declining isn't a strike\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decline offer" }));
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(app, false);
  });
});
