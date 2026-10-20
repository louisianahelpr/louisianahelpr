/**
 * THE CENTER "+" BOTTOM BAR (owner-approved mock-up, 2026-10-20: "just do
 * what cowork suggested", with the lead's binding fixes in
 * ~/.lh-wt/audit-1020/MOCKUPS-APPROVED.md §1).
 *
 * - The phone bar is Home, Explore, the center "+", Messages, You. You is
 *   Profile (the member's photo); Explore holds the four sections.
 * - "+" opens "What are we doing?": Post a job, Sell an item, Open a shop,
 *   List a home, each going where that section's own "+" goes. A section whose
 *   switch is off for the viewer shows "Coming soon" on its tile and a tap
 *   never routes into it.
 * - Tile copy is true today: Sell an item is "Photos, price, done" (no
 *   auto-fill claim), List a home makes no "verified neighbors" claim.
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
 * @mutate src/components/create/CreateSheet.tsx |             const onClick = !on\n              ? () => sayComingSoon(s.label) |             const onClick = false\n              ? () => sayComingSoon(s.label)
 * @mutate src/components/create/CreateSheet.tsx |                 ? gate.gate("post", () => go(createPath(s))) |                 ? () => go(createPath(s))
 * @mutate src/components/create/CreateSheet.tsx | export const DESCRIBE_IT_PATH = "/post-job?start=ai"; | export const DESCRIBE_IT_PATH = "/post-job";
 * @mutate src/pages/post-job/EntryChoice.tsx |     searchParams.get("start") === "ai" ? "ai" : null, |     null,
 * @mutate src/components/sections/sectionsConfig.ts | create: { title: "Sell an item", blurb: "Photos, price, done" } | create: { title: "Sell an item", blurb: "Snap one photo, we fill the rest" }
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
vi.mock("@/hooks/useActivityBadgeCounts", () => ({ useActivityBadgeCounts: () => ({ postsCount: 0, jobsCount: 0 }) }));
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
import { SECTIONS } from "@/components/sections/sectionsConfig";

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
const tile = (key: string) => document.querySelector(`[data-create-tile="${key}"]`) as HTMLElement;
const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  switches.on = new Set(["declutter", "shops", "rentals"]);
  toasts.length = 0;
  age.under = false;
  age.explained.length = 0;
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

describe("the create sheet", () => {
  it("has the four tiles in order: Post a job, Sell an item, Open a shop, List a home", () => {
    renderDock();
    openSheet();
    expect([...document.querySelectorAll("[data-create-tile]")].map((e) => e.getAttribute("aria-label"))).toEqual([
      "Post a job",
      "Sell an item",
      "Open a shop",
      "List a home",
    ]);
  });

  it.each(SECTIONS.map((s) => [s.key, s.add.path] as const))("a live %s tile goes where that section's own + goes (%s)", (key, path) => {
    renderDock();
    openSheet();
    fireEvent.click(tile(key));
    expect(where()).toBe(path);
    expect(toasts).toEqual([]);
  });

  it("a section switched OFF for the viewer says Coming soon and never routes into it", () => {
    switches.on = new Set(["shops"]);
    renderDock();
    openSheet();
    for (const [key, name] of [["declutter", "Sell an item"], ["homes", "List a home"]] as const) {
      const t = tile(key);
      expect(t.getAttribute("aria-label")).toBe(`${name}, coming soon`);
      expect(t.getAttribute("aria-disabled")).toBe("true");
      expect(t.textContent).toContain("Coming soon");
      fireEvent.click(t);
      expect(where()).toBe("/home");
    }
    expect(toasts).toEqual(["Declutter is coming soon", "Homes is coming soon"]);
    // A live one still goes.
    fireEvent.click(tile("shops"));
    expect(where()).toBe("/shops/mine");
  });

  it("Post a job keeps the under-18 gate (and so does 'describe it')", () => {
    age.under = true;
    renderDock();
    openSheet();
    expect(tile("jobs").getAttribute("data-age-gated")).toBe("post");
    fireEvent.click(tile("jobs"));
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

  it("tile copy is true today: no auto-fill claim, no 'verified neighbors' claim", () => {
    const copy = SECTIONS.map((s) => `${s.create.title} ${s.create.blurb}`).join(" | ");
    expect(copy).not.toMatch(/we fill|snap one photo|verified/i);
    expect(SECTIONS.find((s) => s.key === "declutter")!.create.blurb).toBe("Photos, price, done");
    expect(SECTIONS.length).toBeGreaterThan(3);
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
    expect(css).toMatch(/\.font-display:not\(\.landing-h1, \.landing-h1 \*\) \{/);
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
