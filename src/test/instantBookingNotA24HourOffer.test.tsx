/**
 * Q2591 (Jobs audit 1102b row 5): with the instant_book switch off, an instant booking reaches the Helpr's generic offer
 * card (OfferedActions), which said "Respond within 24 hours · Accept or decline before the window closes" while the
 * booking's own decline window (instant_decline_until, 2 hours) ended in 95 minutes, and nothing said the Helpr was
 * already booked. The card now counts down instant_decline_until and says "You're booked. Can't make it? Decline by
 * <time>." A plain direct offer keeps the 24-hour line.
 *
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |   const instantUntil = job.instant_decline_until ?? null; |   const instantUntil = null as string \| null;
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | { id: "decline", at: instantUntil, text: "left to decline", expiredText: "You're booked" }, | { id: "decline", at: null, text: "left to decline", expiredText: "You're booked" },
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | note={`You're booked. Can't make it? Decline by ${declineUntilClock(instantUntil)}. No strike, and nothing is charged.`} | note="Accept or decline before the deadline."
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAcceptGate: () => ({ loading: false, reason: null, missing: [] }) }));
vi.mock("@/hooks/useAcceptPendingJobs", () => ({ useAcceptPendingJobs: () => new Set<string>() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import { OfferedActions } from "@/pages/jobs/appliedJobCard/OfferedActions";
import { declineUntilClock } from "@/lib/instantBook";

afterEach(cleanup);

const job = (extra: Record<string, unknown>) => ({
  id: "job-1", title: "Rake the yard", category: "yard", budget: 120, customer_id: "poster-1", helper_id: null,
  date_needed: jobLocalDateISO(1), start_time: "09:00:00", status: "open", payment_status: "unpaid",
  direct_offer_status: "pending", updated_at: new Date().toISOString(), ...extra,
}) as unknown as Job;

function renderOffer(j: Job) {
  const app = { id: `direct-${j.id}`, job_id: j.id, helper_id: "helper-1", status: "pending", job: j } as unknown as AppliedApp;
  return render(<MemoryRouter><OfferedActions app={app} job={j} onHelperResponse={() => {}} respondingHelperAppId={null} /></MemoryRouter>);
}

describe("Q2591: an instant booking is not a 24-hour offer", () => {
  it("counts down the booking's decline window and says the Helpr is booked", () => {
    const until = new Date(Date.now() + 95 * 60_000).toISOString();
    const { container } = renderOffer(job({ instant_decline_until: until }));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Respond within/);
    expect(text).not.toMatch(/before the window closes/);
    expect(text).toContain(`You're booked. Can't make it? Decline by ${declineUntilClock(until)}.`);
    const row = container.querySelector('[data-countdown-row="decline"]');
    expect(row?.textContent).toMatch(/^1h 3[45]m left to decline$/);
  });

  it("a plain direct offer with no stamped deadline keeps the 24-hour line", () => {
    const { container } = renderOffer(job({ instant_decline_until: null }));
    expect(container.textContent).toMatch(/Respond within 24 hours/);
    expect(container.querySelector('[data-countdown-row="decline"]')).toBeNull();
  });
});
