/**
 * Landing audit 11-09, Lows:
 *   L017 footer links were 19px tall at 375 without a touch pointer (min 24): every footer link is at least 24px.
 *   L018 the footer heart was aria-hidden, so it read "Made with for Louisiana communities": it is named "love".
 *   L036 the footer tagline named Shops and Homes (Coming soon): only the sections open today.
 *   L035 the Helpr directory had no link from the landing or the footer: the footer's Explore lists Find a Helpr.
 *   L038 the 404's canonical link pointed at the home page: the 404 drops it.
 *
 * @mutate src/components/Footer.tsx | const FOOTER_LINK = "link-standard inline-flex items-center min-h-11"; | const FOOTER_LINK = "link-standard inline-flex items-center";
 * @mutate src/components/Footer.tsx |             aria-label={w("footer.love", "love")} |
 * @mutate src/pages/info/NotFound.tsx |     noCanonical: true, |
 * @mutate src/components/Footer.tsx |               <Link to="/helprs" className={FOOTER_LINK}> |               <Link to="/help" className={FOOTER_LINK}>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import Footer from "@/components/Footer";
import NotFound from "@/pages/info/NotFound";

afterEach(() => cleanup());

describe("landing audit 11-09: footer and 404 Lows", () => {
  it("L017: every footer link is at least 24px tall; L018: the heart is named; L036: only open sections", () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const links = [...container.querySelectorAll("a.link-standard")];
    expect(links.length).toBeGreaterThan(5);
    for (const a of links) expect(a.className.split(/\s+/)).toContain("min-h-11"); // 44px on every pointer since F214 (11-10)
    expect(screen.getByText(/Made with/).textContent).toMatch(/Made with\s*for/);
    expect(screen.getByRole("img", { name: "love" })).toBeTruthy();
    expect(container.textContent).toMatch(/Jobs and Declutter\s*for Louisiana\./);
    expect(container.textContent).not.toMatch(/Shops and Homes\s*for Louisiana/);
    // L035: the Helpr directory is in the footer's Explore.
    expect(screen.getByRole("link", { name: "Find a Helpr" }).getAttribute("href")).toBe("/helprs");
  });

  it("L038: the 404 page has no canonical link", () => {
    const link = document.createElement("link");
    link.rel = "canonical";
    link.href = "https://www.louisianahelpr.com";
    document.head.appendChild(link);
    render(<MemoryRouter initialEntries={["/nope"]}><NotFound /></MemoryRouter>);
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });
});
