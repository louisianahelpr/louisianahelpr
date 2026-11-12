/**
 * THE PHONE NAV (owner nav redesign 2026-11-06, revised by the owner's UI audit 2026-11-09: F146, F147, F148).
 *
 * - The phone bottom bar is Home (the /home Dashboard), Jobs, Declutter, Messages (its unread badge), You: five tabs, no center "+"
 *   (F146; Shops and Homes left it until they open). Each tab shows its NAME under its icon, bold olive on the
 *   current section (F147).
 * - The top bar is one pattern (F148): the page title on the left (the logo on Dashboard), the bell and You on the
 *   right; a section's search is its own row under the bar. Creating is the floating pill (SectionCreateFab): on
 *   Dashboard it opens the Create sheet ("What are we doing?"), on a section it is that section's own create (Jobs:
 *   Post a job, under the under-18 gate; Declutter: Sell an item; Shops / Homes: their add).
 * - The Create sheet (mock-up 20): ONE ROW PER SECTION in Customize order, each with ONE main button (owner 10-31,
 *   LEAD-CREATE-SHEET-TRIM), except Declutter's, which also offers Give away free and Post a Wanted (owner UI audit
 *   11-09, F135). "Open a shop" becomes "Add a product or service" once the member has a shop. A section
 *   closed to the viewer is a greyed "Coming soon" row with no actions; it never routes into a closed section.
 * - A section's phone top bar shows the section's own title (the Explore chips row left with Explore: the bottom bar
 *   switches sections). Explore (/explore, still a route for old links) opens the section last in, else the first
 *   open shown one.
 * - "What are we doing?" is a MOMENT title via `.font-moment` (Montserrat like every page title since 2026-10-25), which
 *   outranks T1's upright-Montserrat `.font-display` rule.
 *
 * The dock, the top bar and the sheet are RENDERED (network hooks stubbed); each @mutate line breaks one sentence and
 * this file must go red.
 *
 * @mutate src/components/mobileNav/dockItems.ts |     { path: messages.path, icon: messages.icon, label: messages.label, badgeKey: "messages" },\n | \n
 * @mutate src/components/mobileNav/dockItems.ts |     { path: youItem.path, icon: youItem.icon, label: youItem.label },\n | \n
 * @mutate src/components/mobileNav/dockItems.ts | export const DOCK_LISTS_CLOSED_SECTIONS_IN_APP = true; | export const DOCK_LISTS_CLOSED_SECTIONS_IN_APP = false;
 * @mutate src/components/MobileNav.tsx | <span data-dock-label className={`relative z-10 text-ds-10 leading-none whitespace-nowrap ${isActive ? "font-bold" : "font-medium"}`}>{shown}</span> | <span data-dock-label className="relative z-10 text-ds-10 leading-none whitespace-nowrap font-medium">{shown}</span>
 * @mutate src/components/sections/AppTopBar.tsx |         {search && <div data-testid="app-top-bar-search" className={`${SEARCH_BAR_PAD} min-w-0`}>{search}</div>} |
 * @mutate src/components/sections/SectionCreateFab.tsx |   const go = () => { hapticMedium(); if (add) navigate(add.path); else setCreateSheetOpen((o) => !o); }; |   const go = () => { hapticMedium(); navigate(add?.path ?? "/post-job"); };
 * @mutate src/components/sections/SectionCreateFab.tsx |       onClick={isPost ? gate.gate("post", go) : go} |       onClick={go}
 * @mutate src/components/sections/SectionCreateFab.tsx |       {...(add ? {} : { "aria-haspopup": "dialog" as const, "aria-expanded": sheetOpen })} |       {...(add ? {} : { "aria-haspopup": "dialog" as const })}
 * @mutate src/components/create/CreateSheet.tsx |                 {on && ( |                 {true && (
 * @mutate src/components/create/CreateSheet.tsx |                         onClick={a.gated ? gate.gate("post", () => go(a.path)) : () => go(a.path)} |                         onClick={() => go(a.path)}
 * @mutate src/components/create/CreateSheet.tsx |       { label: "Post a Wanted", path: WANTED_POST_PATH },\n    ], |       { label: "Post a Wanted", path: WANTED_POST_PATH },\n      { label: "Moving out sale", path: "/declutter/sell?mode=move" },\n    ],
 * @mutate src/components/create/CreateSheet.tsx | label: hasShop ? "Add a product or service" : "Open a shop" | label: "Open a shop"
 * @mutate src/components/create/CreateSheet.tsx |   return { isOn, isPreview, actions }; |   return { isOn, isPreview, actions: { ...actions, jobs: [...actions.jobs, { label: "or describe it", path: "/post-job?start=ai" }] } };
 * @mutate src/pages/post-job/usePostJobForm.ts |     searchParams.get("start") === "ai" ? "ai" : null, |     null,
 * @mutate src/pages/explore/Explore.tsx |   const target = open.find((s) => s.key === last) ?? open[0] ?? sectionByKey("jobs"); |   const target = sectionByKey("jobs");
 * @mutate src/components/sections/ExploreSwitcher.tsx |   useEffect(() => writeLastSection(user?.id, current), [user?.id, current]); |
 * Q104 (loading-states-refresh 42123572431, shops_my_shop_id x92): the closed phone sheet never reads the member's shop.
 * @mutate src/components/create/CreateSheet.tsx | enabled: shopsOn && open }); | enabled: shopsOn });
 * @mutate src/components/create/CreateSheet.tsx | <SheetHero moment title="What are we doing?" /> | <SheetHero title="What are we doing?" />
 * @mutate src/index.css | .font-moment.font-moment.font-moment { | .font-moment {
 * @mutate src/components/sections/AppTopBar.tsx |   const title = sectionTitle; |   const title = explore ? "Explore" : sectionTitle;
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const switches = vi.hoisted(() => ({ on: new Set<string>() }));
// Backstop: any read no module mock above covers answers "nothing" and never reaches prod (B84's /home cut; see the helper).
vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule());
const toasts = vi.hoisted(() => [] as string[]);
const age = vi.hoisted(() => ({ under: false, explained: [] as string[] }));
// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
// F134 sets an answer (Shops and Homes open to testers only) to check the Create sheet's greyed preview buttons.
const openAll = vi.hoisted(() => ({ set: null as ReadonlySet<string> | null }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => openAll.set }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => switches.on.has(key),
  useFeatureStatus: (key: string) => ({ on: switches.on.has(key), settled: true }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => { toasts.push(m); }, { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }),
}));
const who = vi.hoisted(() => ({ guest: false }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => who.guest
    ? ({ user: null, profile: null, isLoading: false, isAdmin: false })
    : ({ user: { id: "u-create", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 0, markAllRead: () => {} }) }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 0, jobs: 0, shops: 0 }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", async () => { const m = await import("@/components/mobileNav/dockSheets"); return { useDockSheetsLoader: () => m }; }); // sheets at once: their lazy load is dockSheetsLoadOnTap.test.tsx
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/components/mobileNav/useDockMotion", async (orig) => ({ ...(await orig<object>()), useDockMotionLoader: () => null }));
vi.mock("@/components/mobileNav/useRecentConversationsPreview", () => ({ useRecentConversationsPreview: () => ({ data: [] }) }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => true }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({
    underAge: age.under,
    explain: () => {},
    gate: (k: string, f: () => void) => (age.under ? () => { age.explained.push(k); } : f),
    gatedProps: (k: string) => (age.under ? { "aria-disabled": true, "data-age-gated": k } : {}),
  }),
}));

import MobileNav from "@/components/MobileNav";
import Explore from "@/pages/explore/Explore";
import { ExploreSwitcher } from "@/components/sections/ExploreSwitcher";
import { AppTopBar } from "@/components/sections/AppTopBar";
import { SectionCreateFab } from "@/components/sections/SectionCreateFab";
import type { SectionKey } from "@/components/sections/sectionsConfig";
import { setCreateSheetOpen } from "@/components/mobileNav/createSheetStore";
const shop = vi.hoisted(() => ({ id: null as string | null, asked: 0 }));
vi.mock("@/lib/shops/api", () => ({ fetchMyShopId: async () => { shop.asked++; return shop.id; } }));

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
/** The phone screen's chrome: the top bar (Dashboard's: no title, the logo) above, the dock below, and the page's
 *  floating create pill (Dashboard's opens the Create sheet; a section's is its own create). */
