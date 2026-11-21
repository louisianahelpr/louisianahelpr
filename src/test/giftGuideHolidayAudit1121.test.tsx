/**
 * Holiday gift guides audit 1121, the High findings (Audit-Holiday-Guides-1121.json). One guard per class:
 *   - every person the gift finder and the swipe deck offer gets picks at every budget offered (Kids was empty: its
 *     finder entry read sections the flat Kids list no longer has);
 *   - every page that carries an Amazon affiliate link carries the affiliate disclosure and Amazon's statement (Swipe and
 *     the Gift planner had neither).
 *
 * @mutate src/content/giftGuideExtras1120.ts |   { id: "kids", label: "Kids", guides: [{ slug: "kids" }] }, |   { id: "kids", label: "Kids", guides: [{ slug: "kids", sections: ["little-kids"] }, { slug: "kids", sections: ["big-kids"] }] },
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-title .text-page-title{margin:0;min-width:0;overflow-wrap:anywhere} | .gg-head-title .text-page-title{margin:0;min-width:0;white-space:nowrap}
 * @mutate src/components/ScrollToTop.tsx |       return scrollToHash(hash); |       return;
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx |           <p data-gift-amazon-statement="">{G.amazonStatement}</p> |           {null}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { useEffect, useState } from "react";
import { act, waitFor } from "@testing-library/react";
import { Route, Routes, useNavigate } from "react-router-dom";
import ScrollToTop from "@/components/ScrollToTop";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
import { isOwnerList } from "@/content/giftGuidePeople.mjs";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { giftGuides as G } from "@/content/giftGuides";
import { FunBody } from "@/pages/info/giftGuides/fun/FunPage";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { FINDER_BUDGET_GUIDES, FINDER_VIBES, FINDER_WHO, finderBudgets, finderPool, giftFinder } from "@/content/giftGuideExtras1120";
import { SWIPE_WHO, swipePool } from "@/content/giftGuideFun1120";

const picksOf = (slug: string) => guideBySlug(slug)?.picks ?? [];
/** og/landing.jpg as of 11-19 (#4750): the eight-guide sage and pink collage, four of them retired. */
const OLD_LANDING_SHA = "d7bc4ff99f8473e57c4dac39f4c5fdb48d5903390479c375acb3050db1e90c93";
afterEach(cleanup);

describe("the gift finder and the swipe deck: every person offered has picks (holiday audit 1121, High)", () => {
  it("each live finder person gets picks for every budget it offers and every vibe; Kids offers real budgets", async () => {
    await loadAllGuidePicks();
    const borrow = FINDER_BUDGET_GUIDES.flatMap(picksOf);
    // The people the finder shows: only those whose guides are live (GiftGuideFinder.tsx `people`).
    const people = FINDER_WHO.filter((w) => w.guides.every((g) => guideBySlug(g.slug)));
    expect(people.map((w) => w.id)).toEqual(expect.arrayContaining(["her", "him", "kids"]));
    const empty: string[] = [];
    for (const w of people) {
      const pool = finderPool(w.id, picksOf);
      expect(pool.length, w.id).toBeGreaterThan(30); // inventory floor: Her 36, Him 47, Kids 56 on 2026-11-21
      const budgets = finderBudgets(pool, w.id, borrow);
      expect(budgets.length, `${w.id} budgets`).toBeGreaterThan(1);
      for (const b of budgets) {
        for (const v of FINDER_VIBES) {
          const r = giftFinder(pool, b.id, v.id, borrow, w.id);
          if (r.exact.length + r.close.length === 0) empty.push(`${w.id}/${b.id}/${v.id}`);
        }
      }
    }
    expect(empty).toEqual([]);
  });

  it("each live swipe person deals cards", async () => {
    await loadAllGuidePicks();
    const people = SWIPE_WHO.filter((o) => o.guides.every((g) => guideBySlug(g.slug)));
    expect(people.map((w) => w.id)).toEqual(expect.arrayContaining(["her", "him", "kids"]));
    expect(people.filter((w) => swipePool(w.id, picksOf).length === 0).map((w) => w.id)).toEqual([]);
  });
});

describe("the landing's share card shows the live guides (holiday audit 1121, High: it showed 4 retired ones)", () => {
  // scripts/gift-guide-landing-og.json: the sha256 of each cover og/landing.jpg was drawn from.
  const sources = JSON.parse(readFileSync("scripts/gift-guide-landing-og.json", "utf8")) as Record<string, string>;
  const drawn = Object.keys(sources).filter((k) => k !== "_");
  it("it was drawn from exactly the live owner lists' covers, as they are now (redraw it when one changes)", () => {
    const live = LIVE_GUIDES_1121.filter((s) => isOwnerList(s));
    expect(live.length).toBeGreaterThan(2); // inventory floor: Her, Him, Kids on 2026-11-21
    expect(drawn).toEqual(live);
    const stale = drawn.filter((s) => createHash("sha256").update(readFileSync(`public/gift-guides/og/${s}.jpg`)).digest("hex") !== sources[s]);
    expect(stale, "run python3 scripts/gift-guide-landing-og.py, then bump ?v= in api/share.ts").toEqual([]);
  });
  it("the card itself was redrawn by that script (its bytes differ from the 11-19 eight-guide collage)", () => {
    const sha = createHash("sha256").update(readFileSync("public/gift-guides/og/landing.jpg")).digest("hex");
    expect(sha).not.toBe(OLD_LANDING_SHA);
  });
});

