/**
 * Post a job, "Set a price" or "Get quotes" (owner Q1, Q4; owner 2026-10-19:
 * pills with one line on what happens next). Since board 3 (builder2-jobs
 * 2026-10-20) the choice heads screen 3 of 5, "What will you pay?"; the quote
 * ask goes out from screen 4. The three form
 * sections are stubbed (their own tests cover them); this pins the choice:
 * shown only with the 'quotes' switch on and only for a one-time job with no
 * direct offer, "Get quotes" swaps the budget for the 24 h / 48 h / 3 days
 * window (48 h default), and "Ask for quotes" sends the form's details to
 * create_quote_request, never the Review & pay path.
 *
 * @mutate src/pages/post-job/FormStep.tsx |   const quotesShape = !form.offerToHelperId && !form.isRecurring && !form.isGroupJob; |   const quotesShape = !form.offerToHelperId;
 *
 * Owner 2026-10-19: without the switch (everyone but testers) the choice still shows, with
 * "Get quotes" greyed and marked Coming soon; a tap only says so, never the quote form or its RPC.
 * @mutate src/pages/post-job/FormStep.tsx |   const quotesEligible = quotesOn && quotesShape; |   const quotesEligible = quotesShape;
 * @mutate src/components/quotes/PostJobQuoteChoice.tsx |           if (v === "quotes" && quotesComingSoon) { |           if (false) {
 * @mutate src/components/quotes/PostJobQuoteChoice.tsx |             setSoonTapped(true); |             void 0;
 * @mutate src/components/quotes/PostJobQuoteChoice.tsx |           quotesComingSoon\n            ? { |           false\n            ? {
 * @mutate src/pages/post-job/FormStep.tsx | quotesComingSoon={!quotesOn} | quotesComingSoon={false}
 * @mutate src/pages/post-job/FormStep.tsx |           if (!askingQuotes) return form.handleReview(e); |           return form.handleReview(e);
 * @mutate src/components/quotes/PostJobQuoteChoice.tsx |           { value: "price", label: "Set a price" }, |           { value: "price", label: "Set my price" },
 * @mutate src/components/quotes/PostJobQuoteChoice.tsx |         {quotesComingSoon && soonTapped ? QUOTES_COMING_SOON : PRICE_MODE_NEXT[value]}\n |         \n
 * @mutate src/lib/quotes/api.ts | export const DEFAULT_QUOTE_WINDOW: QuoteWindowHours = 48; | export const DEFAULT_QUOTE_WINDOW: QuoteWindowHours = 24;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { feature: true, calls: [] as { fn: string; args: unknown }[] };

vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => state.feature,
  useFeatureStatus: () => ({ on: state.feature, settled: true, lastAnswer: state.feature }),
}));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/components/postjob/DetailsSection", () => ({ DetailsSection: () => <div>details</div> }));
vi.mock("@/components/postjob/LogisticsSection", () => ({ LogisticsSection: () => <div>logistics</div> }));
vi.mock("@/pages/post-job/DirectOfferBanner", () => ({ DirectOfferBanner: () => <div>direct offer</div> }));
vi.mock("@/components/postjob/BudgetSection", () => ({ BudgetSection: () => <div>Budget section</div> }));
vi.mock("@/components/postjob/JobCategoryGroups", () => ({ JobCategoryGroups: () => <div>category groups</div> }));
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

/** FormStep with a real page state, opened on screen 3 (the price screen). */
function Paged({ f }: { f: Record<string, unknown> }) {
  const [formPage, setFormPage] = useState(3);
  return <FormStep form={{ ...f, formPage, setFormPage } as never} />;
}

function show(f: never) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Paged f={f} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Screen 3 -> screen 4, where the job is sent (Review & pay or Ask for quotes). */
function toScreen4() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

beforeEach(() => {
  state.feature = true;
  state.calls = [];
  handleReview.mockClear();
});

describe("Post a job: Set a price or Get quotes", () => {
  it("heads the price screen (3 of 5), as pills, saying what happens next", () => {
    show(form());
    const group = screen.getByRole("radiogroup", { name: "How to price this job" });
    expect(group.closest("[data-form-page]")?.getAttribute("data-form-page")).toBe("3");
    expect(screen.getByRole("heading", { name: "What will you pay?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Set a price" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/You set the budget, then review and pay/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Get quotes" }));
    expect(screen.getByText(/Members near you send theirs; you pick one and pay only when you book/)).toBeInTheDocument();
  });

  it("switch off (not a tester): the choice shows with Get quotes greyed and Coming soon; a tap only says so", async () => {
    state.feature = false;
    show(form({ budgetComplete: true, budgetNum: 80 }));
    expect(screen.getByRole("radio", { name: "Set a price" })).toHaveAttribute("aria-checked", "true");
    const soon = screen.getByRole("radio", { name: "Get quotes, coming soon" });
    expect(soon).toHaveTextContent("Coming soon");
    expect(soon.querySelector("[data-quotes-coming-soon]")?.className).toMatch(/text-muted-foreground/);
    fireEvent.click(soon);
    // Said in the line under the pills (toast.info is silenced app-wide by src/lib/toastPolicy.ts).
    expect(screen.getByText("Getting quotes from local pros is coming soon. For now, set your price.")).toBeInTheDocument();
    // Still Set a price: the budget and Review & pay, never the quote window or its RPC.
    expect(screen.getByRole("radio", { name: "Set a price" })).toHaveAttribute("aria-checked", "true");
    expect(soon).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Budget section")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "48 hours" })).toBeNull();
    toScreen4();
    expect(screen.queryByRole("button", { name: /Ask for quotes/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Review & pay/ }));
    await waitFor(() => expect(handleReview).toHaveBeenCalled());
    expect(state.calls.filter((c) => /quote/i.test(c.fn))).toEqual([]);
  });

  it("switch turned off mid-form with Get quotes picked: back to Set a price and the budget, no quote window", () => {
    const { rerender } = show(form());
    fireEvent.click(screen.getByRole("radio", { name: "Get quotes" }));
    expect(screen.queryByText("Budget section")).toBeNull();
    state.feature = false;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Paged f={form()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Budget section")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "48 hours" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Get quotes, coming soon" })).toHaveAttribute("aria-checked", "false");
  });

  it("switch on (a tester): the real Get quotes, no Coming soon", () => {
    show(form());
    const real = screen.getByRole("radio", { name: "Get quotes" });
    expect(real).not.toHaveTextContent("Coming soon");
    fireEvent.click(real);
    expect(screen.queryByText(/coming soon\. For now, set your price/)).toBeNull();
    expect(screen.getByRole("radio", { name: "48 hours" })).toBeInTheDocument();
  });

  it("a series, a crew job or a direct offer keeps today's flow", () => {
    for (const over of [{ isRecurring: true }, { isGroupJob: true }, { offerToHelperId: "h1" }]) {
      const { unmount } = show(form(over));
      expect(screen.queryByRole("radio", { name: /Get quotes/ })).toBeNull();
      unmount();
    }
  });

  it("Get quotes swaps the budget for the window (48 h default) and asks for quotes, never Review & pay", async () => {
    show(form());
    fireEvent.click(screen.getByRole("radio", { name: "Get quotes" }));
    expect(screen.queryByText("Budget section")).toBeNull();
    expect(screen.getByRole("radio", { name: "48 hours" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "3 days" }));
    toScreen4();
    fireEvent.click(screen.getByRole("button", { name: /Ask for quotes/ }));
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
