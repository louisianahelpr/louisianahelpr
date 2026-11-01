/**
 * The job page reads what the Working card reads (audit 2026-10-28 F1/F26): the photo rule and the photos taken
 * on the party read, and the job's latest tracking status. Without them the hired Helpr's line and button guessed
 * ("Take the before photo" after both photos). The supabase mock trims each row to the columns selected, the way
 * PostgREST does, so a column the read forgets is missing here exactly as on prod.
 *
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | revision_deadline, require_photo_proof, proof_before_urls, proof_after_urls, payout_scheduled_at, parent_job_id | revision_deadline, parent_job_id
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |     enabled: !!job.data?.party && !!job.data.job.helper_id, |     enabled: false,
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const JOB = "33333333-3333-3333-3333-333333333333";
const db: Record<string, Record<string, unknown>[]> = {
  jobs: [{
    id: JOB, title: "t", description: null, category: "cleaning", budget: 40, date_needed: null, start_time: null, is_flexible_schedule: false,
    location: "1 Main St", customer_id: "poster", status: "in_progress", payment_status: "escrow", urgent_fee: null, helpers_needed: 1,
    is_group_job: false, photos: [], helper_fee_flat_cents: 70, helper_fee_percent: 5, helper_id: "me", poster_fee_flat_cents: null,
    helper_arrived_at: "2026-10-28T12:00:00Z", require_photo_proof: true, proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"],
    payout_scheduled_at: "2026-11-01T04:13:00Z",
  }],
  job_tracking: [{ job_id: JOB, status: "working", created_at: "2026-10-28T12:10:00Z" }],
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let cols: string[] | null = null;
    const eqs: [string, unknown][] = [];
    const run = () => (db[table] ?? [])
      .filter((r) => eqs.every(([k, v]) => r[k] === v))
      .map((r) => (cols ? Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])) : r));
    const b: Record<string, unknown> = {
      select: (c: string) => { cols = c.split(",").map((s) => s.trim()); return b; },
      eq: (k: string, v: unknown) => { eqs.push([k, v]); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    };
    return b;
  };
  return { supabase: { from, rpc: () => Promise.resolve({ data: [], error: null }) } };
});

import { useJobPage } from "./useJobPage";

describe("the job page's party read carries the Working card's inputs", () => {
  it("selects the photo columns and reads the latest tracking status", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useJobPage(JOB, "me"), { wrapper });
    await waitFor(() => expect(result.current.job.data?.party).toBe(true));
    const job = result.current.job.data!.job;
    expect(job.require_photo_proof).toBe(true);
    expect(job.proof_before_urls).toEqual(["b.jpg"]);
    expect(job.proof_after_urls).toEqual(["a.jpg"]);
    // F32: when the released pay goes out, for the poster's money card.
    expect(job.payout_scheduled_at).toBe("2026-11-01T04:13:00Z");
    await waitFor(() => expect(result.current.tracking.data).toBe("working"));
  });
});