describe("an in-app #link scrolls to its section, even one drawn late (holiday audit 1121, High)", () => {
  // Every route a #link reaches goes through the app-wide ScrollToTop; jsdom has no layout, so the call is the proof.
  it("pushing /page#later scrolls the #later section into view once it mounts, and again on a second tap", async () => {
    const calls: string[] = [];
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) { calls.push(this.id); });
    function Late() {
      const [on, setOn] = useState(false);
      useEffect(() => { const t = setTimeout(() => setOn(true), 150); return () => clearTimeout(t); }, []);
      return on ? <section id="cyber-monday">deals</section> : <p>loading</p>;
    }
    let go: (to: string) => void = () => {};
    function Nav() { const n = useNavigate(); go = (to) => n(to); return null; }
    render(
      <MemoryRouter initialEntries={["/gift-guides"]}>
        <ScrollToTop />
        <Nav />
        <Routes><Route path="/gift-guides" element={<p>landing</p>} /><Route path="/deals" element={<Late />} /></Routes>
      </MemoryRouter>,
    );
    act(() => go("/deals#cyber-monday"));
    await waitFor(() => expect(calls).toContain("cyber-monday"), { timeout: 1500 });
    const first = calls.length;
    // A second tap on the same link (same URL, a new history key) scrolls again.
    act(() => go("/deals#cyber-monday"));
    await waitFor(() => expect(calls.length).toBeGreaterThan(first), { timeout: 1500 });
    spy.mockRestore();
  });
});

describe("signed in on a phone, the guide pages fit the screen (holiday audit 1121, High)", () => {
  // Measured (tmp harness, ~/.lh-shots/holiday-fixes-1121/fit): signed in at 320 the one-line title made the public
  // container 354px wide in a 320px frame and clipped Share; after, 320/375/390 fit in Chromium and WebKit.
  it("no rule keeps the header title on one line below 768px", () => {
    const top = GIFT_GUIDES_CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const titleRules = [...top.matchAll(/([^{}]*\.gg-head-title[^{}]*)\{([^{}]*)\}/g)];
    expect(titleRules.length).toBeGreaterThan(0); // inventory floor: the base .gg-head-title rules exist
    expect(titleRules.filter(([, , body]) => /white-space:\s*nowrap/.test(body)).map(([, sel]) => sel.trim())).toEqual([]);
    // From 768px up it is one line again (the owner's one header row).
    expect(GIFT_GUIDES_CSS).toMatch(/@media \(min-width:768px\)\{(?:[^{}]*\{[^{}]*\})*?\.gg-head-title \.text-page-title\{white-space:nowrap\}/);
  });
});

/** The fun pages' sources (Swipe, Gift planner, Secret Santa and its reveal, printables), comments blanked. */
const FUN_SOURCES = Object.entries(import.meta.glob<string>("../pages/info/giftGuides/fun/*.tsx", { query: "?raw", import: "default", eager: true }))
  .map(([f, src]) => [f.replace(/^.*\//, ""), blankComments(src)] as const);

describe("affiliate links always carry the disclosure (holiday audit 1121, High: Swipe and the planner had none)", () => {
  it("the fun pages' shared body ends with the FTC disclosure and the Amazon Associates statement", () => {
    const { container } = render(<MemoryRouter><FunBody title="Swipe" path="/gift-guides/swipe"><p>deck</p></FunBody></MemoryRouter>);
    expect(container.querySelector("[data-gift-fun-disclosure] [data-gift-disclosure]")?.textContent).toBe(G.disclosure);
    expect(container.querySelector("[data-gift-fun-disclosure] [data-gift-amazon-statement]")?.textContent).toBe(G.amazonStatement);
    expect(G.amazonStatement).toMatch(/As an Amazon Associate/);
  });
  it("every fun page that renders an affiliate link (GiftOut or rel=sponsored) is drawn inside that body", () => {
    expect(FUN_SOURCES.length).toBeGreaterThan(4); // inventory floor: 7 files on 2026-11-21
    const linking = FUN_SOURCES.filter(([f, src]) => f !== "FunPage.tsx" && /<GiftOut\b|rel=["'][^"']*sponsored/.test(src));
    expect(linking.map(([f]) => f)).toEqual(expect.arrayContaining(["SwipeGifts.tsx", "GiftPlanner.tsx"]));
    expect(linking.filter(([, src]) => !/<FunBody\b/.test(src)).map(([f]) => f)).toEqual([]);
  });
});