function renderDock(at = "/home", title?: string, section?: SectionKey) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <AppTopBar title={title} />
        <SectionCreateFab section={section} />
        <MobileNav />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const DOCK = 'nav[aria-label="Bottom navigation"]';
const dockLabels = () => [...document.querySelectorAll(`${DOCK} button[aria-label]`)].map((b) => b.getAttribute("aria-label"));
const dockTab = (name: string) => document.querySelector(`${DOCK} button[aria-label="${name}"]`) as HTMLElement;
const createButton = () => screen.getByTestId("section-create-fab");
const openSheet = () => fireEvent.click(createButton());
const row = (key: string) => document.querySelector(`[data-create-row="${key}"]`) as HTMLElement;
const actionLabels = (key: string) => [...row(key).querySelectorAll("[data-create-action]")].map((b) => b.textContent);
const action = (key: string, i = 0) => document.querySelector(`[data-create-action="${key}:${i}"]`) as HTMLElement;
const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  setCreateSheetOpen(false); // a module store: one test's open sheet never leaks into the next
  switches.on = new Set(["declutter", "shops", "rentals"]);
  toasts.length = 0;
  age.under = false;
  age.explained.length = 0;
  shop.id = null;
  shop.asked = 0;
});
afterEach(cleanup);

describe("the phone bottom bar (F146, owner audit 2026-11-09)", () => {
  it("is Home, Jobs, Declutter, Messages, You: five tabs, no center +, no Shops or Homes", () => {
    renderDock();
    expect(dockLabels()).toEqual(["Home", "Jobs", "Declutter", "Messages", "You"]);
    expect(document.querySelector('[data-testid="dock-create"]')).toBeNull();
  });

  it("F147: each tab paints its icon and its name under it; the current tab's name is bold", () => {
    renderDock("/messages");
    const tabs = [...document.querySelectorAll(`${DOCK} button[aria-label]`)];
    expect(tabs.length).toBe(5); // vacuity floor
    for (const t of tabs) {
      const name = t.getAttribute("aria-label") ?? "";
      expect(t.querySelector("svg"), name).toBeTruthy();
      const label = t.querySelector("[data-dock-label]");
      expect(label?.textContent, name).toBe(name);
      expect(label?.className.split(/\s+/), name).toContain(t.getAttribute("aria-current") === "page" ? "font-bold" : "font-medium");
    }
    expect(dockTab("Messages").getAttribute("aria-current")).toBe("page");
  });

  it("Shops and Homes are off the dock even when open to the viewer", () => {
    renderDock();
    const text = document.querySelector(DOCK)?.textContent ?? "";
    expect(text).not.toMatch(/Shops|Homes/);
    expect(text).not.toMatch(/soon/i);
  });

  it.each([
    ["Jobs", "/jobs"],
    ["Declutter", "/declutter"],
    ["Messages", "/messages"],
    ["You", "/profile"],
  ])("%s navigates to %s and is lit there", (name, path) => {
    renderDock();
    fireEvent.click(dockTab(name));
    expect(where()).toBe(path);
    cleanup();
    renderDock(path);
    expect(dockTab(name).getAttribute("aria-current")).toBe("page");
    expect(dockTab("Home").getAttribute("aria-current")).toBeNull();
  });
});

