/**
 * /help shipped with `grep -c btn-grad-primary` = 0 in its body and seven FAQ
 * anchors that nothing honoured.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HelpCenter from "./HelpCenter";

vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));

// jsdom has no layout, so scrollIntoView is not implemented on the prototype.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", "/help");
});

const renderHelp = () =>
  render(
    <MemoryRouter initialEntries={["/help"]}>
      <HelpCenter />
    </MemoryRouter>,
  );

describe("/help offers one unambiguous way to reach a person", () => {
  it("renders the escape hatch as the shared GLOSSY primary control, not an inline link", () => {
    renderHelp();
    const cta = screen.getByRole("link", { name: /Contact support/i });
    // The gloss lives in `btn-grad-primary` (index.css). Asserting the CLASS is
    // the only thing jsdom can see; the two documented ways to lose the gloss
    // are a Tailwind variant over a hand-written class and an inline
    // `background` shorthand — neither is used here, and neither is present in
    // the element's own style attribute.
    expect(cta.className).toContain("btn-grad-primary");
    expect(cta.getAttribute("style") ?? "").not.toMatch(/background\s*:/);
    expect(cta.getAttribute("href")).toBe("/support");
  });

  it("keeps exactly ONE primary action in the page BODY", () => {
    // Scoped to the FAQ section, not the document: the shared marketing navbar
    // carries its own glossy "Get Started" on every public route, which is
    // chrome rather than this page's primary action. Before this change the
    // body's count was ZERO — that nav CTA was the page's only gloss, which is
    // exactly why the raw `grep -c btn-grad-primary src/pages/HelpCenter.tsx`
    // reading of 0 was the accurate one.
    const { container } = renderHelp();
    const body = container.querySelector("#faq")!;
    expect(body.querySelectorAll(".btn-grad-primary").length).toBe(1);
  });
});

describe("/help FAQ anchors are real destinations", () => {
  it("every section is collapsed on a plain visit", () => {
    renderHelp();
    for (const b of screen.getAllByRole("button", { expanded: false })) {
      expect(b.getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });

  it("stamps an id for every topic", () => {
    const { container } = renderHelp();
    const ids = [...container.querySelectorAll("[id^='faq-']")].map((n) => n.id);
    expect(ids).toContain("faq-payments-escrow");
    expect(ids).toContain("faq-trust-safety");
  });

  it("#faq-<topic> OPENS that topic and scrolls to it", async () => {
    window.history.replaceState({}, "", "/help#faq-payments-escrow");
    const { container } = renderHelp();
    const section = container.querySelector("#faq-payments-escrow")!;
    const header = section.querySelector("button")!;
    await waitFor(() => expect(header.getAttribute("aria-expanded")).toBe("true"));
    // …and ONLY that one. Landing on an anchor must not unfold the whole page.
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
  });

  it("an addressed section can still be closed by hand", async () => {
    window.history.replaceState({}, "", "/help#faq-payments-escrow");
    const { container } = renderHelp();
    const header = container.querySelector("#faq-payments-escrow button") as HTMLElement;
    await waitFor(() => expect(header.getAttribute("aria-expanded")).toBe("true"));
    fireEvent.click(header);
    await waitFor(() => expect(header.getAttribute("aria-expanded")).toBe("false"));
  });

  it("an unknown hash opens nothing rather than guessing", () => {
    window.history.replaceState({}, "", "/help#faq-does-not-exist");
    renderHelp();
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });
});

describe("/help open and closed sections do not look identical", () => {
  it("changes the section's own surface, not just the chevron", async () => {
    const { container } = renderHelp();
    const section = container.querySelector("#faq-getting-started") as HTMLElement;
    const closed = { bg: section.style.background, border: section.style.border, shadow: section.style.boxShadow };
    fireEvent.click(section.querySelector("button")!);
    await waitFor(() => expect(section.querySelector("button")!.getAttribute("aria-expanded")).toBe("true"));
    expect(section.style.background).not.toBe(closed.bg);
    expect(section.style.border).not.toBe(closed.border);
    expect(section.style.boxShadow).not.toBe(closed.shadow);
  });

  it("wires the header to the panel it controls", async () => {
    const { container } = renderHelp();
    const section = container.querySelector("#faq-getting-started") as HTMLElement;
    const header = section.querySelector("button")!;
    expect(header.getAttribute("aria-controls")).toBe("faq-panel-getting-started");
    fireEvent.click(header);
    await waitFor(() => expect(container.querySelector("#faq-panel-getting-started")).toBeTruthy());
  });
});
