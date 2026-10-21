/**
 * #2894 vacuity (mount wiring): HowItWorksSection was tested only on its own, so a broken mount in the landing page
 * (never rendered, wrong props) stayed green. This renders the real Index page with its neighbours stubbed and the
 * real HowItWorksSection, and asserts the section is on the page.
 *
 * @mutate src/pages/info/Index.tsx |       <HowItWorksSection />\n |
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } }));
vi.mock("@/components/marketing/PublicLayout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));
vi.mock("@/hooks/useScrollFadeUp", () => ({ useScrollFadeUp: () => {} }));
vi.mock("@/components/landing/HeroSection", () => ({ default: () => <section data-stub="hero" /> }));
vi.mock("@/components/landing/SectionsShowcase", () => ({
  SectionsShowcase: () => <section data-stub="sections" />,
  TrustAndJoin: () => <section data-stub="join" />,
}));

import Index from "@/pages/info/Index";

describe("the landing page mounts How it works", () => {
  it("renders the real HowItWorksSection between the sections and the join block", () => {
    const { container } = render(<MemoryRouter><Index /></MemoryRouter>);
    const how = container.querySelector("#how-it-works");
    expect(how, "How it works is on the landing page").toBeTruthy();
    const order = ["[data-stub=sections]", "#how-it-works", "[data-stub=join]"].map((s) => container.querySelector(s));
    expect(order.every(Boolean)).toBe(true);
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
