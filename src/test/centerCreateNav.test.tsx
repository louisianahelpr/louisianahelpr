/**
 * THE CENTER "+" BOTTOM BAR (owner-approved mock-up, 2026-10-20: "just do
 * what cowork suggested", with the lead's binding fixes in
 * ~/.lh-wt/audit-1020/MOCKUPS-APPROVED.md §1).
 *
 * - The phone bar is Home, Explore, the center "+", Messages, You. You is
 *   Profile (the member's photo); Explore holds the four sections.
 * - "+" opens "What are we doing?" (mock-up 20, superseding board 1's 2x2):
 *   ONE ROW PER SECTION in Customize order, a main action and a second one
 *   only where its path exists (Moving out sale only while that switch is on;
 *   "Open a shop" becomes "Add a product or service" once the member has a
 *   shop). A section closed to the viewer is a greyed "Opening soon" row with
 *   no actions; it never routes into a closed section.
 * - Post a job keeps the under-18 gate. "Or just describe it" opens the AI job
 *   builder (/post-job?start=ai, which EntryChoice opens on).
 *
 * - Explore (HELPR-DESIGN-SPEC §3): /explore opens the section the member was
 *   last in, else their first open shown section; every section screen carries
 *   the Jobs / Declutter / Shops / Homes switcher above its own tabs.
 * - On a phone a section's top bar reads "Explore" and has no "+" (mock-up 6;
 *   HELPR-DESIGN-SPEC §3 "no + in the top bar"): the center "+" creates.
 * - "What are we doing?" is a MOMENT title: Bodoni via `.font-moment`, which
 *   outranks T1's upright-Montserrat `.font-display` rule.
 *
 * The dock and the sheet are RENDERED (network hooks stubbed); each @mutate
 * line breaks one sentence and this file must go red.
 *
 * @mutate src/components/mobileNav/dockItems.ts |     left: [home, exploreItem], |     left: [home],
 * @mutate src/components/MobileNav.tsx |                    setCreateOpen((o) => !o); |                    navigate("/post-job");
 * @mutate src/components/create/CreateSheet.tsx |                 {on && ( |                 {true && (
 * @mutate src/components/create/CreateSheet.tsx |                         onClick={a.gated ? gate.gate("post", () => go(a.path)) : () => go(a.path)} |                         onClick={() => go(a.path)}
 * @mutate src/components/create/CreateSheet.tsx | ...(movingOut ? [{ label: "Moving out sale", path: "/declutter/move" }] : []) | { label: "Moving out sale", path: "/declutter/move" }
 * @mutate src/components/create/CreateSheet.tsx | label: hasShop ? "Add a product or service" : "Open a shop" | label: "Open a shop"
 * @mutate src/components/create/CreateSheet.tsx | const DESCRIBE_IT_PATH = "/post-job?start=ai"; | const DESCRIBE_IT_PATH = "/post-job";
 * @mutate src/pages/post-job/EntryChoice.tsx |     searchParams.get("start") === "ai" ? "ai" : null, |     null,
 * @mutate src/pages/explore/Explore.tsx |   const target = open.find((s) => s.key === last) ?? open[0] ?? sectionByKey("jobs"); |   const target = sectionByKey("jobs");
 * @mutate src/components/sections/ExploreSwitcher.tsx |   useEffect(() => writeLastSection(user?.id, current), [user?.id, current]); |
 * @mutate src/components/create/CreateSheet.tsx | <SheetHero moment title="What are we doing?" /> | <SheetHero title="What are we doing?" />
 * @mutate src/index.css | .font-moment.font-moment.font-moment { | .font-moment {
 * @mutate src/components/sections/AppTopBar.tsx |   const phoneExplore = explore && !isWebDesktop; |   const phoneExplore = false;
 * @mutate src/components/sections/SectionScreen.tsx |           {section && <ExploreSwitcher current={section} />} |
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const switches = vi.hoisted(() => ({ on: new Set<string>() }));
const toasts = vi.hoisted(() => [] as string[]);
const age = vi.hoisted(() => ({ under: false, explained: [] as string[] }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => switches.on.has(key),
  useFeatureStatus: (key: string) => ({ on: switches.on.has(key), settled: true }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => { toasts.push(m); }, { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-create", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 0, markAllRead: () => {} }) }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 0, jobs: 0, shops: 0 }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/components/mobileNav/useDockMotion", async (orig) => ({ ...(await orig<object>()), useDockMotionLoader: () => null }));
vi.mock("@/components/mobileNav/useRecentConversationsPreview", () => ({ useRecentConversationsPreview: () => ({ data: [] }) }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => true }));
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
const shop = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/lib/shops/api", () => ({ fetchMyShopId: async () => shop.id }));

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
function renderDock(at = "/home") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <MobileNav />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const dockLabels = () =>
  [...document.querySelectorAll('nav[aria-label="Bottom navigation"] button[aria-label]')].map((b) => b.getAttribute("aria-label"));
const openSheet = () => fireEvent.click(screen.getByTestId("dock-create"));
const row = (key: string) => document.querySelector(`[data-create-row="${key}"]`) as HTMLElement;
const actionLabels = (key: string) => [...row(key).querySelectorAll("[data-create-action]")].map((b) => b.textContent);
const action = (key: string, i = 0) => document.querySelector(`[data-create-action="${key}:${i}"]`) as HTMLElement;
const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  switches.on = new Set(["declutter", "shops", "rentals"]);
  toasts.length = 0;
  age.under = false;
  age.explained.length = 0;
  shop.id = null;
});
afterEach(cleanup);

describe("the phone bottom bar (2026-10-20)", () => {
  it("is Home, Explore, Create (+), Messages, You, with + in the middle", () => {
    renderDock();
    expect(dockLabels()).toEqual(["Home", "Explore", "Create", "Messages", "You"]);
  });

  it("You is Profile: it navigates to /profile and is lit there", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "You" }));
    expect(where()).toBe("/profile");
    cleanup();
    renderDock("/profile");
    expect(screen.getByRole("button", { name: "You" }).getAttribute("aria-current")).toBe("page");
  });

  it("Explore navigates to /explore", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    expect(where()).toBe("/explore");
  });

  it("the + opens 'What are we doing?' and does not navigate", () => {
    renderDock();
    expect(screen.queryByTestId("create-sheet")).toBeNull();
    openSheet();
    expect(screen.getByTestId("create-sheet")).toBeTruthy();
    expect(screen.getByText("What are we doing?")).toBeTruthy();
    expect(screen.getByTestId("dock-create").getAttribute("aria-expanded")).toBe("true");
    expect(where()).toBe("/home");
  });
});

describe("the create sheet (mock-up 20: one row per section)", () => {
  it("lists one row per shown section in Customize order, each with its real actions", async () => {
    switches.on = new Set(["declutter", "shops", "rentals", "declutter_moving_out"]);
    renderDock();
    openSheet();
    expect([...document.querySelectorAll("[data-create-row]")].map((e) => e.getAttribute("data-create-row"))).toEqual(["jobs", "declutter", "shops", "homes"]);
    expect(actionLabels("jobs")).toEqual(["Post a job"]);
    expect(actionLabels("declutter")).toEqual(["Sell an item", "Moving out sale"]);
    expect(actionLabels("homes")).toEqual(["List for rent"]);
    expect(await screen.findByText("No shop yet")).toBeTruthy();
    expect(actionLabels("shops")).toEqual(["Open a shop"]);
  });

  it("Moving out sale only while its switch is on", () => {
    renderDock();
    openSheet();
    expect(actionLabels("declutter")).toEqual(["Sell an item"]);
  });

  it("a member with a shop gets 'Add a product or service' and no 'No shop yet'", async () => {
    shop.id = "shop-1";
    renderDock();
    openSheet();
    expect(await screen.findByText("Add a product or service")).toBeTruthy();
    expect(screen.queryByText("No shop yet")).toBeNull();
  });

  it.each([
    ["jobs", "/post-job"],
    ["declutter", "/declutter/sell"],
    ["shops", "/shops/mine"],
    ["homes", "/rentals?tab=own&add=1"],
  ])("the %s main action goes to %s", (key, path) => {
    renderDock();
    openSheet();
    fireEvent.click(action(key));
    expect(where()).toBe(path);
    expect(toasts).toEqual([]);
  });

  it("a section switched OFF for the viewer is a greyed 'Opening soon' row with no actions", () => {
    switches.on = new Set(["shops"]);
    renderDock();
    openSheet();
    for (const key of ["declutter", "homes"]) {
      expect(row(key).getAttribute("aria-disabled")).toBe("true");
      expect(row(key).textContent).toContain("Opening soon");
      expect(row(key).querySelectorAll("[data-create-action]").length).toBe(0);
    }
    fireEvent.click(document.querySelector('[data-create-soon="homes"]') as HTMLElement);
    expect(where()).toBe("/home");
    expect(toasts).toEqual(["Homes is coming soon"]);
    fireEvent.click(action("shops"));
    expect(where()).toBe("/shops/mine");
  });

  it("Customize: a hidden section has no row", () => {
    localStorage.setItem("helpr_section_prefs:u-create", JSON.stringify({ hidden: ["shops"] }));
    renderDock();
    openSheet();
    expect([...document.querySelectorAll("[data-create-row]")].map((e) => e.getAttribute("data-create-row"))).toEqual(["jobs", "declutter", "homes"]);
    localStorage.clear();
  });

  it("Post a job keeps the under-18 gate (and so does 'describe it')", () => {
    age.under = true;
    renderDock();
    openSheet();
    expect(action("jobs").getAttribute("data-age-gated")).toBe("post");
    fireEvent.click(action("jobs"));
    fireEvent.click(screen.getByTestId("create-describe"));
    expect(where()).toBe("/home");
    expect(age.explained).toEqual(["post", "post"]);
  });

  it("'Or just describe it' opens the AI builder path, which the post-a-job entry screen opens on", () => {
    renderDock();
    openSheet();
    fireEvent.click(screen.getByTestId("create-describe"));
    expect(where()).toBe("/post-job?start=ai");
    expect(code("src/pages/post-job/EntryChoice.tsx")).toContain('searchParams.get("start") === "ai" ? "ai" : null');
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

  it("every section screen carries the switcher (SectionScreen for three, JobsSection for Jobs)", () => {
    const screens = ["src/components/declutter/DeclutterHomeView.tsx", "src/components/shops/ShopsHomeView.tsx", "src/components/rentals/RentalsHomeView.tsx"];
    expect(screens.length).toBe(3); // vacuity floor (#2894)
    for (const f of screens) expect(code(f), f).toMatch(/<SectionScreen section="(declutter|shops|homes)"/);
    expect(code("src/pages/jobs/JobsSection.tsx")).toContain('<ExploreSwitcher current="jobs" />');
    expect(code("src/components/sections/SectionScreen.tsx")).toContain("{section && <ExploreSwitcher current={section} />}");
  });
});

describe("Bodoni for moments", () => {
  it("the sheet title wears .font-moment, and .font-moment outranks T1's .font-display rule", () => {
    renderDock();
    openSheet();
    const title = screen.getByText("What are we doing?");
    expect(title.className).toMatch(/\bfont-moment\b/);
    const css = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
    const m = css.match(/\.font-moment\.font-moment\.font-moment \{([^}]*)\}/);
    expect(m?.[1]).toMatch(/"Bodoni Moda"[^;]*!important/);
    // J1 (Post a Job step headers) adds `.font-moment` to the :not() list, so a moment title never meets T1's rule at all.
    expect(css).toMatch(/\.font-display:not\(\.landing-h1, \.landing-h1 \*(?:, \.font-moment)?\) \{/);
  });
});

describe("a section's phone top bar (mock-up 6)", () => {
  it("reads Explore and carries no +; the bell and avatar stay", async () => {
    vi.doMock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
    const { AppTopBar } = await import("@/components/sections/AppTopBar");
    renderAt(<AppTopBar title="Declutter" add={{ label: "Sell an item", path: "/declutter/sell" }} explore />, "/declutter");
    const bar = screen.getByTestId("app-top-bar");
    expect(bar.querySelector("h1")?.textContent).toBe("Explore");
    expect(bar.querySelector('[data-testid="section-add"]')).toBeNull();
    expect(bar.querySelector('[data-testid="top-bar-profile"]')).toBeTruthy();
  });
});
