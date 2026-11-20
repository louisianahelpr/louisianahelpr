/**
 * OWNER REQUEST 11-14: new members saw Home once and left (prod, 14 days: 37 new members, 18 only ever loaded /home,
 * 5 opened Jobs and all 5 applied, none posted a job). Three parts, each red on the code before it:
 *   1. a new member's Home leads with real things near them (jobs, items for sale) and big starting actions;
 *   2. a Get started guide worded from the first-run picks, ticking itself from real rows, hideable;
 *   3. the first-run tour points at today's chrome (dock Home/Jobs/Declutter, the top row's Messages, Create), finds
 *      each mark by path, never by words, and says "Home", never "Dashboard".
 *
 * @mutate src/components/firstRun/FirstRun.tsx |   messages: ['[data-testid="top-bar-inbox"]', '[data-sidebar-item="/messages"]'], |   messages: ['nav[aria-label="Bottom navigation"] button[aria-label$="Messages"]', '[data-sidebar-item="/messages"]'],
 * @mutate src/components/firstRun/FirstRun.tsx |     { target: "home", text: "Home shows what needs you, and what's new near you" }, |     { target: "home", text: "Dashboard shows what needs you" },
 * @mutate src/components/firstRun/FirstRun.tsx |   const declutterFirst = sells && (sell \|\| deal) && !earn && !hire; |   const declutterFirst = false;
 * @mutate src/components/firstRun/FirstRun.tsx |   return { left: centred, width: w, top: rect.top + rect.height + 16 }; |   return { left: rect.right + 16, top: rect.top, width: 320 };
 * @mutate src/components/firstRun/FirstRun.tsx |             if (userId) saveFirstRunPicks(userId, picks); |             void saveFirstRunPicks;
 * @mutate src/components/mobileNav/TabButton.tsx |     data-dock-tab={dockPath} | data-dock-x={dockPath}
 * @mutate src/pages/home/homeDashboard/GetStartedGuide.tsx |   apply: (f) => f.applied, |   apply: () => false,
 * @mutate src/pages/home/homeDashboard/GetStartedGuide.tsx |   if (steps.every((s) => s.done)) return null; |   void steps;
 * @mutate src/pages/home/homeDashboard/GetStartedGuide.tsx |   const shown = !!userId && !state?.dismissed && (fresh \|\| recent); |   const shown = !!userId && (fresh \|\| recent);
 * @mutate src/pages/home/homeDashboard/ForSaleNearYou.tsx |           .neq("seller_id", userId!) |           .neq("seller_id", "")
 * @mutate src/pages/home/homeDashboard/ForSaleNearYou.tsx | ordered.filter((s) => cover.has(s.item.id)) | ordered
 * @mutate src/pages/home/homeDashboard/ForSaleNearYou.tsx | const open = (rows ?? []).filter((r) => !blocked.has(r.seller_id)); | const open = rows ?? [];
 * @mutate src/pages/home/homeDashboard/NewMemberHome.tsx | const ForSaleNearYou = lazy(() => import("./ForSaleNearYou")); | import ForSaleNearYouNow from "./ForSaleNearYou";\nconst ForSaleNearYou = ForSaleNearYouNow;
 * Owner 2026-11-17 (signed-in tweaks, item 4): a quiet day (nothing needs you, nothing booked) shows "Near you" under
 * Coming up: up to 3 jobs and up to 4 items, from the same reads and rows, after the page settles.
 * @mutate src/pages/home/homeDashboard/NewMemberHome.tsx | <ForSaleNearYou userId={userId} max={4} /> | <ForSaleNearYou userId={userId} />
 * @mutate src/pages/home/HomeDashboard.tsx |             {nearYouDay && pageSettled && <NearYouBlock userId={user?.id} sell={sellOpen} />} |             {nearYouDay && <NearYouBlock userId={user?.id} sell={sellOpen} />}
 * @mutate src/pages/home/HomeDashboard.tsx | const nearYouDay = !welcome && firstJob !== null && !firstJob.isNew; | const nearYouDay = !welcome && firstJob !== null;
 * @mutate src/pages/home/HomeDashboard.tsx |             {welcome ? <NewMemberHome userId={user?.id} sell={sellOpen} guide={guide(true)} /> : ( |             {welcome ? <WelcomeCard sell={sellOpen} /> : (
 */
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

