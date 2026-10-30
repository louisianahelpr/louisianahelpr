/**
 * UX-7 (owner-approved 2026-10-29): the after-completion prompt (CompletionPrompts) now opens for the Helpr
 * too, right after the Mark done that finished the job. Its middle step asks "Add a tip for <name>?", which
 * is a poster's question: a Helpr never tips the poster, and a poster who already tipped is not asked twice.
 * Both go review → share. A poster who has not tipped still sees the tip step (control).
 *
 * @mutate src/components/CompletionPrompts.tsx |   const offerTip = !isHelper && !alreadyTipped; |   const offerTip = true;
 */
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const HELPR = "00000000-0000-4000-8000-0000000000aa";
const POSTER = "00000000-0000-4000-8000-0000000000bb";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: { title: "Kitchen clean", budget: 40, is_group_job: false, helpers_needed: 1, helper_id: HELPR }, error: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return {
    supabase: {
      from: () => chain,
      rpc: async (_name: string, args: { user_ids?: string[] }) => ({
        data: (args?.user_ids ?? []).map((id) => ({ user_id: id, is_payout_ready: true })),
        error: null,
      }),
      functions: { invoke: vi.fn() },
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/hooks/useReferralData", () => ({ fetchReferralData: async () => ({ referralCode: "ABC123" }) }));
vi.mock("@/components/jobDone/JobDoneSummary", () => ({ JobDoneSummary: () => null }));
vi.mock("@/components/feedback/NpsPrompt", () => ({ NpsPrompt: () => null }));

import { CompletionPrompts } from "@/components/CompletionPrompts";

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Dismiss the review step the way a person does (Escape closes the dialog → the next step). */
async function skipReview() {
  await screen.findByRole("dialog");
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

describe("the completion prompt's tip step is the poster's only (UX-7)", () => {
  it("the Helpr reviewing the poster goes review → share, never the tip", async () => {
    wrap(<CompletionPrompts jobId="job-1" jobTitle="Kitchen clean" revieweeId={POSTER} revieweeName="Pat Poster" userId={HELPR} onDone={vi.fn()} isHelper />);
    expect(await screen.findByText(/How was working for Pat\?/)).toBeTruthy();
    await skipReview();
    expect(await screen.findByText("Loved it? Share Helpr")).toBeTruthy();
    expect(screen.queryByText(/Add a tip for/)).toBeNull();
  });

  it("a poster who already tipped goes review → share", async () => {
    wrap(<CompletionPrompts jobId="job-1" jobTitle="Kitchen clean" revieweeId={HELPR} revieweeName="Hallie Helpr" userId={POSTER} onDone={vi.fn()} alreadyTipped />);
    expect(await screen.findByText(/How did Hallie do\?/)).toBeTruthy();
    await skipReview();
    expect(await screen.findByText("Loved it? Share Helpr")).toBeTruthy();
    expect(screen.queryByText(/Add a tip for/)).toBeNull();
  });

  it("control: a poster who has not tipped is offered the tip after the review", async () => {
    wrap(<CompletionPrompts jobId="job-1" jobTitle="Kitchen clean" revieweeId={HELPR} revieweeName="Hallie Helpr" userId={POSTER} onDone={vi.fn()} />);
    expect(await screen.findByText(/How did Hallie do\?/)).toBeTruthy();
    await skipReview();
    expect(await screen.findByText("Add a tip for Hallie?")).toBeTruthy();
  });
});
