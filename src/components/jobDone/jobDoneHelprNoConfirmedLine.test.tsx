/**
 * F288 (whole-app audit 11-10, Helpr's Job done sheet): under "Approved · your pay goes out Fri, Nov 13" the sheet
 * said "The job with E2E is confirmed.", which a first-timer read as the job not having happened yet. The payout
 * progress row already starts at "Confirmed", so the sentence is gone.
 *
 * @mutate src/components/jobDone/JobDoneSummary.tsx |       <ol className="grid grid-cols-3 gap-2" aria-label="Payout progress"> |       <p>The job with {posterFirstName} is confirmed.</p><ol className="grid grid-cols-3 gap-2" aria-label="Payout progress">
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
const JOB = {
  title: "Mow a front lawn", helper_id: "h", budget: 25, status: "completed", payment_status: "payout_pending", is_group_job: false,
  helpers_needed: 1, urgent_fee: null, helper_fee_flat_cents: 70, helper_fee_percent: 5, platform_fee_amount: null, disputed_at: null,
  dispute_status: null, payout_scheduled_at: at, proof_before_urls: [], proof_after_urls: [],
};
vi.mock("@/integrations/supabase/client", () => {
  const chain = (rows: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) c[m] = () => c;
    c.maybeSingle = async () => ({ data: rows, error: null });
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return c;
  };
  return { supabase: { from: (t: string) => chain(t === "jobs" ? JOB : []), rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/lib/payoutSetupQueries", () => ({ fetchPayoutStatus: async () => ({ payouts_enabled: true, connected: true }), payoutStatusQueryOptions: {} }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: vi.fn(), gatedProps: () => ({}) }) }));

import { JobDoneSummary } from "./JobDoneSummary";

describe("F288: the Helpr's Job done sheet", () => {
  it("names the payout day and the progress, without 'The job with … is confirmed.'", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><JobDoneSummary jobId="j" side="helper" otherName="Erin E." viewerId="h" /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(/^Approved · your pay goes out /)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Payout progress" }).textContent).toContain("Confirmed");
    expect(document.body.textContent).not.toMatch(/is confirmed\./);
  });
});