/** Per-table answers for the mocked client; every chained filter is recorded. */
const db = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  rows: {} as Record<string, unknown[]>,
  calls: [] as { table: string; op: string; args: unknown[] }[],
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const op of ["select", "eq", "neq", "in", "order", "limit", "or", "is"]) {
      c[op] = (...args: unknown[]) => { db.calls.push({ table, op, args }); return c; };
    }
    c.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve({ data: db.rows[table] ?? [], count: db.counts[table] ?? 0, error: null }).then(ok);
    return c;
  };
  const storage = { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://photos.test/${p}` } }) }) };
  return { supabase: { from: (t: string) => chain(t), rpc: (fn: string) => Promise.resolve({ data: db.rows[`rpc:${fn}`] ?? [], error: null }), storage } };
});
const ageGate = vi.hoisted(() => ({ underAge: false, explain: vi.fn() }));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({ underAge: false, explain: ageGate.explain, gate: (_k: string, go: () => void) => go, gatedProps: () => ({}) }),
}));
vi.mock("@/lib/haptics", () => { const n = () => {}; return { hapticLight: n, hapticMedium: n, hapticSuccess: n }; });

import { TARGETS, coachCardPosition, tourSteps } from "@/components/firstRun/FirstRun";
import { TabButton } from "@/components/mobileNav/TabButton";
import { readFirstRunPicks, saveFirstRunPicks } from "@/components/firstRun/firstRunPicks";
import { GetStartedGuide, getStartedKey, guideSteps } from "@/pages/home/homeDashboard/GetStartedGuide";
import ForSaleNearYou from "@/pages/home/homeDashboard/ForSaleNearYou";
import { NearYouBlock, NewMemberHome } from "@/pages/home/homeDashboard/NewMemberHome";

const src = (f: string) => blankComments(readFileSync(f, "utf8"));
function Where() {
  return <p data-testid="where">{useLocation().pathname + useLocation().search}</p>;
}
function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/home"]}>
        <Routes><Route path="*" element={<>{children}<Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  db.counts = {};
  db.rows = {};
  db.calls = [];
  localStorage.clear();
});
afterEach(cleanup);

