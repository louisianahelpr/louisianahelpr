/**
 * POST-H3 (posting audit 10-30 #3, owner: "Helpr-listed: build fully"): a Declutter Help job ("Have a Helpr list
 * it for me") ended at "Job done" with nothing linking it to the listings it was for. Now its finished card offers
 * "Your listings" (Declutter, Selling: what sold, and Lower price, Give it away free and haul-away for the rest).
 * Any other finished job does not.
 *
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |         isSellForMeJob(job.category) ? ( |         false ? (
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |             onClick={() => navigate(SELL_FOR_ME_LISTINGS_PATH)} |             onClick={() => navigate("/declutter")}
 * @mutate src/lib/declutter/sellForMe.ts |   return category === SELL_FOR_ME_JOB_CATEGORY; |   return category === "cleaning";
 * Photo hand-off: the job tells the Helpr to send phone photos in the job chat (chat takes photos).
 * @mutate src/lib/declutter/sellForMe.ts |   SELL_FOR_ME_PHOTO_LINE,\n |
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { buildSellForMePrefill, isSellForMeJob, SELL_FOR_ME_LISTINGS_PATH, SELL_FOR_ME_PHOTO_LINE } from "@/lib/declutter/sellForMe";
import { openMore } from "./helpers/openMore";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofDialog: () => null }));

const DONE_JOB = {
  title: "Mow the lawn",
  helper_id: "helper-1",
  budget: 100,
  status: "completed",
  payment_status: "released",
  is_group_job: false,
  helpers_needed: 1,
  urgent_fee: null,
  helper_fee_flat_cents: null,
  helper_fee_percent: null,
  platform_fee_amount: null,
  disputed_at: null,
  dispute_status: null,
  payout_scheduled_at: null,
  proof_before_urls: [],
  proof_after_urls: [],
};

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "is", "not", "gte", "lte"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: DONE_JOB, error: null }));
  chain.single = vi.fn(() => Promise.resolve({ data: DONE_JOB, error: null }));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      from: chain.from,
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
      auth: {
        getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
      removeChannel: vi.fn(),
      functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) },
    },
  };
});

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

async function finished(category: string) {
  const { CompletedStep } = await import("@/pages/posts/postedJobCard/steps/CompletedStep");
  const navigate = vi.fn();
  const job = {
    id: "job-1", title: "Help me list my things to sell", category, customer_id: "poster-1", helper_id: "helper-1",
    budget: 80, status: "completed", payment_status: "released", is_group_job: false,
    proof_before_urls: [], proof_after_urls: [], poster_completed_at: new Date().toISOString(),
  };
  const ctx = {
    job, userId: "poster-1", helperNames: { "helper-1": "Hallie H." }, completedJobMeta: { "job-1": { tipped: true, reviewed: true } },
    navigate, onTip: vi.fn(), onReview: vi.fn(),
  } as unknown as Parameters<typeof CompletedStep>[0];
  const { container } = wrap(<CompletedStep {...ctx} />);
  await openMore(container);
  return navigate;
}

describe("POST-H3: a finished list-it-for-me job leads to the poster's listings", () => {
  it("the job Sell it for me posts is the one that counts", () => {
    expect(isSellForMeJob(buildSellForMePrefill().category)).toBe(true);
    for (const c of ["cleaning", "moving", null, undefined, ""]) expect(isSellForMeJob(c), String(c)).toBe(false);
    expect(SELL_FOR_ME_LISTINGS_PATH).toBe("/declutter?tab=selling");
  });

  it("the job tells the Helpr how the photos reach the seller: the job chat", () => {
    const d = buildSellForMePrefill().description;
    expect(d).toContain(SELL_FOR_ME_PHOTO_LINE);
    expect(SELL_FOR_ME_PHOTO_LINE).toMatch(/job chat/);
    expect(d.length).toBeLessThan(1000);
  });

  it("its finished card offers Your listings, which opens Declutter's Selling tab", async () => {
    const navigate = await finished("declutter_help");
    fireEvent.click(screen.getByRole("button", { name: /^Your listings — / }));
    expect(navigate).toHaveBeenCalledWith("/declutter?tab=selling");
  });

  it("any other finished job has no Your listings", async () => {
    await finished("yard_work");
    expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: /^Your listings/ })).toBeNull();
  });
});
