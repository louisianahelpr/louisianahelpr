/**
 * The landing's greeting (owner 11-21, greeting mockup option B "without gifts", greet-b2.png): on /gift-guides only,
 * above the three guides, a cream card in a red-white-green candy-cane border reading "Happy holidays, y'all" (Bodoni
 * italic) and "Gifts we love for everyone on your list". Not on a guide page and not on the finder view.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       <div className="gg-greet" data-gift-greeting=""> |       <div className="gg-greet" hidden>
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-greet{margin:4px 0 0;padding:9px;border-radius:14px;background:repeating-linear-gradient(-45deg,#a8242a 0 12px,#fff 0 18px,#265e3c 0 30px,#fff 0 36px)} | .gg-greet{margin:4px 0 0;padding:9px;border-radius:14px}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

afterEach(cleanup);

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

describe("the gift guides landing greets shoppers (owner 11-21, option B without gifts)", () => {
  it("/gift-guides: the greeting card, above the three guides", () => {
    const { container } = renderAt("/gift-guides");
    const g = container.querySelector("[data-gift-greeting]:not([hidden])");
    expect(g).not.toBeNull();
    expect(g!.querySelector(".gg-greet-h")?.textContent).toBe("Happy holidays, y'all");
    expect(g!.querySelector(".gg-greet-p")?.textContent).toBe("Gifts we love for everyone on your list");
    const guides = container.querySelector("[data-gift-browse]");
    expect(guides).not.toBeNull();
    expect(g!.compareDocumentPosition(guides!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No gifts on it: words only, no image.
    expect(g!.querySelectorAll("img").length).toBe(0);
  });

  it("only the landing: not on a guide page or the finder view", () => {
    for (const url of ["/gift-guides/her", "/gift-guides/kids", "/gift-guides#gift-finder"]) {
      const { container } = renderAt(url);
      expect(container.querySelector("[data-gift-greeting]"), url).toBeNull();
      cleanup();
    }
  });

  it("the card wears the candy-cane border and the Bodoni italic in the covers' red", () => {
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-greet\{[^}]*repeating-linear-gradient\(-45deg,#a8242a[^}]*#265e3c/);
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-greet-h\{[^}]*italic[^}]*'Bodoni Moda'[^}]*color:#a8242a/);
  });
});