describe("3. the first-run tour points at today's chrome (owner 11-14)", () => {
  it("every mark is found by path or test id: dock tabs, the top row's Messages, Create; never the old bottom-bar Messages", () => {
    const all = Object.values(TARGETS).flat();
    expect(all.length).toBeGreaterThan(8);
    for (const sel of all) expect(sel, sel).not.toMatch(/aria-label/);
    expect(TARGETS.messages[0]).toBe('[data-testid="top-bar-inbox"]'); // the Inbox icon (owner 11-15)
    expect(TARGETS.home[0]).toBe('[data-dock-tab="/home"]');
    expect(TARGETS.jobs[0]).toBe('[data-dock-tab="/jobs"]');
    expect(TARGETS.declutter[0]).toBe('[data-dock-tab="/declutter"]');
    // The chrome really carries those hooks.
    expect(src("src/components/sections/AppTopBar.tsx")).toContain("<TopBarInbox />");
    expect(src("src/components/inbox/InboxButton.tsx")).toContain('data-testid="top-bar-inbox"');
    expect(src("src/components/MobileNav.tsx")).toContain("dockPath={path}");
    expect(src("src/components/DesktopSidebarNav.tsx")).toContain('"data-sidebar-item": path');
    render(<nav><TabButton onTap={() => {}} onPrefetch={() => {}} ariaLabel="Trabajos" dockPath="/jobs" ariaCurrent={undefined} className="">x</TabButton></nav>);
    expect(document.querySelector(TARGETS.jobs[0])).not.toBeNull();
  });

  it("says Home, never Dashboard, and points at Jobs and Declutter, the picked section first", () => {
    const none = tourSteps([], true);
    expect(none.map((s) => s.target)).toEqual(["home", "jobs", "declutter", "create", "messages"]);
    expect(none.map((s) => s.text).join(" ")).not.toMatch(/Dashboard/);
    expect(none[0].text).toMatch(/^Home /);
    expect(tourSteps(["sell"], true).map((s) => s.target)).toEqual(["home", "declutter", "jobs", "create", "messages"]);
    expect(tourSteps(["deal"], true)[1].text).toBe("Find deals from your neighbors here");
    expect(tourSteps(["earn"], true)[1].text).toBe("Find jobs near you and apply here");
    // Declutter closed: never a mark for it.
    expect(tourSteps(["sell"], false).map((s) => s.target)).toEqual(["home", "jobs", "create", "messages"]);
    // Phone: Money and settings under the photo; desktop: under You.
    expect(none[4].text).toContain("your photo");
    expect(tourSteps([], true, true)[4].text).toContain("under You");
  });

  it("a mark on the phone's top row puts its card below it, inside a 390 screen", () => {
    const top = { top: 10, left: 290, right: 334, width: 44, height: 44 };
    const p = coachCardPosition(top, 390, 844) as { left: number; width: number; top: number };
    expect(p.top).toBeGreaterThan(54);
    expect(p.left).toBeGreaterThanOrEqual(16);
    expect(p.left + p.width).toBeLessThanOrEqual(390 - 16);
    // The desktop rail still gets its card beside the row.
    const rail = coachCardPosition({ top: 200, left: 12, right: 236, width: 224, height: 44 }, 1440, 900) as { left: number };
    expect(rail.left).toBe(252);
  });

  it("the picks are kept for Home's guide when the picker continues (never in the admin preview)", () => {
    const fr = src("src/components/firstRun/FirstRun.tsx");
    expect(fr).toContain("if (userId) saveFirstRunPicks(userId, picks);");
    expect(src("src/components/firstRun/FirstRunHost.tsx")).toContain("userId={userId}");
    saveFirstRunPicks("u1", ["sell", "earn"]);
    expect(readFirstRunPicks("u1")).toEqual(["earn", "sell"]);
  });
});

describe("2. Get started guide (owner 11-14)", () => {
  it("is worded from the picks, the picked steps first, photo and alerts after", () => {
    expect(guideSteps(["hire"], true)).toEqual(["post", "photo"]);
    expect(guideSteps(["earn"], true)).toEqual(["apply", "photo", "alerts"]);
    expect(guideSteps(["sell", "deal"], true)).toEqual(["list", "save", "photo"]);
    expect(guideSteps([], true)).toEqual(["apply", "list", "post", "photo", "alerts"]);
    expect(guideSteps(["sell"], false)).toEqual(["apply", "post", "photo"]);
  });

  it("ticks steps from real rows, each row goes straight there, Hide puts it away, all done hides it", async () => {
    db.counts = { applications: 1, jobs: 0, declutter_items: 0, declutter_watchlist: 0 };
    render(wrap(<GetStartedGuide userId="u1" fresh declutterOpen hasPhoto={false} alertsOff={false} />));
    const card = await screen.findByTestId("get-started");
    expect(card.textContent).toContain("Get started");
    expect(card.textContent).toContain("2 of 5"); // applied + alerts on
    expect(card.querySelector('[data-checklist-step="apply"]')?.hasAttribute("data-done")).toBe(true);
    expect(card.querySelector('[data-checklist-step="list"]')?.hasAttribute("data-done")).toBe(false);
    // Reads only the member's own rows, a listed item never a draft.
    expect(db.calls).toContainEqual({ table: "applications", op: "eq", args: ["helper_id", "u1"] });
    expect(db.calls).toContainEqual({ table: "declutter_items", op: "neq", args: ["status", "draft"] });
    fireEvent.click(card.querySelector('[data-checklist-step="list"]')!);
    expect(screen.getByTestId("where").textContent).toMatch(/^\/declutter\/sell/);
    fireEvent.click(screen.getByText("Hide"));
    expect(screen.queryByTestId("get-started")).toBeNull();
    expect(JSON.parse(localStorage.getItem(getStartedKey("u1"))!).dismissed).toBe(true);
    cleanup();
    // Hidden stays hidden, even on the new-member block.
    render(wrap(<GetStartedGuide userId="u1" fresh declutterOpen hasPhoto={false} alertsOff={false} />));
    // Settle past the reads (a waitFor on absence passes on the first paint and proves nothing).
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("get-started")).toBeNull();
  });

  it("goes when every step is done, and never shows for a member who never had the new-member block", async () => {
    db.counts = { applications: 1, jobs: 1, declutter_items: 1, declutter_watchlist: 1 };
    const { container } = render(wrap(<GetStartedGuide userId="u2" fresh declutterOpen hasPhoto alertsOff={false} />));
    // Wait for the DATA (the last count read is made), then let it settle, then assert the absence.
    await waitFor(() => expect(db.calls.some((c) => c.table === "declutter_watchlist" && c.args[1] === "u2")).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-get-started-loading]")).toBeNull();
    expect(screen.queryByTestId("get-started")).toBeNull();
    cleanup();
    db.counts = {};
    render(wrap(<GetStartedGuide userId="u3" fresh={false} declutterOpen hasPhoto={false} alertsOff={false} />));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("get-started")).toBeNull();
  });
});

