/**
 * NO "VISIT" LINK ON A GUIDE CARD (owner 2026-11-22, the Small Business Saturday cards: "remove visit, they can click the
 * picture or title to visit"). Every business card (the 25 Days sponsors on /gift-guides/small-business-saturday, the
 * free "Featured local" cards there and on /shop-small) opens its page from its logo and from its name, each a link to
 * the card's one address in a new tab (as Visit did); the heart stays its own button outside both links; a business
 * with no link shows its logo and name as plain text (no dead link). The class: any card under the guides that still
 * draws a "Visit" link, or whose photo and title do not carry the card's address.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideSmallBiz.tsx |         <Out href={b.href} className="gg-sb-logo" hidden>{logo}</Out> |         <span className="gg-sb-logo">{logo}</span>
 * @mutate src/pages/info/giftGuides/GiftGuideSmallBiz.tsx |             <Out href={b.href} className="gg-sb-name-link">{b.name}<span className="sr-only"> ({G.newTab})</span></Out> |             <>{b.name}<Out href={b.href} className="gg-sb-visit">Visit</Out></>
 * @mutate src/pages/info/giftGuides/SmallBizLocal.tsx |       {href ? out("gg-sb-logo", logo, true) : <span className="gg-sb-logo">{logo}</span>} |       <span className="gg-sb-logo">{logo}</span>
 * @mutate src/pages/info/giftGuides/SmallBizLocal.tsx |   const out = (className: string, children: React.ReactNode, hidden = false) => href && ( |   const out = (className: string, children: React.ReactNode, hidden = false) => href === "x" && (
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const LISTINGS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Bayou Test Bakery", town: "Lafayette", category: "Food", link: "https://example.com/bakery", deal: "10% off", has_logo: true },
  { id: "22222222-2222-4222-8222-222222222222", name: "No Link Crafts", town: "Houma", category: "Crafts", link: "", deal: null, has_logo: false },
];
vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => LISTINGS, sbsLogoUrl: (id: string) => `https://example.com/logo/${id}.png` }));

import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import { SmallBizLocal } from "@/pages/info/giftGuides/SmallBizLocal";
import { dealDay } from "@/content/giftGuideDeals.mjs";

const ROOT = resolve(__dirname, "..", "..");
afterEach(cleanup);

/** Checks one business card: no Visit, the logo and the name carry the same address, the heart sits outside them. */
function checkCard(card: Element, label: string) {
  expect([...card.querySelectorAll("a")].filter((a) => /^\s*visit\b/i.test(a.textContent ?? "")), `${label}: a Visit link`).toEqual([]);
  expect(card.querySelector(".gg-sb-visit"), label).toBeNull();
  const logo = card.querySelector(".gg-sb-logo")!;
  const name = card.querySelector(".gg-sb-name")!;
  const nameLink = name.querySelector("a");
  if (logo.tagName === "A") {
    expect(nameLink, `${label}: the name is a link`).not.toBeNull();
    expect(logo.getAttribute("href"), label).toBe(nameLink!.getAttribute("href"));
    for (const a of [logo, nameLink!]) {
      expect(a.getAttribute("href"), label).toMatch(/^https:\/\//);
      expect(a.getAttribute("target"), label).toBe("_blank");
      expect(a.getAttribute("rel"), label).toMatch(/noopener/);
    }
    // One link for screen readers and Tab: the name's.
    expect(logo.getAttribute("aria-hidden"), label).toBe("true");
    expect(logo.getAttribute("tabindex"), label).toBe("-1");
    expect(nameLink!.textContent, label).toContain(name.textContent?.replace(/\s*\(opens.*$/, "").trim() ?? "");
  } else {
    expect(nameLink, `${label}: no link, no dead name link`).toBeNull();
  }
  for (const h of card.querySelectorAll("button")) expect(h.closest("a"), `${label}: the heart is inside a link`).toBeNull();
  return logo.tagName === "A";
}

describe("guide business cards: no Visit; the logo and the name open the business (owner 2026-11-22)", () => {
  it("Small Business Saturday: every sponsor card with a link opens it from its logo and its name", async () => {
    const { container } = render(<MemoryRouter><GiftGuideDeals day={dealDay("small-business-saturday")!} now={new Date("2026-11-22T18:00:00Z")} /></MemoryRouter>);
    await waitFor(() => expect(container.querySelectorAll("[data-gift-sb]").length).toBeGreaterThan(20));
    const cards = [...container.querySelectorAll("[data-gift-sb]")];
    const linked = cards.filter((c) => checkCard(c, c.getAttribute("data-gift-sb") ?? "")).length;
    expect(linked).toBeGreaterThan(20);
    expect(container.textContent).not.toMatch(/\bVisit\s*›/);
  });

  it("Featured local cards: the linked one opens from its logo and name; the one with no link is plain text", async () => {
    const { container } = render(<MemoryRouter><SmallBizLocal sponsors={[]} /></MemoryRouter>);
    await waitFor(() => expect(container.querySelectorAll("[data-gift-sbs-local]").length).toBe(2));
    const [a, b] = [...container.querySelectorAll("[data-gift-sbs-local]")];
    expect(checkCard(a, "linked")).toBe(true);
    expect(a.querySelector(".gg-sb-logo")?.getAttribute("href")).toBe("https://example.com/bakery");
    expect(checkCard(b, "no link")).toBe(false);
    expect(b.querySelectorAll("a").length).toBe(0);
  });

  it("source: no guide page draws a Visit link or keeps the Visit words", () => {
    const dir = "src/pages/info/giftGuides";
    const files = readdirSync(join(ROOT, dir), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f)).map((f) => join(dir, f));
    expect(files.length).toBeGreaterThan(30);
    const hits = files.filter((f) => /gg-sb-visit|\bW\.visit(Short)?\b|>\s*Visit\b/.test(blankComments(readFileSync(join(ROOT, f), "utf8"))));
    expect(hits).toEqual([]);
    for (const f of ["src/content/giftGuideSmallBiz.mjs", "src/content/sbsFeaturedLocal.ts"]) expect(blankComments(readFileSync(join(ROOT, f), "utf8")), f).not.toMatch(/\bvisit(Short)?:\s*"Visit"/);
  });
});