describe("the phone top bar (F148, owner audit 2026-11-09)", () => {
  const order = () =>
    [...screen.getByTestId("app-top-bar").querySelectorAll("button")].map((b) => b.getAttribute("data-testid") ?? b.getAttribute("aria-label"));

  it("right side is the bell, then You; no Messages, + or Help on the bar", () => {
    renderDock();
    expect(order()).toEqual(["Notifications", "top-bar-profile"]);
    expect(screen.getByTestId("app-top-bar").querySelector('[aria-label="Help"]')).toBeNull();
  });

  it("You opens the profile", () => {
    renderDock();
    fireEvent.click(screen.getByTestId("top-bar-profile"));
    expect(where()).toBe("/profile");
  });

  it("a section's search is its own row under the bar, not the bar itself; the title stays visible", () => {
    renderAt(<AppTopBar title="Jobs" search={<input aria-label="Search jobs" />} />, "/jobs");
    const bar = screen.getByTestId("app-top-bar");
    expect(bar.querySelector("h1")?.textContent).toBe("Jobs");
    expect(bar.querySelector("h1")?.className.split(/\s+/)).not.toContain("sr-only");
    expect(bar.querySelector('input[aria-label="Search jobs"]')).toBeNull();
    expect(screen.getByTestId("app-top-bar-search").querySelector('input[aria-label="Search jobs"]')).toBeTruthy();
  });

  it("on Dashboard the + opens 'What are we doing?' and does not navigate", () => {
    renderDock();
    expect(screen.queryByTestId("create-sheet")).toBeNull();
    expect(createButton().getAttribute("aria-expanded")).toBe("false");
    openSheet();
    expect(screen.getByTestId("create-sheet")).toBeTruthy();
    expect(screen.getByText("What are we doing?")).toBeTruthy();
    expect(createButton().getAttribute("aria-expanded")).toBe("true");
    expect(where()).toBe("/home");
  });

  it.each([
    ["/jobs", "Jobs", "Post a job", "/post-job"],
    ["/declutter", "Declutter", "Sell an item", "/declutter/sell?mode=choose"],
    ["/shops", "Shops", "Add an item or open a shop", "/shops/mine"],
    ["/rentals", "Homes", "Add a property", "/rentals?tab=own&add=1"],
  ])("on %s the + is the section's own create (%s: %s)", (at, title, label, path) => {
    renderDock(at, title, ({ "/jobs": "jobs", "/declutter": "declutter", "/shops": "shops", "/rentals": "homes" } as const)[at]);
    expect(createButton().getAttribute("aria-label")).toBe(label);
    openSheet();
    expect(where()).toBe(path);
    expect(screen.queryByTestId("create-sheet")).toBeNull();
  });

  it("on Jobs the + keeps the under-18 gate", () => {
    age.under = true;
    renderDock("/jobs", "Jobs", "jobs");
    expect(createButton().getAttribute("data-age-gated")).toBe("post");
    openSheet();
    expect(where()).toBe("/jobs");
    expect(age.explained).toEqual(["post"]);
  });
});

