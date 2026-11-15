/**
 * Page settle (prod-audit 11-15, /profile?tab=legal at 375, CLS 0.035): for a signed-in member the Terms short version
 * painted WITHOUT the ID sentence (the identity_check store reads false until IdentityCheckMount publishes an answer),
 * then grew it when the answer arrived, pushing every short-version line below down 64px.
 *
 * useIdCheckOnForViewer now keeps the pre-session wording (ID_CHECK_BEFORE_ANSWER) until the member's switch has a real
 * answer (useIdentityCheckLastAnswerStore), and keeps that answer through a failed refetch. A real "off" still drops
 * the sentence, so the Terms never claim a check the server does not run once the answer is in.
 *
 * @mutate src/lib/useIdCheckOnForViewer.ts |   return memberAnswer ?? ID_CHECK_BEFORE_ANSWER; |   return memberAnswer ?? false;
 * @mutate src/lib/useIdCheckOnForViewer.ts |   return memberAnswer ?? ID_CHECK_BEFORE_ANSWER; |   return memberAnswer === null ? ID_CHECK_BEFORE_ANSWER : true;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "member-1" }, isReady: true }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useOnboardingFee")>()),
  useOnboardingFeeCents: () => 200,
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

import { TermsContent } from "@/pages/info/legal/TermsSection";
import { ID_ONCE_PER_ACCOUNT } from "@/lib/useIdCheckOnForViewer";
import { setIdentityCheckLastAnswer, setIdentityCheckOn } from "@/lib/identityCheckSwitch";

const ID_SENTENCE = `You also verify ${ID_ONCE_PER_ACCOUNT}.`;

function firstShortItem(): string {
  const card = screen.getByText("The short version").closest("div.rounded-\\[20px\\]") as HTMLElement;
  const items = [...card.querySelectorAll("li")].map((li) => li.textContent ?? "");
  expect(items.length).toBeGreaterThan(3);
  return items[0];
}

afterEach(() => {
  cleanup();
  setIdentityCheckOn(false);
  setIdentityCheckLastAnswer(null);
});

describe("Terms short version: a member's ID line does not change between first paint and the switch answer", () => {
  it("before the member's answer: the same ID sentence a guest and the prerender read", () => {
    render(<MemoryRouter><TermsContent /></MemoryRouter>);
    expect(firstShortItem()).toContain(ID_SENTENCE);
  });

  it("the answer arrives ON: the line is unchanged (no reflow)", () => {
    render(<MemoryRouter><TermsContent /></MemoryRouter>);
    const before = firstShortItem();
    act(() => {
      setIdentityCheckOn(true);
      setIdentityCheckLastAnswer(true);
    });
    expect(firstShortItem()).toBe(before);
  });

  it("the answer arrives OFF: the sentence goes (the Terms never claim a check that is off)", () => {
    render(<MemoryRouter><TermsContent /></MemoryRouter>);
    act(() => {
      setIdentityCheckOn(false);
      setIdentityCheckLastAnswer(false);
    });
    expect(firstShortItem()).not.toContain(ID_SENTENCE);
  });

  it("a failed refetch after an ON answer keeps the answer instead of reading as off", () => {
    render(<MemoryRouter><TermsContent /></MemoryRouter>);
    act(() => {
      setIdentityCheckOn(false);
      setIdentityCheckLastAnswer(true);
    });
    expect(firstShortItem()).toContain(ID_SENTENCE);
  });
});
