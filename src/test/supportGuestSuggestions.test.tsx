/**
 * F046 (owner UI audit 11-09; owner decision 11-09: guests see 2-3 suggested Help articles on /support too): a guest
 * typing a subject gets up to three matching Help center questions above the message box, each linking to its topic's
 * anchor on /help. A signed-in member does not (their help is the AI answer on Send).
 *
 * @mutate src/pages/info/Support.tsx |                 {isReady && !user && guestSuggestions.length > 0 && ( |                 {false && (
 * @mutate src/lib/helpSuggestions.ts |       if (score > 0) scored.push( |       if (score > 99) scored.push(
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: auth.user, isReady: true }) }));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ data: auth.user ? { full_name: "Lucy M", email: "l@x.net" } : null, isLoading: false }) }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));
// F236/F258: the setup fee amount is read live (a query); the tests give it the prod value.
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<typeof import("@/hooks/useOnboardingFee")>()), useOnboardingFeeCents: () => 200 }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({ PublicHeaderPage: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: async () => ({ data: null, error: null }) } } }));

import Support from "@/pages/info/Support";
import HelpCenter from "@/pages/info/HelpCenter";
import { FAQ_SECTIONS } from "@/pages/info/helpCenter/helpCenterContent";
import { helpTopicSlug, suggestHelp } from "@/lib/helpSuggestions";

const mount = () => render(<MemoryRouter initialEntries={["/support"]}><Support /></MemoryRouter>);

describe("F046: a guest on /support sees matching Help answers", () => {
  it("suggestHelp: up to three questions sharing the subject's words; none for no shared word", () => {
    expect(FAQ_SECTIONS.length).toBeGreaterThan(3);
    const s = suggestHelp("refund for a cancelled job", FAQ_SECTIONS);
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(3);
    for (const x of s) expect(x.href).toMatch(/^\/help#faq-[a-z0-9-]+$/);
    expect(suggestHelp("zzqx", FAQ_SECTIONS)).toEqual([]);
    expect(suggestHelp("", FAQ_SECTIONS)).toEqual([]);
  });

  it("every suggested link names a topic anchor the Help center really renders", () => {
    const { container, unmount } = render(<MemoryRouter><HelpCenter /></MemoryRouter>);
    for (const sec of FAQ_SECTIONS) expect(container.querySelector(`#faq-${helpTopicSlug(sec.topic)}`), sec.topic).not.toBeNull();
    unmount();
  });

  it("guest: typing a subject shows the answers above the message box; a member never sees them", () => {
    auth.user = null;
    const { container, unmount } = mount();
    expect(container.querySelector("[data-support-suggestions]")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "refund for a cancelled job" } });
    const box = container.querySelector("[data-support-suggestions]") as HTMLElement;
    expect(box).not.toBeNull();
    const links = [...box.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(3);
    const message = container.querySelector("#support-message")!;
    expect(box.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    auth.user = { id: "u1" };
    const m = mount();
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "refund for a cancelled job" } });
    expect(m.container.querySelector("[data-support-suggestions]")).toBeNull();
    m.unmount();
    auth.user = null;
  });
});

// F045 (owner UI audit 11-09): "the message box is named only by its placeholder". Measured: the visible label is
// linked (htmlFor="support-message" -> id="support-message"), so the box's accessible name is the label's words.
describe("F045: the message box is named by its visible label", () => {
  it("getByLabelText finds the textarea by 'Your message'", () => {
    auth.user = null;
    const { unmount } = mount();
    const box = screen.getByLabelText(/Your message/);
    expect(box.tagName).toBe("TEXTAREA");
    expect(box.id).toBe("support-message");
    unmount();
  });
});