describe("the create sheet (mock-up 20: one row per section)", () => {
  it("Q104: the closed sheet never asks for the member's shop; opening it asks once", async () => {
    renderDock();
    await new Promise((r) => setTimeout(r, 30));
    expect(shop.asked).toBe(0);
    openSheet();
    expect(await screen.findByText("Open a shop")).toBeTruthy();
    expect(shop.asked).toBe(1);
  });

  it("lists one row per shown section in Customize order, each with its real actions", async () => {
    switches.on = new Set(["declutter", "shops", "rentals", "declutter_moving_out"]);
    renderDock();
    openSheet();
    expect([...document.querySelectorAll("[data-create-row]")].map((e) => e.getAttribute("data-create-row"))).toEqual(["jobs", "declutter", "shops", "homes"]);
    expect(actionLabels("jobs")).toEqual(["Post a job"]);
    // Owner 10-31 (LEAD-CREATE-SHEET-TRIM): ONE button per row, even with the moving-out switch on; EXCEPT Declutter,
    // which carries Give away free and Post a Wanted too (owner UI audit 11-09, F135, approved via the lead 11-09).
    expect(actionLabels("declutter")).toEqual(["Sell an item", "Give away free", "Post a Wanted"]);
    expect(actionLabels("homes")).toEqual(["List for rent"]);
    expect(await screen.findByText("Open a shop")).toBeTruthy();
    expect(actionLabels("shops")).toEqual(["Open a shop"]);
    const sheet = screen.getByTestId("create-sheet").textContent ?? "";
    for (const gone of ["Moving out sale", "No shop yet", "or describe it"]) expect(sheet).not.toContain(gone);
    expect(screen.queryByTestId("create-describe")).toBeNull();
  });

  it("a member with a shop gets 'Add a product or service'", async () => {
    shop.id = "shop-1";
    renderDock();
    openSheet();
    expect(await screen.findByText("Add a product or service")).toBeTruthy();
    expect(screen.queryByText("No shop yet")).toBeNull();
  });

  // F135: Declutter's two outline buttons open the free Sell flow and the Wanted form.
  // @mutate src/components/create/CreateSheet.tsx |       { label: "Give away free", path: SELL_FREE_PATH }, |       { label: "Give away free", path: SELL_CHOOSER_PATH },
  it.each([
    [1, "/declutter/sell?free=1"],
    [2, "/declutter?tab=wanted&post=1"],
  ])("Declutter's button %i goes to %s (F135)", (i, path) => {
    renderDock();
    openSheet();
    const btn = action("declutter", i);
    expect(btn.className).toContain("whitespace-nowrap");
    expect(btn.className).not.toContain("btn-grad-primary");
    fireEvent.click(btn);
    expect(where()).toBe(path);
  });

  it.each([
    ["jobs", "/post-job"],
    ["declutter", "/declutter/sell?mode=choose"],
    ["shops", "/shops/mine"],
    ["homes", "/rentals?tab=own&add=1"],
  ])("the %s main action goes to %s", (key, path) => {
    renderDock();
    openSheet();
    fireEvent.click(action(key));
    expect(where()).toBe(path);
    expect(toasts).toEqual([]);
  });

  it("a section switched OFF for the viewer is a greyed 'Coming soon' row with no actions", () => {
    switches.on = new Set(["shops"]);
    renderDock();
    openSheet();
    for (const key of ["declutter", "homes"]) {
      expect(row(key).getAttribute("aria-disabled")).toBe("true");
      expect(row(key).textContent).toContain("Coming soon");
      expect(row(key).querySelectorAll("[data-create-action]").length).toBe(0);
    }
    fireEvent.click(document.querySelector('[data-create-soon="homes"]') as HTMLElement);
    expect(where()).toBe("/home");
    expect(toasts).toEqual(["Homes is coming soon"]);
    fireEvent.click(action("shops"));
    expect(where()).toBe("/shops/mine");
  });

  // F134 (owner UI audit 11-09): "Open a shop" and "List for rent" were solid olive under a "Coming soon" mark.
  // @mutate src/components/create/CreateSheet.tsx |             const soon = on && isPreview(s); |             const soon = false;
  it("a section open to testers only keeps its 'Coming soon' mark and its buttons are grey and disabled (F134)", () => {
    openAll.set = new Set(["declutter"]);
    try {
      renderDock();
      openSheet();
      for (const key of ["shops", "homes"]) {
        expect(row(key).textContent).toContain("Coming soon");
        const btn = action(key);
        expect(btn.getAttribute("aria-disabled")).toBe("true");
        expect(btn.className).not.toContain("btn-grad-primary");
        expect(btn.className).toContain("text-muted-foreground");
      }
      fireEvent.click(action("shops"));
      expect(where()).toBe("/home");
      expect(toasts).toEqual(["Shops is coming soon"]);
      // Jobs and Declutter (open to everyone) stay live.
      expect(action("jobs").className).toContain("btn-grad-primary");
      expect(action("declutter").getAttribute("aria-disabled")).toBeNull();
    } finally {
      openAll.set = null;
    }
  });

  it("Customize: a hidden section has no row", () => {
    localStorage.setItem("helpr_section_prefs:u-create", JSON.stringify({ hidden: ["shops"] }));
    renderDock();
    openSheet();
    expect([...document.querySelectorAll("[data-create-row]")].map((e) => e.getAttribute("data-create-row"))).toEqual(["jobs", "declutter", "homes"]);
    localStorage.clear();
  });

  it("Post a job keeps the under-18 gate", () => {
    age.under = true;
    renderDock();
    openSheet();
    expect(action("jobs").getAttribute("data-age-gated")).toBe("post");
    fireEvent.click(action("jobs"));
    expect(where()).toBe("/home");
    expect(age.explained).toEqual(["post"]);
  });

  it("the AI builder stays reachable from Post a job's own entry screen (start=ai)", () => {
    expect(code("src/pages/post-job/usePostJobForm.ts")).toContain('searchParams.get("start") === "ai" ? "ai" : null');
  });
});

