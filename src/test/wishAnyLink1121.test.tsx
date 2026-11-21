/**
 * Add from any store (owner 2026-11-21: "people can put in the wish list ... create the links if we don't have it ...
 * they buy with our link"; "someone can just type in ideas ... and we find a link or closest match").
 *   - A pasted link is only read (never fetched or opened): https to a public site only.
 *   - An Amazon product link becomes amazon.com/dp/<ASIN> with OUR tag (any other tag dropped); a product our guides
 *     carry becomes that pick (our link, photo, price); any other shop's link stays as pasted, named from its words.
 *   - Typed words show up to 3 of our closest picks, or go on as typed.
 *   - Every shared list says buying through its links supports Louisiana Helpr.
 *
 * @mutate src/lib/wishLinks.ts | `https://www.amazon.com/dp/${asin}?tag=${AMAZON_TAG}` | u.toString()
 * @mutate src/lib/wishLinks.ts |   if (u.protocol !== "https:" \|\| u.username \|\| u.password \|\| u.port) return null; |   if (u.protocol !== "https:") return null;
 * @mutate src/lib/wishLinks.ts |     return pick ? { kind: "pick", pick } : { kind: "amazon" | return false ? { kind: "pick", pick } : { kind: "amazon"
 * @mutate src/lib/wishLinks.ts |   return scored.filter((x) => !seen.has(x.p.href) && !!seen.add(x.p.href)).slice(0, max).map((x) => x.p); |   return scored.map((x) => x.p);
 * @mutate src/lib/wishLinks.ts | short: SHORT_HOSTS.has( | short: !SHORT_HOSTS.has(
 * @mutate src/lib/wishLinks.ts | if (TRACKING.test(k)) c.searchParams.delete(k); | if (TRACKING.test(k)) void k;
 * @mutate src/pages/info/giftGuides/AnyStoreAdd.tsx |     if (close.length === 0) return addWords(); |     if (close.length === 0) return setMatches(close);
 * @mutate src/pages/info/giftGuides/AnyStoreAdd.tsx |         {extra} |         {null}
 * @mutate src/lib/wishLinks.ts | return href.length <= KEPT_HREF_MAX ? href : | return true ? href :
 * @mutate src/pages/info/giftGuides/GiftGuideSharedList.tsx |       {list && <p className="gg-price-note" data-gift-shared-supports=""> |       {false && <p className="gg-price-note" data-gift-shared-supports="">
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: vi.fn(), setSecretSantaWishList: vi.fn(), createSecretSanta: vi.fn(), SantaSaveError: class extends Error {},
  loadAccountPlan: vi.fn(), saveAccountPlan: vi.fn(),
}));

import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import { GiftGuideSharedList } from "@/pages/info/giftGuides/GiftGuideSharedList";
import { resetPlanStoreForTests } from "@/pages/info/giftGuides/fun/plannerStore";
import { resetGiftListForTests, itemId } from "@/pages/info/giftGuides/giftList";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { cleanPlan } from "@/content/giftGuideFun1120";
import { PLANNER_KEY } from "@/lib/giftPlannerDevice";
import { closestPicks, nameFromLink, ourLink, pastedLink } from "@/lib/wishLinks";

await loadAllGuidePicks();
const her = guideBySlug("her")!.picks;
const stored = () => cleanPlan((JSON.parse(window.localStorage.getItem(PLANNER_KEY) ?? "{}") as { plan?: unknown }).plan);
const u = (s: string) => pastedLink(s)!;

beforeEach(() => {
  window.localStorage.clear();
  resetPlanStoreForTests();
});
afterEach(() => {
  cleanup();
  resetGiftListForTests();
  resetHintsForTests();
});

describe("reading a pasted link (never opened)", () => {
  it("only https links to a public site", () => {
    expect(pastedLink("https://www.walmart.com/ip/Cozy-Sherpa-Throw-Blanket/123456")?.hostname).toBe("www.walmart.com");
    for (const bad of ["http://www.walmart.com/ip/x", "javascript:alert(1)", "https://localhost/x", "https://127.0.0.1/x", "https://user:pw@shop.com/x", "https://shop.com:8443/x", "https://printer.local/x", "cozy blanket"]) {
      expect(pastedLink(bad), bad).toBeNull();
    }
  });

  it("Amazon: our tag (theirs dropped); a guide pick: the pick; elsewhere: as pasted; short links are marked", () => {
    const asin = /\/dp\/([A-Z0-9]{10})/.exec(her[0].href)![1];
    const known = ourLink(u(`https://www.amazon.com/Some-Words/dp/${asin}/ref=sr_1_1?tag=someone-else-20&th=1`), her);
    expect(known.kind === "pick" && known.pick.href).toBe(her[0].href);
    const other = ourLink(u("https://www.amazon.com/gp/product/B000000001?tag=someone-else-20"), her);
    expect(other).toEqual({ kind: "amazon", asin: "B000000001", href: "https://www.amazon.com/dp/B000000001?tag=louisianahelpr-20" });
    const shop: CatalogPick = { name: "Sherpa Throw", href: "https://www.target.com/p/sherpa-throw/-/A-1234?aff=ours", store: "store-target" };
    const same = ourLink(u("https://target.com/p/sherpa-throw/-/A-1234/"), [shop]);
    expect(same.kind === "pick" && same.pick.href).toBe(shop.href);
    expect(ourLink(u("https://www.etsy.com/listing/99/hand-knit-scarf"), [shop])).toEqual({ kind: "plain", href: "https://www.etsy.com/listing/99/hand-knit-scarf", short: false });
    expect(ourLink(u("https://amzn.to/3xYz"), her)).toMatchObject({ kind: "plain", short: true });
    // Ad tracking is dropped and the product's own options stay; an overlong link keeps only its page.
    expect(ourLink(u("https://www.etsy.com/listing/99/scarf?utm_source=ig&variation=blue&fbclid=abc#reviews"), [])).toMatchObject({ href: "https://www.etsy.com/listing/99/scarf?variation=blue" });
    expect(ourLink(u(`https://www.etsy.com/listing/99/scarf?ref=${"x".repeat(900)}`), [])).toMatchObject({ kind: "plain", href: "https://www.etsy.com/listing/99/scarf" });
  });

  it("a starting name from the link's words; typed words find up to 3 of our closest picks", () => {
    expect(nameFromLink(u("https://www.walmart.com/ip/Cozy-Sherpa-Throw-Blanket/123456"))).toBe("Cozy Sherpa Throw Blanket");
    expect(nameFromLink(u("https://shop.example.com/12345"))).toBe("A gift from shop.example.com");
    const word = her[0].name.split(/\s+/).find((w) => w.length > 4)!.toLowerCase();
    const hits = closestPicks(`${word} please`, her, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits[0].name.toLowerCase()).toContain(word);
    expect(closestPicks("zzqx qqzz", her)).toEqual([]);
    // Never more than 3, best match first, each link once.
    const many: CatalogPick[] = ["Green Throw", "Green Mug", "Green Socks", "Green Throw Blanket", "Green Hat"].map((name, k) => ({ name, href: `https://x.example/${k}`, store: "store-x" }));
    const top = closestPicks("green throw blanket", [...many, many[3]], 3);
    expect(top.map((p) => p.name)).toEqual(["Green Throw Blanket", "Green Throw", "Green Mug"]);
  });
});

describe("Add from any store in the planner", () => {
  const start = async () => {
    const view = render(<MemoryRouter><GiftPlanner /></MemoryRouter>);
    fireEvent.change(view.container.querySelector("[data-plan-new-name]")!, { target: { value: "Mom" } });
    fireEvent.click(view.container.querySelector("[data-plan-add-person]")!);
    const id = await waitFor(() => stored().people[0].id);
    return { c: view.container, id };
  };
  const go = (c: HTMLElement, id: string, text: string) => {
    fireEvent.change(c.querySelector(`[data-anystore-input="${id}"]`)!, { target: { value: text } });
    fireEvent.click(c.querySelector(`[data-anystore-go="${id}"]`)!);
  };

  it("a pasted link to a guide pick goes on as that pick; another Amazon product goes on with our tag and its name", async () => {
    const { c, id } = await start();
    go(c, id, `${her[1].href.replace("?tag=louisianahelpr-20", "")}?tag=someone-else-20`);
    await waitFor(() => expect(stored().people[0].ideas).toHaveLength(1));
    expect(stored().people[0].ideas[0]).toMatchObject({ name: her[1].name, href: her[1].href, image: her[1].image, guide: "her" });

    go(c, id, "https://www.amazon.com/Cozy-Knit-Throw/dp/B000000001/ref=x?tag=someone-else-20");
    const name = c.querySelector<HTMLInputElement>("[data-anystore-name]")!;
    expect(name.value).toBe("Cozy Knit Throw");
    fireEvent.change(name, { target: { value: "Green knit throw" } });
    fireEvent.click(c.querySelector("[data-anystore-add-link]")!);
    expect(stored().people[0].ideas[1]).toMatchObject({ name: "Green knit throw", href: "https://www.amazon.com/dp/B000000001?tag=louisianahelpr-20" });
  });

  it("typed words offer our closest picks; one tap adds it; or the words go on as typed", async () => {
    const { c, id } = await start();
    const word = her[0].name.split(/\s+/).find((w) => w.length > 4)!;
    go(c, id, `${word} in green`);
    const rows = await waitFor(() => {
      const r = c.querySelectorAll<HTMLButtonElement>("[data-anystore-pick]");
      expect(r.length).toBeGreaterThan(0);
      return r;
    });
    expect(rows.length).toBeLessThanOrEqual(3);
    fireEvent.click(rows[0]);
    expect(stored().people[0].ideas[0].guide).toBe("her");
    go(c, id, `${word} size M`);
    fireEvent.click(c.querySelector("[data-anystore-words]")!);
    expect(stored().people[0].ideas.at(-1)).toMatchObject({ name: `${word} size M` });
    expect(stored().people[0].ideas.at(-1)?.href).toBeUndefined();
    // Nothing close in our guides: the words go straight on, no extra tap.
    go(c, id, "zzqx qqzz");
    expect(c.querySelector("[data-anystore-matches]")).toBeNull();
    expect(stored().people[0].ideas.at(-1)).toMatchObject({ name: "zzqx qqzz" });
  });

  it("the planner has one idea box (no second Gift idea field), with From our guides beside it", async () => {
    const { c, id } = await start();
    expect(c.querySelectorAll(`[data-anystore="${id}"] input`)).toHaveLength(1);
    expect(c.querySelector("[data-plan-idea-name]")).toBeNull();
    expect(c.querySelector(`[data-anystore="${id}"] [data-plan-from-guides="${id}"]`)).not.toBeNull();
  });
});

describe("shared lists disclose the affiliate links", () => {
  it("a shared list says buying through its links supports Louisiana Helpr", async () => {
    const read = vi.fn(async () => ({ name: "Lexi's list", items: [{ g: "her", i: itemId(her[0].href) }] }));
    const view = render(<MemoryRouter><GiftGuideSharedList code="cccccccccccc" read={read} /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector("[data-gift-shared-supports]")?.textContent).toBe("Buying through these links supports Louisiana Helpr."));
  });
});
