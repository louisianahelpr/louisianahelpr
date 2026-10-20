/**
 * The landing page (Index) is what MOUNTS "How it works". HowItWorksSection is
 * tested on its own elsewhere; this renders the production parent so a dropped
 * or mis-wired mount stays red (vacuity: component tested only in isolation).
 *
 * The neighbours that pull in the data layer (section blocks, trust,
 * layout, scroll-fade hook) are stubbed to markers; HeroSection and HowItWorksSection are
 * the real ones.
 *
 * @mutate src/pages/info/Index.tsx |       <HowItWorksSection />\n |
 * @mutate src/pages/info/Index.tsx |       <HeroSection />\n |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Index from "./Index";

vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));
vi.mock("@/hooks/useScrollFadeUp", () => ({ useScrollFadeUp: () => {} }));
vi.mock("@/components/marketing/PublicLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("@/components/landing/SectionsShowcase", () => ({
  SectionsShowcase: () => <div data-testid="sections" />,
  TrustAndJoin: () => <div data-testid="trust" />,
}));

afterEach(cleanup);

describe("Index mounts How it works between the section blocks and the trust close", () => {
  it("renders the real How it works section in the landing, in order", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Index />
      </MemoryRouter>,
    );
    expect(screen.getByText("Post the job")).toBeTruthy();
    expect(container.querySelector('[data-testid="landing-signup"]')).not.toBeNull();
    const html = container.innerHTML;
    const at = (needle: string) => html.indexOf(needle);
    const sections = at('data-testid="sections"');
    const how = at("Post the job");
    const trust = at('data-testid="trust"');
    expect(sections).toBeGreaterThan(-1);
    expect(how).toBeGreaterThan(sections);
    expect(trust).toBeGreaterThan(how);
  });
});
