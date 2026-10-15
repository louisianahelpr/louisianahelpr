/**
 * Post a Job, "Set my price" or "Get quotes" (owner Q1, Q4). The three form
 * sections are stubbed (their own tests cover them); this pins the choice:
 * shown only with the 'quotes' switch on and only for a one-time job with no
 * direct offer, "Get quotes" swaps the budget for the 24 h / 48 h / 3 days
 * window (48 h default), and "Ask for Quotes" sends the form's details to
 * create_quote_request, never the Review & Pay path.
 *
 * @mutate src/pages/post-job/FormStep.tsx |   const quotesEligible = quotesOn && !form.offerToHelperId && !form.isRecurring && !form.isGroupJob; |   const quotesEligible = quotesOn && !form.offerToHelperId;
 * @mutate src/pages/post-job/FormStep.tsx |           if (!askingQuotes) return form.handleReview(e); |           return form.handleReview(e);
 * @mutate src/lib/quotes/api.ts | export const DEFAULT_QUOTE_WINDOW: QuoteWindowHours = 48; | export const DEFAULT_QUOTE_WINDOW: QuoteWindowHours = 24;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { feature: true, calls: [] as { fn: string; args: unknown }[] };

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.feature }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/components/postjob/DetailsSection", () => ({ DetailsSection: () => <div>details</div> }));
vi.mock("@/components/postjob/LogisticsSection", () => ({ LogisticsSection: () => <div>logistics</div> }));
vi.mock("@/pages/post-job/DirectOfferBanner", () => ({ DirectOfferBanner: () => <div>direct offer</div> }));
vi.mock("@/components/postjob/BudgetSection", () => ({ BudgetSection: () => <div>Budget section</div> }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => null, composeJobAddress: () => "x" }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      state.calls.push({ fn, args });
      return { data: "req-1", error: null };
    },
  },
}));

import { FormStep } from "@/pages/post-job/FormStep";

const handleReview = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());

function form(over: Record<string, unknown> = {}) {
  return {
    openJobCount: 0, detailsComplete: true, logisticsComplete: true, budgetComplete: false,
    offerToHelperId: null, isRecurring: false, isGroupJob: false, handleReview,
    title: "Paint the back fence", description: "About 60 feet of wood fence, two coats.", category: "painting",
    streetAddress: "100 Main St", city: "Baton Rouge", addrState: "LA", zipCode: "70801",
    dateNeeded: "2026-10-25", startTime: "09:00", isFlexibleSchedule: false, estimatedHours: "4",
    parish: "East Baton Rouge", budgetNum: 0, scheduleInPast: false, streetAddressOk: true,
    ...over,
  } as never;
}

function show(f: never) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FormStep form={f} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.feature = true;
  state.calls = [];
  handleReview.mockClear();
});

describe("Post a Job: Set my price or Get quotes", () => {
  it("switch off: no choice, the budget and Review & Pay as today", () => {
    state.feature = false;
    show(form());
    expect(screen.queryByRole("radio", { name: "Get quotes" })).toBeNull();
    expect(screen.getByText("Budget section")).toBeInTheDocument();
  });

  it("a series, a crew job or a direct offer keeps today's flow", () => {
    for (const over of [{ isRecurring: true }, { isGroupJob: true }, { offerToHelperId: "h1" }]) {
      const { unmount } = show(form(over));
      expect(screen.queryByRole("radio", { name: "Get quotes" })).toBeNull();
      unmount();
    }
  });

  it("Get quotes swaps the budget for the window (48 h default) and asks for quotes, never Review & Pay", async () => {
    show(form());
    fireEvent.click(screen.getByRole("radio", { name: "Get quotes" }));
    expect(screen.queryByText("Budget section")).toBeNull();
    expect(screen.getByRole("radio", { name: "48 hours" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "3 days" }));
    fireEvent.click(screen.getByRole("button", { name: /Ask for Quotes/ }));
    await waitFor(() => expect(state.calls.some((c) => c.fn === "create_quote_request")).toBe(true));
    expect(handleReview).not.toHaveBeenCalled();
    expect(state.calls.find((c) => c.fn === "create_quote_request")?.args).toMatchObject({
      p_title: "Paint the back fence",
      p_category: "painting",
      p_date_needed: "2026-10-25",
      p_start_time: "09:00",
      p_estimated_hours: 4,
      p_location: "100 Main St, Baton Rouge, LA 70801",
      p_parish: "East Baton Rouge",
      p_window_hours: 72,
    });
  });
});
