/**
 * #2894 vacuity (mount wiring): HowItWorksSection was tested only on its own, so a broken mount in the landing page
 * (never rendered, wrong props) stayed green. This renders the real Index page with its neighbours stubbed and the
 * real HowItWorksSection, and asserts the section is on the page.
 *
 * D014 (landing design audit 11-10, High; Direction A "Porch and Parish", owner 11-10): the story order is the hero,
 * real local photos, what is near you this week, what neighbors say, how it works, the safety band, then join. It was
 * hero, a switch, jobs, "Four ways", how it works, money, join.
 *
 * @mutate src/pages/info/Index.tsx |       <HowItWorksSection />\n |
 * @mutate src/pages/info/Index.tsx |       <LandingPhotoBand />\n\n      <NearYouSection />\n |       <NearYouSection />\n\n      <LandingPhotoBand />\n
 * @mutate src/pages/info/Index.tsx |       <NeighborsSay />\n\n      <HowItWorksSection />\n |       <HowItWorksSection />\n\n      <NeighborsSay />\n
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
vi.mock("@/components/landing/LandingPhotoBand", () => ({ LandingPhotoBand: () => <section data-stub="photos" /> }));
vi.mock("@/components/landing/NearYouSection", () => ({ NearYouSection: () => <section data-stub="near-you" /> }));
vi.mock("@/components/landing/NeighborsSay", () => ({ NeighborsSay: () => <section data-stub="neighbors" /> }));
vi.mock("@/components/landing/SectionsShowcase", () => ({ TrustAndJoin: () => <section data-stub="join" /> }));

import Index from "@/pages/info/Index";

describe("the landing page mounts How it works, in Direction A's story order", () => {
  it("hero, photos, near you, neighbors say, how it works, then the band and join", () => {
    const { container } = render(<MemoryRouter><Index /></MemoryRouter>);
    expect(container.querySelector("#how-it-works"), "How it works is on the landing page").toBeTruthy();
    const order = ["[data-stub=hero]", "[data-stub=photos]", "[data-stub=near-you]", "[data-stub=neighbors]", "#how-it-works", "[data-stub=join]"].map((s) => container.querySelector(s));
    expect(order.every(Boolean), order.map((e) => !!e).join(",")).toBe(true);
    expect(order.length).toBeGreaterThan(5);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `step ${i}`).toBeTruthy();
    // Nothing else between the hero and the photos: the photos are the first thing under the locked hero.
    expect(order[0]!.nextElementSibling).toBe(order[1]);
  });
});
