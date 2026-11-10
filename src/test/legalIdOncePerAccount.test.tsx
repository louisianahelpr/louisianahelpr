/**
 * L003 (landing audit 11-09, High): the Terms' short version said only "Every account verifies its email", and every
 * ID rule in the Terms read as OFF for a signed-out visitor (the member's own switch answer is false signed out) while
 * identity_check is on for everyone (prod, 11-09). The owner's rule (OWNER-DECISIONS.md "ID check + $2 setup fee",
 * 10-30): one photo ID check per account, ever, at the first job posted, hire or delivery, listing or purchase.
 *
 * The Terms now read the switch for THIS viewer (useIdCheckOnForViewer) and, while it is on, the short version adds the
 * rule in the same words as the Privacy short version (ID_ONCE_PER_ACCOUNT, src/pages/info/legal/privacyShortVersionId.test.tsx).
 * Wording only; no Terms version bump (no guard asks for one for the short version).
 *
 * @mutate src/pages/info/legal/TermsSection.tsx |   const idOn = useIdCheckOnForViewer(); |   const idOn = useIdentityCheckOnStore();
 * @mutate src/pages/info/legal/TermsSection.tsx | ${idOn ? ` You also verify ${ID_ONCE_PER_ACCOUNT}.` : ""} |
 * @mutate src/lib/useIdCheckOnForViewer.ts | export const ID_CHECK_BEFORE_ANSWER = true; | export const ID_CHECK_BEFORE_ANSWER = false;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ open: new Set<string>() as Set<string> | null }));
vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/components/landing/useSectionsOpen", () => ({ useSectionsOpen: () => ({ open: state.open, settled: state.open !== null, failed: false }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useOnboardingFee")>()),
  useOnboardingFeeCents: () => null,
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

import { TermsContent } from "@/pages/info/legal/TermsSection";
import { ID_CHECK_BEFORE_ANSWER, ID_ONCE_PER_ACCOUNT } from "@/lib/useIdCheckOnForViewer";

function firstShortItem(): string {
  render(<MemoryRouter><TermsContent /></MemoryRouter>);
  const card = screen.getByText("The short version").closest("div.rounded-\\[20px\\]") as HTMLElement;
  const items = [...card.querySelectorAll("li")].map((li) => li.textContent ?? "");
  expect(items.length).toBeGreaterThan(3);
  return items[0];
}

afterEach(() => {
  cleanup();
  state.open = new Set();
});

describe("L003: the Terms' short version says the real ID rule to a signed-out visitor", () => {
  it("a signed-out visitor: email AND one photo ID check per account, and when", () => {
    state.open = new Set(["identity_check"]);
    const first = firstShortItem();
    expect(first).toMatch(/^You must be 18\+\. Every account verifies its email address before it can post or take jobs\./);
    expect(first).toContain(`You also verify ${ID_ONCE_PER_ACCOUNT}.`);
    expect(ID_ONCE_PER_ACCOUNT).toMatch(/once per account/);
    expect(ID_ONCE_PER_ACCOUNT).toMatch(/post a job.*hired.*delivery.*list an item.*buy/);
  });

  // Lead 11-09: identity_check is on for everyone, so before any answer (the build-time prerender of /legal, a guest's
  // read in flight) the pages say the ID rule; the real answer, once in, still wins.
  it("before the answer is known (prerender, first paint): the ID rule, which is true today", () => {
    state.open = null;
    const first = firstShortItem();
    expect(first).toContain(`You also verify ${ID_ONCE_PER_ACCOUNT}.`);
    expect(ID_CHECK_BEFORE_ANSWER).toBe(true);
  });
});
