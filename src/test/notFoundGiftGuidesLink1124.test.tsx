/**
 * Whole-app audit 1123 LA-7 (fixed 2026-11-24): the 404 page's search description offers the gift guides, but the page itself had no
 * link to them (only Go home, Browse Declutter, Browse jobs). It now has "Gift guides" beside the two browse links.
 *
 * @mutate src/pages/info/NotFound.tsx |                     <Link to="/gift-guides">{w("pub.giftGuides", "Gift guides")}</Link> |                     <Link to="/browse">{w("pub.giftGuides", "Gift guides")}</Link>
 */
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import NotFound from "@/pages/info/NotFound";
import { enPublic as EN_PUBLIC } from "@/lib/i18n/enPublic";
import { esPublic as ES_PUBLIC } from "@/lib/i18n/esPublic";

afterEach(() => cleanup());

describe("404 page: the gift guides are one tap away", () => {
  it("links /gift-guides among the quick links", () => {
    const { container } = render(<MemoryRouter initialEntries={["/gift-guides-nope/x"]}><NotFound /></MemoryRouter>);
    const quick = container.querySelector("[data-not-found-quick-links]")!;
    const links = [...quick.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links.length).toBeGreaterThan(2);
    expect(links).toContainEqual(["Gift guides", "/gift-guides"]);
    expect(EN_PUBLIC["pub.giftGuides"]).toBe("Gift guides");
    expect(ES_PUBLIC["pub.giftGuides"]).toBe("Guías de regalos");
  });
});
