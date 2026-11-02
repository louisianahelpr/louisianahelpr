/**
 * Q2642 (account audit 1102d row 1): "SEED Deep clean a kitchen" read $120 in
 * Search and $113 on the Jobs browse card for the same signed-in viewer. Search
 * printed the raw budget; the card prints the viewer's take-home (JobPrice chip).
 * The job below is that job's prod row (read-only SELECT 2026-11-02: budget
 * 120.00, flat stamp 70c + 5%, one Helpr, no urgent bonus).
 *
 * Search now prices a job hit with the browse card's own rule, through the
 * shared computeNet: take-home for anyone else, the set budget on one's own job.
 *
 * @mutate src/pages/search/SearchPage.tsx |                 price={searchJobPrice(j, user?.id ?? null, viewerFee, firstPayoutFee)} |                 price={typeof j.budget === "number" && j.budget > 0 ? `$${j.budget}` : null}
 * @mutate src/pages/search/searchJobPrice.ts |   if (viewerId && job.customer_id === viewerId) return `$${formatPrice(job.budget)}`; |   if (false) return `$${formatPrice(job.budget)}`;
 * @mutate src/pages/search/searchJobPrice.ts | helpers, firstPayoutFeeDollars, job); | helpers, 0, job);
 * @mutate src/pages/search/searchJobPrice.ts |   const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1; |   const helpers = 1;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ owedCents: 0, viewer: "helpr-1", jobs: [] as Record<string, unknown>[] }));

vi.mock("@/hooks/useFeature", () => ({ useFeatureStatus: () => ({ on: false, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: state.viewer }, profile: { subscription_tier: "free", subscription_expires_at: null } }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => state.owedCents, useFirstPayoutFeeDollars: () => state.owedCents / 100 }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => undefined }));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: async () => new Set<string>() }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/savedSearches/SaveSearchButton", () => ({ SaveSearchButton: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const rows = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "ilike", "not", "in", "or", "order", "limit", "eq"]) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: state.jobs, error: null, count: state.jobs.length }).then(res);
    return b;
  };
  return { supabase: { from: () => rows(), rpc: async () => ({ data: [], error: null }) } };
});

import SearchPage from "./SearchPage";
import { JobPrice } from "@/components/dashboard/JobPrice";
import { tierFeePercent } from "@/lib/subscriptionTiers";

const KITCHEN = {
  id: "13025164-e829-4020-ba35-9d095027dccb", title: "SEED Deep clean a kitchen", category: "cleaning",
  budget: 120, pricing_mode: "set_price", parish: null, date_needed: null,
  urgent_fee: 0, is_group_job: false, helpers_needed: 1, customer_id: "poster-1",
  helper_fee_flat_cents: 70, helper_fee_percent: 5,
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/search?q=clean"]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The Jobs browse card's chip for the same job and viewer. */
function browseChip(job: typeof KITCHEN, showBudget = false) {
  const { container, unmount } = render(
    <JobPrice budget={job.budget} effectiveFee={tierFeePercent("free", null)} urgentFee={job.urgent_fee} helpersNeeded={job.is_group_job ? job.helpers_needed : 1} feeStamp={job} showBudget={showBudget} variant="chip" />,
  );
  const figure = (container.querySelector(".money-chip")?.firstChild?.textContent ?? "").trim();
  unmount();
  return figure;
}

async function searchPrice() {
  const link = await screen.findByRole("link", { name: /SEED Deep clean a kitchen/ });
  return (within(link).getByText(/^\$|^Quote$/).textContent ?? "").trim();
}

beforeEach(() => {
  state.owedCents = 0;
  state.viewer = "helpr-1";
  state.jobs = [KITCHEN];
});

describe("Search prices a job like the Jobs browse card (Q2642)", () => {
  it("the audit's job: $113 in Search, the same figure as the browse chip", async () => {
    mount();
    const price = await searchPrice();
    expect(price).toBe("$113");
    expect(price).toBe(browseChip(KITCHEN));
  });

  it("the one-time setup fee still owed comes off, as on the card", async () => {
    state.owedCents = 200;
    mount();
    const price = await searchPrice();
    expect(price).toBe("$111");
    expect(price).toBe(browseChip(KITCHEN));
  });

  it("a crew job shows one Helpr's share", async () => {
    const crew = { ...KITCHEN, is_group_job: true, helpers_needed: 2 };
    state.jobs = [crew];
    mount();
    const price = await searchPrice();
    expect(price).toBe(browseChip(crew));
    expect(price).toBe("$56");
  });

  it("the poster's own job shows the budget they set", async () => {
    state.viewer = "poster-1";
    mount();
    expect(await searchPrice()).toBe("$120");
  });

  it("a quote job says Quote", async () => {
    state.jobs = [{ ...KITCHEN, pricing_mode: "quote" }];
    mount();
    expect(await searchPrice()).toBe("Quote");
  });
});