describe("1. a new member's Home leads with real things near them (owner 11-14)", () => {
  it("For sale near you: real live listings, never the member's own; nothing near draws nothing", async () => {
    db.rows = {
      declutter_items: [
        { id: "i1", seller_id: "s1", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4, delivery_size: "small", price_cents: 4000, current_price_cents: 4000, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15, live_at: "2026-11-13" },
        { id: "i3", seller_id: "s-blocked", status: "live", title: "From someone blocked", category: "furniture", condition_stars: 4, delivery_size: "small", price_cents: 2000, current_price_cents: 2000, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15, live_at: "2026-11-13" },
        { id: "i2", seller_id: "s2", status: "live", title: "Photo not known yet", category: "furniture", condition_stars: 4, delivery_size: "small", price_cents: 1000, current_price_cents: 1000, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15, live_at: "2026-11-12" },
      ],
      // Every listing has a photo (posting requires one); the strip shows only listings whose photo is known.
      declutter_item_photos: [{ item_id: "i1", storage_path: "s1/i1/a.jpg", position: 0 }, { item_id: "i3", storage_path: "sb/i3/a.jpg", position: 0 }],
      // Review finding 4: a block either side hides the seller's listings.
      user_blocks: [{ blocker_id: "s-blocked", blocked_id: "me" }],
    };
    render(wrap(<ForSaleNearYou userId="me" />));
    expect(await screen.findByText("For sale near you")).toBeTruthy();
    expect(screen.getByText("Oak rocking chair")).toBeTruthy();
    expect(document.querySelector('a[href="/declutter/item/i1"]')).not.toBeNull();
    expect(screen.getByText("$40")).toBeTruthy();
    expect(screen.queryByText("Photo not known yet")).toBeNull();
    expect(screen.queryByText("From someone blocked")).toBeNull();
    expect(document.querySelector('a[href="/declutter/item/i1"] img')?.getAttribute("src")).toContain("s1/i1/a.jpg");
    expect(db.calls).toContainEqual({ table: "declutter_items", op: "neq", args: ["seller_id", "me"] });
    expect(db.calls).toContainEqual({ table: "declutter_items", op: "eq", args: ["status", "live"] });
    cleanup();
    db.rows = {};
    const { container } = render(wrap(<ForSaleNearYou userId="me" />));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-home-for-sale]")).toBeNull();
  });

  it("NewMemberHome mounts the starting actions, the guide and the items strip (vacuity: rendered as a whole)", async () => {
    db.rows = {
      declutter_items: [
        { id: "i1", seller_id: "s1", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4, delivery_size: "small", price_cents: 4000, current_price_cents: 4000, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15, live_at: "2026-11-13" },
      ],
      declutter_item_photos: [{ item_id: "i1", storage_path: "s1/i1/a.jpg", position: 0 }],
    };
    render(wrap(<NewMemberHome userId="me" sell guide={<p data-testid="guide-slot">guide</p>} />));
    expect(screen.getByTestId("home-welcome")).toBeTruthy();
    expect(screen.getByTestId("guide-slot")).toBeTruthy();
    // The lazy strip arrives on its own.
    expect(await screen.findByText("Oak rocking chair")).toBeTruthy();
    cleanup();
    db.rows = {};
    // Not selling: no items strip, the actions still drawn.
    render(wrap(<NewMemberHome userId="me" sell={false} guide={null} />));
    expect(screen.getByTestId("home-welcome")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-home-for-sale]")).toBeNull();
  });

  it("Home swaps the new-member block in (actions, guide, jobs near, items for sale), the items strip loaded on its own", () => {
    const home = src("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("{welcome ? <NewMemberHome userId={user?.id} sell={sellOpen} guide={guide(true)} /> : (");
    expect(home).toContain("{!welcome && guide(false)}");
    expect(home).toContain("withGuide={welcome}");
    const nm = src("src/pages/home/homeDashboard/NewMemberHome.tsx");
    expect(nm).toContain('const ForSaleNearYou = lazy(() => import("./ForSaleNearYou"));');
    expect(nm).not.toMatch(/^import .*ForSaleNearYou/m);
    expect(nm).toMatch(/<WelcomeCard sell=\{sell\} \/>\s*\{guide\}\s*<JobsNearYouList/);
  });
});

describe("Home's quiet day: Near you under Coming up (owner 11-17, item 4)", () => {
  it("NearYouBlock: up to 3 open jobs and up to 4 items for sale, from the existing reads", async () => {
    db.rows = {
      "rpc:get_ranked_open_jobs": [1, 2, 3, 4, 5].map((n) => ({ id: `j${n}`, title: `Job number ${n}`, budget: 50, pricing_mode: "set_price", location: "Lafayette, LA", helpers_needed: 1 })),
      declutter_items: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `i${n}`, seller_id: "s1", status: "live", title: `Item number ${n}`, category: "furniture", condition_stars: 4, delivery_size: "small", price_cents: 1000, current_price_cents: 1000, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15, live_at: `2026-11-1${n}` })),
      declutter_item_photos: [1, 2, 3, 4, 5, 6].map((n) => ({ item_id: `i${n}`, storage_path: `s1/i${n}/a.jpg`, position: 0 })),
    };
    const { container } = render(wrap(<NearYouBlock userId="me" sell />));
    expect(await screen.findByText("Job number 1")).toBeTruthy();
    expect((await screen.findAllByText(/Item number/)).length).toBeGreaterThan(0);
    const jobs = container.querySelectorAll("[data-home-jobs-near] button");
    expect(jobs.length).toBeGreaterThan(0);
    expect(screen.queryByText("Job number 4")).toBeNull();
    const items = container.querySelectorAll("[data-home-for-sale] li");
    expect(items.length).toBe(4);
  });

  it("Home draws it on every settled day (owner polish 11-20; was quiet days only), after the page settles, from the new-member chunk", () => {
    const home = src("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("const NearYouBlock = newMemberBlock((m) => m.NearYouBlock);");
    expect(home).toContain("{nearYouDay && pageSettled && <NearYouBlock userId={user?.id} sell={sellOpen} />}");
    // Not for a new member (their own blocks list what is near them), once that read has answered.
    expect(home).toContain("const nearYouDay = !welcome && firstJob !== null && !firstJob.isNew;");
    expect(home).not.toMatch(/^import .*NewMemberHome/m);
  });
});