function renderAt(ui: React.ReactNode, at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/explore" element={ui} />
          <Route path="*" element={<><Where />{ui}</>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Explore", () => {
  beforeEach(() => localStorage.clear());

  it("opens on the first shown section that is open to the member", () => {
    switches.on = new Set();
    localStorage.setItem("helpr_section_prefs:u-create", JSON.stringify({ order: ["declutter", "jobs", "shops", "homes"] }));
    renderAt(<Explore />, "/explore");
    expect(where()).toBe("/jobs");
  });

  it("reopens on the section the member was last in (the switcher remembers it)", () => {
    renderAt(<ExploreSwitcher current="shops" />, "/shops");
    cleanup();
    renderAt(<Explore />, "/explore");
    expect(where()).toBe("/shops");
  });

  it("a remembered section that has since closed is skipped", () => {
    renderAt(<ExploreSwitcher current="shops" />, "/shops");
    cleanup();
    switches.on = new Set(["declutter"]);
    renderAt(<Explore />, "/explore");
    expect(where()).toBe("/jobs");
  });

  it("each section screen hands its bar the section, and the phone bar draws its title (or the section's search beside a hidden h1, the Vinted header, owner 11-08), not the chips", () => {
    const screens = ["src/components/declutter/DeclutterHomeView.tsx", "src/components/shops/ShopsHomeView.tsx", "src/components/rentals/RentalsHomeView.tsx"];
    expect(screens.length).toBe(3); // vacuity floor (#2894)
    for (const f of screens) expect(code(f), f).toMatch(/<SectionScreen section="(declutter|shops|homes)"/);
    expect(code("src/pages/jobs/JobsSection.tsx")).toMatch(/<AppTopBar [^>]*\bexplore section="jobs"/);
    expect(code("src/components/sections/SectionScreen.tsx")).toContain("<AppTopBar title={title} explore section={section} search={barSearch} mine={mine} showAdd={showAdd} add={add} />");
    expect(code("src/components/sections/AppTopBar.tsx")).not.toMatch(/PhoneMessagesButton|PhoneCreateButton/);
    expect(code("src/components/sections/AppTopBar.tsx")).not.toContain("<ExploreSwitcher");
  });
});

