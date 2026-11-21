/**
 * Amazon Associates bounty (lead 11-21, owner pop-up: all of the growth items). Confirmed on Amazon's own pages
 * 2026-11-21: the Commission Income Statement (affiliate-program.amazon.com/welcome/compensation) lists "Prime Free
 * Trial", homepage "https://www.amazon.com/prime", $12.00; the Program Policies (updated April 14, 2026) permit "Special
 * Links to the bounty-specific homepages listed in the Appendix". The guide page shows ONE calm line, "Try Prime free
 * for fast holiday shipping", under a list showing an Amazon pick: that homepage with our tag (louisianahelpr-20),
 * sponsored and in a new tab, never on a card, with the Amazon Associate statement on the same page.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       <PrimeTrialLink picks={picks.slice(0, upTo)} /> |       {null}
 * @mutate src/components/giftGuides/PrimeTrialLink.tsx |   if (!picks.some((p) => p.store === "amazon")) return null; |   if (false) return null;
 * @mutate src/content/giftGuides.ts | href: "https://www.amazon.com/prime?tag=louisianahelpr-20" | href: "https://www.amazon.com/prime"
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadGuidePicks } from "@/content/giftGuideCatalog";
import { giftGuides as G } from "@/content/giftGuides";
import { PrimeTrialLink } from "@/components/giftGuides/PrimeTrialLink";

afterEach(cleanup);

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

describe("the Prime free trial line (Amazon bounty)", () => {
  it.each(["her", "him", "kids", "mom"])("/gift-guides/%s shows exactly one, tagged, sponsored, outside every card", async (slug) => {
    await act(async () => { await loadGuidePicks(slug); });
    const { container } = renderAt(`/gift-guides/${slug}`);
    const amazonRows = [...container.querySelectorAll<HTMLAnchorElement>("[data-gift-pick] a[data-gift-out]")].filter((a) => new URL(a.href).hostname === "www.amazon.com");
    expect(amazonRows.length, slug).toBeGreaterThan(3);
    const lines = container.querySelectorAll("[data-gift-prime-trial]");
    expect(lines).toHaveLength(1);
    const a = lines[0].querySelector<HTMLAnchorElement>("a")!;
    expect(a.textContent).toBe("Try Prime free for fast holiday shipping");
    const url = new URL(a.href);
    expect(`${url.origin}${url.pathname}`).toBe("https://www.amazon.com/prime");
    expect(url.searchParams.get("tag")).toBe("louisianahelpr-20");
    expect(a.getAttribute("rel")).toContain("sponsored");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(lines[0].closest("[data-gift-pick]")).toBeNull();
    expect(container.querySelector("[data-gift-amazon-statement]")?.textContent).toBe(G.amazonStatement);
  });

  it("draws nothing when no row on screen is an Amazon pick", () => {
    const { container } = render(<PrimeTrialLink picks={[{ name: "Mug", href: "https://go.shopmy.us/p-1", store: "shopmy" }]} />);
    expect(container.innerHTML).toBe("");
    const amazon = render(<PrimeTrialLink picks={[{ name: "Socks", href: "https://www.amazon.com/dp/B0X?tag=louisianahelpr-20", store: "amazon" }]} />);
    expect(amazon.container.querySelectorAll("[data-gift-prime-trial] a")).toHaveLength(1);
  });
});
