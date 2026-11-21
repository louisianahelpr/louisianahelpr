/**
 * GUARD: the Declutter selling boost (owner 11-20, "make sharing and discovery easy": 2 real listings in 30 days, and
 * a real $85 lamp got 21 views from one Facebook share as of 2026-11-20 and nothing since).
 *
 *  1. One-tap "Share to Facebook" for the seller, on the item page and in the sheet right after listing: Facebook's
 *     share dialog on a computer, the phone's share sheet on a touch screen, the link copied when the pop-up is
 *     blocked; "Copy link"; and the "Share to your local groups" tip with a short post to paste.
 *  2. Browse's "New this week" row: the last 7 days' live listings, newest first, never a test (is_seed) listing,
 *     never the viewer's own, hidden when empty; its own chunk, so Browse's first screen downloads none of it.
 *  3. declutter_share_click carries the method and the screen only (no item id, title, price, town or link).
 *
 * @mutate src/lib/declutter/listingShare.ts |   return env.native \|\| (env.webShare && env.coarse) ? "native" : "facebook"; |   return env.native \|\| env.webShare ? "native" : "facebook";
 * @mutate src/lib/declutter/listingShare.ts |   return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(itemUrl)}`; |   return `https://www.facebook.com/sharer/sharer.php?u=${itemUrl}`;
 * @mutate src/components/declutter/DeclutterShareCard.tsx |   if (!win) void shareNative({ text: url, url }); |
 * @mutate src/lib/declutter/newThisWeek.ts |     .filter((i) => i.status === "live" && i.is_seed !== true && i.seller_id !== viewerId) |     .filter((i) => i.status === "live" && i.seller_id !== viewerId)
 * @mutate src/lib/declutter/newThisWeek.ts |       return Number.isFinite(t) && t >= since && t <= now + 60_000; |       return Number.isFinite(t);
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   const showFresh = !searched && !preview && freshRows.length > 0; |   const showFresh = !preview && freshRows.length > 0;
 * @mutate src/lib/declutter/listingShare.ts |   track(SHARE_CLICK_EVENT, { method, surface }); |   track(SHARE_CLICK_EVENT, { method });
 * @mutate src/components/declutter/ListedWhatNext.tsx |           <ShareListingRow item={it} surface="listed" /> |
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

const shareNative = vi.fn(async (_c: unknown) => "shared" as const);
const copyToClipboard = vi.fn(async (_t: string) => true);
const track = vi.fn();
const native = { on: false };
vi.mock("@/lib/nativeShare", () => ({ shareNative: (c: unknown) => shareNative(c), copyToClipboard: (t: string) => copyToClipboard(t) }));
vi.mock("@/lib/nativeInit", () => ({ get isNativePlatform() { return native.on; } }));
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock("@/lib/authRedirects", async (orig) => ({ ...(await orig<typeof import("@/lib/authRedirects")>()), getPublicOrigin: () => "https://www.louisianahelpr.com" }));

const state = { live: [] as unknown[] };
vi.mock("@/lib/declutter/saveCounts", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/saveCounts")>()), fetchSaveCounts: async () => new Map<string, number>() }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchLiveItems: async () => state.live,
  fetchPhotos: async () => [],
  fetchDropStates: async () => new Map(),
  fetchWatching: async () => new Set(),
  fetchMapPins: async () => new Map(),
}));
vi.mock("@/lib/declutter/bundle", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/bundle")>()), fetchBundleSellers: async () => new Set() }));
vi.mock("@/components/declutter/useDeclutterOrigin", () => ({
  useDeclutterOrigin: () => ({ origin: { status: "none" }, askDevice: () => undefined, asked: false, asking: false, canAskAgain: false, deviceNote: null, zip: null }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/sections/BrowseEndCard", () => ({ BrowseEndCard: () => <p>end of the list</p> }));

import { facebookShareUrl, groupPostText, listingUrl, plainSharePath, shareToFacebookPath, SHARE_CLICK_EVENT } from "@/lib/declutter/listingShare";
import { newThisWeek, NEW_THIS_WEEK_MAX } from "@/lib/declutter/newThisWeek";
import { ShareListingRow } from "@/components/declutter/DeclutterShareCard";
import { DeclutterBrowse } from "@/components/declutter/DeclutterBrowseView";

const ID = "3f2a1b0c-1111-4222-8333-444455556666";
const ITEM = { id: ID, title: "Brass table lamp", current_price_cents: 8500, area_label: "Delcambre" };
const ITEM_URL = `https://www.louisianahelpr.com/declutter/item/${ID}`;

function setPointer(coarse: boolean) {
  window.matchMedia = ((q: string) => ({ matches: coarse && q === "(pointer: coarse)", media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}
function setWebShare(on: boolean) {
  Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: on ? vi.fn() : undefined });
}

beforeEach(() => {
  native.on = false;
  setPointer(false);
  setWebShare(false);
});
afterEach(() => {
  cleanup();
  shareNative.mockClear();
  copyToClipboard.mockClear();
  track.mockClear();
  vi.restoreAllMocks();
});

describe("the share links", () => {
  it("the item link is the public item page, and Facebook's dialog carries it encoded", () => {
    expect(listingUrl("https://www.louisianahelpr.com/", ID)).toBe(ITEM_URL);
    expect(listingUrl("https://www.louisianahelpr.com", ID)).toBe(ITEM_URL);
    const fb = facebookShareUrl(ITEM_URL);
    expect(fb).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(ITEM_URL)}`);
    expect(fb).not.toContain("louisianahelpr.com/declutter"); // encoded, not raw
    expect(decodeURIComponent(new URL(fb).searchParams.get("u") ?? "")).toBe(ITEM_URL);
  });

  it("one tap: the app and touch screens with a share sheet use it; a computer opens Facebook; no sheet copies", () => {
    const cases = [
      [{ native: true, webShare: false, coarse: true }, "native"],
      [{ native: false, webShare: true, coarse: true }, "native"],
      [{ native: false, webShare: true, coarse: false }, "facebook"], // desktop Safari has navigator.share
      [{ native: false, webShare: false, coarse: true }, "facebook"],
      [{ native: false, webShare: false, coarse: false }, "facebook"],
    ] as const;
    for (const [env, want] of cases) expect(shareToFacebookPath(env), JSON.stringify(env)).toBe(want);
    expect(plainSharePath({ native: false, webShare: false })).toBe("copy");
    expect(plainSharePath({ native: false, webShare: true })).toBe("native");
    expect(plainSharePath({ native: true, webShare: false })).toBe("native");
    expect(cases.length).toBeGreaterThan(4);
  });

  it("the group post is short and plain: the item, its price, the town and the link; no affiliate, ID or fee words", () => {
    const paid = groupPostText(ITEM, ITEM_URL);
    expect(paid).toBe(`Selling my Brass table lamp for $85 in Delcambre. Message me here: ${ITEM_URL}`);
    const free = groupPostText({ ...ITEM, current_price_cents: 0, area_label: null }, ITEM_URL);
    expect(free).toBe(`Giving away my Brass table lamp, free to a good home. Grab it here: ${ITEM_URL}`);
    for (const p of [paid, free]) {
      expect(p.length).toBeLessThan(200);
      expect(p).not.toMatch(/affiliate|commission|sponsored|\bID\b|\$2\b|Free porch pickup/i);
    }
  });
});

describe("Share to Facebook on the seller's listing", () => {
  it("on a computer it opens Facebook's share dialog for the item link in a new tab, and records method facebook", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(<ShareListingRow item={ITEM} />);
    fireEvent.click(screen.getByRole("button", { name: "Share to Facebook" }));
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target] = open.mock.calls[0];
    expect(url).toBe(facebookShareUrl(ITEM_URL));
    expect(target).toBe("_blank");
    expect(shareNative).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(SHARE_CLICK_EVENT, { method: "facebook", surface: "item" });
  });

  it("on a phone with a share sheet it opens the sheet with the item link (no pop-up), method native", () => {
    setPointer(true);
    setWebShare(true);
    const open = vi.spyOn(window, "open");
    render(<ShareListingRow item={ITEM} surface="listed" />);
    fireEvent.click(screen.getByRole("button", { name: "Share to Facebook" }));
    expect(open).not.toHaveBeenCalled();
    expect(shareNative).toHaveBeenCalledTimes(1);
    expect((shareNative.mock.calls[0][0] as { url: string }).url).toBe(ITEM_URL);
    expect(track).toHaveBeenCalledWith(SHARE_CLICK_EVENT, { method: "native", surface: "listed" });
  });

  it("in the app it opens the app's share sheet", () => {
    native.on = true;
    const open = vi.spyOn(window, "open");
    render(<ShareListingRow item={ITEM} />);
    fireEvent.click(screen.getByRole("button", { name: "Share to Facebook" }));
    expect(open).not.toHaveBeenCalled();
    expect(shareNative).toHaveBeenCalledTimes(1);
  });

  it("a blocked pop-up still does something: the link goes to the share ladder, which copies it on a computer", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<ShareListingRow item={ITEM} />);
    fireEvent.click(screen.getByRole("button", { name: "Share to Facebook" }));
    expect(shareNative).toHaveBeenCalledTimes(1);
    expect((shareNative.mock.calls[0][0] as { url: string }).url).toBe(ITEM_URL);
  });

  it("Copy link copies the item link (method copy); Copy this post copies the group post", async () => {
    render(<ShareListingRow item={ITEM} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(ITEM_URL));
    expect(screen.getByText("Share to your local groups")).toBeTruthy();
    expect(document.querySelector("[data-group-post-text]")?.textContent).toBe(groupPostText(ITEM, ITEM_URL));
    fireEvent.click(screen.getByRole("button", { name: "Copy this post" }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(groupPostText(ITEM, ITEM_URL)));
    expect(track.mock.calls.filter((c) => c[1]?.method === "copy")).toHaveLength(2);
  });

  it("the share event carries no personal or listing data: only method and surface", () => {
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(<ShareListingRow item={ITEM} />);
    fireEvent.click(screen.getByRole("button", { name: "Share to Facebook" }));
    expect(track).toHaveBeenCalledTimes(1);
    const [, props] = track.mock.calls[0];
    expect(Object.keys(props).sort()).toEqual(["method", "surface"]);
    expect(JSON.stringify(props)).not.toMatch(new RegExp(`${ID}|Brass|8500|Delcambre|louisianahelpr`));
  });

  it("the sheet right after listing carries the share row (Share your listing)", () => {
    const src = blankComments(readFileSync("src/components/declutter/ListedWhatNext.tsx", "utf8"));
    expect(src).toContain('<ShareListingRow item={it} surface="listed" />');
    expect(src).toContain('{t("decl.share.title")}');
  });
});

describe("New this week", () => {
  const NOW = Date.parse("2026-11-20T18:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const row = (id: string, ageDays: number, extra: Record<string, unknown> = {}) => ({
    id, seller_id: "s1", status: "live", live_at: new Date(NOW - ageDays * day).toISOString(), created_at: new Date(NOW - ageDays * day).toISOString(), ...extra,
  });

  it("the last 7 days' live listings, newest first; never a test listing, the viewer's own, a reserved one or an old one", () => {
    const items = [
      row("old", 8), row("d3", 3), row("d1", 1), row("seed", 0.5, { is_seed: true }), row("mine", 0.2, { seller_id: "me" }),
      row("reserved", 2, { status: "reserved" }), row("d6", 6.9), row("nolive", 2, { live_at: null }),
    ];
    expect(newThisWeek(items, "me", NOW).map((i) => i.id)).toEqual(["d1", "nolive", "d3", "d6"]);
  });

  it("is empty with nothing new, and empty when it would only repeat the whole list", () => {
    expect(newThisWeek([row("a", 9), row("b", 30)], null, NOW)).toEqual([]);
    expect(newThisWeek([], null, NOW)).toEqual([]);
    expect(newThisWeek([row("a", 1), row("b", 2)], null, NOW)).toEqual([]);
    expect(newThisWeek([row("seed", 1, { is_seed: true }), row("old", 9)], null, NOW)).toEqual([]);
  });

  it("holds at most NEW_THIS_WEEK_MAX", () => {
    const many = Array.from({ length: 30 }, (_, n) => row(`n${n}`, n / 10));
    expect(newThisWeek(many, null, NOW)).toHaveLength(NEW_THIS_WEEK_MAX);
  });

  const card = (n: number, ageDays: number, extra: Record<string, unknown> = {}) => {
    const at = new Date(Date.now() - ageDays * day).toISOString();
    return {
      id: `i${n}`, seller_id: `s${n}`, status: "live", title: `Thing ${n}`, description: "", category: "furniture", condition_stars: 4, delivery_size: "small",
      price_cents: 1000, current_price_cents: 1000, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15, created_at: at, live_at: at, porch_ok: false, accepts_offers: true, ...extra,
    };
  };
  // The row is lazy: let its chunk resolve and React re-render before saying it is absent (never a vacuous null).
  const settleRow = async () => {
    await import("@/components/declutter/DeclutterNewThisWeek");
    await new Promise((r) => setTimeout(r, 50));
  };
  const browse = (entry = "/declutter") => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[entry]}><DeclutterBrowse userId="me" chrome={() => ({ tabs: null })} /></MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it("Browse shows the row above the grid with this week's listings, never the test one", async () => {
    state.live = [card(1, 1), card(2, 3), card(3, 20), card(4, 0.5, { is_seed: true })];
    browse();
    const section = await screen.findByRole("region", { name: "New this week" });
    const titles = [...section.querySelectorAll("[data-item-card]")].map((a) => a.textContent ?? "");
    expect(titles.length).toBe(2);
    expect(titles.some((t) => t.includes("Thing 1"))).toBe(true);
    expect(titles.some((t) => t.includes("Thing 2"))).toBe(true);
    expect(titles.some((t) => t.includes("Thing 3") || t.includes("Thing 4"))).toBe(false);
  });

  it("Browse hides the row when nothing is new", async () => {
    state.live = [card(1, 10), card(2, 20)];
    browse();
    await waitFor(() => expect(screen.queryAllByText(/^Thing \d$/).length).toBeGreaterThan(1));
    expect(screen.queryByRole("region", { name: "New this week" })).toBeNull();
    await settleRow();
    expect(document.querySelector("[data-new-this-week]")).toBeNull();
  });

  it("a search shows its own matches only: no row", async () => {
    state.live = [card(1, 1), card(2, 3), card(3, 20)];
    browse("/declutter?q=Thing");
    await waitFor(() => expect(screen.queryAllByText(/^Thing \d$/).length).toBeGreaterThan(2));
    await settleRow();
    expect(document.querySelector("[data-new-this-week]")).toBeNull();
  });

  it("the row is its own chunk (lazy), never a static import of Browse", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    // 2026-11-20 (train 1120f): the lazy() line lives in declutterNewThisWeekLazy.ts (Browse stays under 600 lines).
    expect(src).toContain('import { DeclutterNewThisWeek } from "./declutterNewThisWeekLazy";');
    expect(blankComments(readFileSync("src/components/declutter/declutterNewThisWeekLazy.ts", "utf8"))).toContain('export const DeclutterNewThisWeek = lazy(() => import("./DeclutterNewThisWeek"));');
    expect(src).not.toMatch(/import\s+[^;]*from\s+"\.\/DeclutterNewThisWeek"/);
  });
});
