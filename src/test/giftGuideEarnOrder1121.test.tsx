/**
 * "Reorder by what earns" (lead 11-21, owner pop-up: all of the growth items). On Her, Him, Kids and their views the
 * default order, "Recommended", runs the price sections low to high and puts the picks people click most at the top of
 * their own section (src/content/giftGuideEarnOrder.ts). The click ranks come from our own outbound log: every
 * gift-guide shop link (GiftOut.tsx) sends "gift_out_click" with its link, and scripts/gift-guide-earn-rank.mjs ranks
 * the last 14 days into src/content/giftGuideEarnRank.json. "Price: low to high / high to low" stay pure price.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const picks = sortable && order === "top" ? earnFirstInGroups(sectioned, EARN_RANKS, (p) => p.sectionId ?? "") : sectioned; |   const picks = sectioned;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const picks = sortable && order === "top" ? earnFirstInGroups(sectioned, EARN_RANKS, (p) => p.sectionId ?? "") : sectioned; |   const picks = sortable ? earnFirstInGroups(sectioned, EARN_RANKS, (p) => p.sectionId ?? "") : sectioned;
 * @mutate src/content/giftGuideEarnOrder.ts |     out.push(...designTogether([...hot, ...run.filter((p) => !ranked(ranks[p.href]))], (p) => p)); |     out.push(...run);
 * @mutate src/content/giftGuideEarnOrder.ts | .sort((a, b) => ranks[a.href] - ranks[b.href]) | .sort((a, b) => ranks[b.href] - ranks[a.href])
 * @mutate src/pages/info/GiftGuides.tsx |   const sortOrder: GuideOrder = guide && order.slug === guide.slug ? order.order : "top"; |   const sortOrder: GuideOrder = guide && order.slug === guide.slug ? order.order : "low";
 * @mutate src/pages/info/giftGuides/GiftOut.tsx |   const opened = () => track("gift_out_click", { href: url }); |   const opened = () => undefined;
 * @mutate scripts/gift-guide-earn-rank.mjs |   const sorted = [...best].sort((a, b) => b[1] - a[1] \|\| (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); |   const sorted = [...best];
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const tracked = vi.hoisted(() => [] as [string, Record<string, unknown>][]);
vi.mock("@/lib/analytics", async (orig) => ({ ...(await orig<object>()), track: (e: string, p: Record<string, unknown>) => tracked.push([e, p]) }));

/** The ranks under test: on Her, the dearest pick of "$25 to $50" gets rank 1, the dearest "Under $25" pick rank 2. */
const planted = vi.hoisted(() => ({ top25: "", top0: "" }));
vi.mock("@/content/giftGuideEarnRank.json", async () => {
  const her = (await import("@/content/giftGuidePicks/her.json")).default as { picks: { href: string; price?: number; priceRank?: number }[] };
  const band = (lo: number, hi: number) => her.picks.filter((p) => p.price && Math.max(1, Math.round(p.price)) >= lo && Math.max(1, Math.round(p.price)) < hi).sort((a, b) => (a.priceRank ?? 0) - (b.priceRank ?? 0));
  const b25 = band(25, 50);
  const b0 = band(0, 25);
  planted.top25 = b25[b25.length - 1].href;
  planted.top0 = b0[b0.length - 1].href;
  return { default: { ranks: { [planted.top25]: 1, [planted.top0]: 2, "https://not-a-pick.example/x": 3 } } };
});

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadGuidePicks } from "@/content/giftGuideCatalog";
import { giftGuides as G } from "@/content/giftGuides";
import { earnFirstInGroups } from "@/content/giftGuideEarnOrder";
import { rankFromClicks, clicksByHref, fileBody, CLICKS_SQL } from "../../scripts/gift-guide-earn-rank.mjs";
import her from "@/content/giftGuidePicks/her.json";
import him from "@/content/giftGuidePicks/him.json";
import kids from "@/content/giftGuidePicks/kids.json";
import { openPriceSections, sectionTitle } from "./helpers/openPriceSections";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  tracked.length = 0;
});

describe("earnFirstInGroups (unit)", () => {
  const rows = [
    { href: "a1", g: "A" }, { href: "a2", g: "A" }, { href: "a3", g: "A" },
    { href: "b1", g: "B" }, { href: "b2", g: "B" },
  ];
  it("puts ranked picks first inside their own group, by rank, and keeps every group in place", () => {
    const out = earnFirstInGroups(rows, { a3: 2, a2: 5, b2: 1 }, (r) => r.g);
    expect(out.map((r) => r.href)).toEqual(["a3", "a2", "a1", "b2", "b1"]);
    expect(rows.map((r) => r.href)).toEqual(["a1", "a2", "a3", "b1", "b2"]); // input untouched
  });
  it("changes nothing with no ranks (or junk ranks)", () => {
    expect(earnFirstInGroups(rows, {}, (r) => r.g)).toEqual(rows);
    expect(earnFirstInGroups(rows, { a2: 0, a3: Number.NaN, b1: -1 }, (r) => r.g)).toEqual(rows);
  });
});