describe("moment titles match page titles (owner 2026-10-25: one consistent font)", () => {
  it("the sheet title wears .font-moment, and .font-moment is the page title's face", () => {
    renderDock();
    openSheet();
    const title = screen.getByText("What are we doing?");
    expect(title.className).toMatch(/\bfont-moment\b/);
    const css = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
    const m = css.match(/\.font-moment\.font-moment\.font-moment \{([^}]*)\}/);
    // Same family, weight and tracking as .text-page-title: a greeting and the
    // "Jobs" title can never disagree again.
    const pageTitle = css.match(/\n\.text-page-title \{([^}]*)\}/)?.[1] ?? "";
    const decl = (block: string, prop: string) => block.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1].trim();
    for (const prop of ["font-family", "font-style", "font-weight", "letter-spacing"]) {
      expect(decl(m?.[1] ?? "", prop), prop).toBeDefined();
      expect(decl(m?.[1] ?? "", prop), prop).toBe(decl(pageTitle, prop));
    }
    expect(m?.[1]).not.toMatch(/Bodoni/);
    // J1 (Post a job step headers) adds `.font-moment` to the :not() list, so a moment title never meets T1's rule at all.
    expect(css).toMatch(/\.font-display:not\(\.landing-h1, \.landing-h1 \*(?:, \.font-moment)?\) \{/);
  });
});

describe("a section's phone top bar (F148)", () => {
  it("shows the section's own title (no Explore, no chips), then the bell and You; no Messages, + or gear", () => {
    renderAt(<AppTopBar title="Declutter" explore section="declutter" />, "/declutter");
    const bar = screen.getByTestId("app-top-bar");
    const h1 = bar.querySelector("h1");
    expect(h1?.textContent).toBe("Declutter");
    expect(h1?.className.split(/\s+/)).not.toContain("sr-only");
    expect(bar.querySelector('[data-testid="explore-switcher"]')).toBeNull();
    expect(bar.querySelector('[data-testid="section-add"]')).toBeNull();
    expect(bar.querySelector('[data-testid="section-settings"]')).toBeNull();
    expect(bar.querySelector('[data-testid="top-bar-bell"]')).toBeTruthy();
    expect(bar.querySelector('[data-testid="top-bar-messages"]')).toBeNull();
    expect(bar.querySelector('[data-testid="top-bar-create"]')).toBeNull();
    expect(bar.querySelector('[data-testid="top-bar-profile"]')).toBeTruthy();
  });

  // AUD31-74 (Guests on Declutter): a guest on Declutter Browse tapped the bell and got a panel stuck on "Loading
  // notifications..." asking to turn on push. A guest has no notifications: no bell, as no photo (nor Messages or +).
  // @mutate src/components/sections/AppTopBar.tsx |       {user && !isWebDesktop && (\n      <span data-testid="top-bar-bell"> |       {!isWebDesktop && (\n      <span data-testid="top-bar-bell">
  // @mutate src/components/sections/AppTopBar.tsx |       {user && !isWebDesktop && showProfile && ( |       {!isWebDesktop && showProfile && user && (
  it("a guest on Declutter gets no bell, Messages, + or photo; the title stays", () => {
    who.guest = true;
    try {
      renderAt(<AppTopBar title="Declutter" explore section="declutter" />, "/declutter");
      const bar = screen.getByTestId("app-top-bar");
      expect(bar.querySelector("h1")?.textContent).toBe("Declutter");
      for (const id of ["top-bar-bell", "top-bar-messages", "top-bar-create", "top-bar-profile"]) expect(bar.querySelector(`[data-testid="${id}"]`), id).toBeNull();
    } finally {
      who.guest = false;
    }
  });
});