describe("the rank generator (scripts/gift-guide-earn-rank.mjs)", () => {
  it("ranks most clicks first, breaks ties by link, sums repeats, drops non-https and zero rows", () => {
    expect(rankFromClicks([
      { href: "https://b.example/1", clicks: 4 }, { href: "https://a.example/1", clicks: 4 }, { href: "https://c.example/1", clicks: 9 },
      { href: "javascript:alert(1)", clicks: 99 }, { href: "https://z.example/1", clicks: 0 }, { href: "https://a.example/1", clicks: 1 },
    ])).toEqual({ "https://c.example/1": 1, "https://a.example/1": 2, "https://b.example/1": 3 });
    expect(rankFromClicks(null)).toEqual({});
    // The raw counts the landing Top 10's 20-click rule reads (giftGuideTop10.ts), with the same drops and sums.
    expect(clicksByHref([{ href: "https://a.example/1", clicks: 4 }, { href: "https://a.example/1", clicks: 1 }, { href: "http://b.example/1", clicks: 9 }, { href: "https://c.example/1", clicks: 0 }])).toEqual({ "https://a.example/1": 5 });
    expect(JSON.parse(fileBody({}, "2026-11-21", { "https://a.example/1": 5 })).clicks).toEqual({ "https://a.example/1": 5 });
  });
  it("reads only our own click event, the last 14 days, without robots (analytics_events_real), read-only", () => {
    expect(CLICKS_SQL).toContain("FROM public.analytics_events_real");
    expect(CLICKS_SQL).toContain("event = 'gift_out_click'");
    expect(CLICKS_SQL).toContain("interval '14 days'");
    expect(CLICKS_SQL).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(JSON.parse(fileBody({ x: 1 }, "2026-11-21"))).toMatchObject({ generated: "2026-11-21", windowDays: 14, ranks: { x: 1 } });
  });
  it("every pick on the three guides is an https link, so the click log's links match the rank keys", () => {
    const all = [her, him, kids].flatMap((c) => (c as { picks: { href: string }[] }).picks);
    expect(all.length).toBeGreaterThan(100); // 36 + 39 + 40 measured 2026-11-21
    for (const p of all) expect(p.href, p.href).toMatch(/^https:\/\//);
  });
});

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );
const sections = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>("section[data-gift-section]")].map((sec) => ({
    title: sectionTitle(sec),
    hrefs: [...sec.querySelectorAll<HTMLAnchorElement>("[data-gift-pick] a[data-gift-out]:not(.gg-cart)")].map((a) => a.href).filter((h, i, all) => all.indexOf(h) === i),
  }));
const choose = (label: string) => {
  // The icon's name says which order is on (guides audit 1122 #21): "Sort by price", or "Sort by price, <order>".
  fireEvent.click(screen.getByRole("button", { name: (n) => n === G.sortLabel || n.startsWith(`${G.sortLabel}, `) }));
  fireEvent.click(within(screen.getByRole("menu", { name: G.sortLabel })).getByRole("menuitemradio", { name: new RegExp(`^.?${label.replace(/[$:]/g, ".")}$`) }));
};

describe("Her's default order puts the clicked picks first in their own section", () => {
  it("Recommended (the default) leads each section with its ranked picks; low to high stays pure price", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    await act(async () => { await loadGuidePicks("her"); });
    const { container } = renderAt("/gift-guides/her");
    openPriceSections(container);
    const top = sections(container);
    const s25 = top.find((s) => s.title === "$25 to $50")!;
    const s0 = top.find((s) => s.title === "Under $25")!;
    expect(s25.hrefs.length).toBeGreaterThan(2);
    expect(s25.hrefs[0]).toBe(planted.top25);
    expect(s0.hrefs[0]).toBe(planted.top0);

    choose(G.sortLowHigh);
    openPriceSections(container);
    const low = sections(container);
    // Same sections, same order, same members: only the order inside a section moved.
    expect(low.map((s) => s.title)).toEqual(top.map((s) => s.title));
    for (const [i, s] of low.entries()) expect([...s.hrefs].sort()).toEqual([...top[i].hrefs].sort());
    const l25 = low.find((s) => s.title === "$25 to $50")!;
    expect(l25.hrefs[l25.hrefs.length - 1]).toBe(planted.top25); // the dearest of its section, last in price order
    expect(l25.hrefs.slice(0, -1)).toEqual(s25.hrefs.slice(1));

    choose(G.sortTop);
    openPriceSections(container);
    expect(sections(container)).toEqual(top);
  });

  it("opening a pick logs one gift_out_click with its link (click or middle-click)", async () => {
    await act(async () => { await loadGuidePicks("her"); });
    const { container } = renderAt("/gift-guides/her");
    const link = container.querySelector<HTMLAnchorElement>("[data-gift-pick] a[data-gift-out]:not(.gg-cart)")!;
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 2 })); // a right-click opens nothing
    const clicks = tracked.filter(([e]) => e === "gift_out_click");
    expect(clicks).toEqual([["gift_out_click", { href: link.href }], ["gift_out_click", { href: link.href }]]);
  });
});
