/**
 * NOTHING "COMING SOON" IN THE iPHONE APP (owner, 2026-10-31 ~9:15 PM, App Store submission pop-up):
 * in the native app HIDE closed sections (Shops, Homes) and the two disabled quote buttons (Get quotes on
 * Post a job; Request a quote in Sell it for me) until they open; the website keeps showing them. One
 * helper decides: src/lib/hideUnopenedInApp.ts.
 *
 * (a) the helper and the shared words (toast, "opening soon" line) with native mocked on and off;
 * (b) the real ExploreSwitcher and PriceModeChoice rendered both ways: native shows no "Soon"/"Coming soon"
 *     text, the website still does, and a section whose switch is on for everyone lists normally in the app;
 * (c) inventory: every non-test source file that draws a soon mark (SoonPill, PreviewPill, a "Coming soon"
 *     literal) reads the helper or the `listed` answer, so a new soon mark cannot reach the app unseen.
 *
 * @mutate src/lib/hideUnopenedInApp.ts |   return isNativePlatform; |   return false;
 * @mutate src/lib/hideUnopenedInApp.ts |   return tab.on && !tab.preview; |   return tab.on;
 * @mutate src/components/sections/ExploreSwitcher.tsx |   const options = visible.filter(isListed).map((s) => { |   const options = visible.map((s) => {
 * @mutate src/components/quotes/PostJobQuoteChoice.tsx |   if (quotesComingSoon && hideUnopenedInApp()) return null; |
 * @mutate src/components/mobileNav/useSectionTabs.ts |   if (hideUnopenedInApp()) return; |
 * @mutate src/components/mobileNav/useSectionTabs.ts |   if (labels.length === 0 \|\| hideUnopenedInApp()) return null; |   if (labels.length === 0) return null;
 * @mutate src/pages/search/SearchPage.tsx |   if (hideUnopenedInApp()) return null; |
 * @mutate src/components/declutter/SellItForMe.tsx |               {!hideUnopenedInApp() && ( |               {true && (
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const native = vi.hoisted(() => ({ on: false }));
const switches = vi.hoisted(() => ({ on: new Set<string>() }));
const everyone = vi.hoisted(() => ({ open: null as ReadonlySet<string> | null }));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return native.on;
  },
}));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => everyone.open }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => switches.on.has(key),
  useFeatureStatus: (key: string) => ({ on: switches.on.has(key), settled: true }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u-1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-1" }, profile: null, isLoading: false, isAdmin: false }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => { toasts.push(m); }, { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() }),
}));

import { hideUnopenedInApp, sectionListedHere } from "@/lib/hideUnopenedInApp";
import { openingSoonLine, sayComingSoon } from "@/components/mobileNav/useSectionTabs";
import { ExploreSwitcher } from "@/components/sections/ExploreSwitcher";
import { PriceModeChoice } from "@/components/quotes/PostJobQuoteChoice";

const ROOT = resolve(__dirname, "../..");
const SOON = /coming soon|\bsoon\b/i;

function renderExplore() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/jobs"]}>
        <ExploreSwitcher current="jobs" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const chips = () =>
  [...document.querySelectorAll('[data-testid="explore-switcher"] [role="radio"]')].map((b) => (b.textContent ?? "").trim());

beforeEach(() => {
  native.on = false;
  switches.on = new Set(["declutter"]);
  everyone.open = new Set(["declutter"]);
  toasts.length = 0;
});
afterEach(cleanup);

describe("(a) the one helper", () => {
  it("answers true only in the app; lists a section in the app only when it is open to everyone", () => {
    expect(hideUnopenedInApp()).toBe(false);
    expect(sectionListedHere({ on: false, preview: false })).toBe(true);
    native.on = true;
    expect(hideUnopenedInApp()).toBe(true);
    expect(sectionListedHere(undefined)).toBe(true); // Jobs: no switch
    expect(sectionListedHere({ on: true, preview: false })).toBe(true);
    expect(sectionListedHere({ on: false, preview: false })).toBe(false);
    expect(sectionListedHere({ on: true, preview: true })).toBe(false); // tester-only preview (App Review is a tester)
  });

  it("the toast and the 'opening soon' line say nothing in the app, and still do on the website", () => {
    sayComingSoon("Shops");
    expect(toasts).toEqual(["Shops is coming soon"]);
    expect(openingSoonLine(["Shops", "Homes"])).toBe("Shops and Homes are opening soon");
    native.on = true;
    toasts.length = 0;
    sayComingSoon("Shops");
    expect(toasts).toEqual([]);
    expect(openingSoonLine(["Shops", "Homes"])).toBeNull();
  });
});

describe("(b) rendered with native mocked on and off", () => {
  it("Explore's chips: the website lists Shops and Homes as Soon; the app lists only open sections, no soon text", () => {
    renderExplore();
    expect(chips().map((c) => c.replace(/Soon$/, " Soon"))).toEqual(["Jobs", "Declutter", "Shops Soon", "Homes Soon"]);
    cleanup();
    native.on = true;
    const { container } = renderExplore();
    expect(chips()).toEqual(["Jobs", "Declutter"]);
    expect(container.textContent ?? "").not.toMatch(SOON);
  });

  it("a tester-only preview is hidden in the app; once open to everyone it lists normally there", () => {
    native.on = true;
    switches.on = new Set(["declutter", "shops"]);
    renderExplore();
    expect(chips()).toEqual(["Jobs", "Declutter"]);
    cleanup();
    everyone.open = new Set(["declutter", "shops"]);
    const { container } = renderExplore();
    expect(chips()).toEqual(["Jobs", "Declutter", "Shops"]);
    expect(container.textContent ?? "").not.toMatch(SOON);
  });

  it("Post a job's 'Get quotes, coming soon' shows on the website and is left out in the app", () => {
    const web = render(<PriceModeChoice value="price" onChange={() => {}} quotesComingSoon />);
    expect(web.container.textContent).toMatch(/Get quotes/);
    expect(web.container.textContent).toMatch(/Coming soon/);
    cleanup();
    native.on = true;
    const app = render(<PriceModeChoice value="price" onChange={() => {}} quotesComingSoon />);
    expect(app.container.textContent ?? "").not.toMatch(SOON);
    expect(app.container.textContent ?? "").not.toMatch(/Get quotes/);
    cleanup();
    // Quotes open: the choice shows normally in the app too.
    const open = render(<PriceModeChoice value="price" onChange={() => {}} />);
    expect(open.container.textContent).toMatch(/Get quotes/);
  });
});

describe("(c) every soon mark reads the helper", () => {
  const walk = (dir: string): string[] =>
    readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  // Files that draw a soon mark for a section or a disabled quote button.
  const MARK = /<SoonPill\b|<PreviewPill\b|>\s*Coming soon\s*</;
  // Reads the helper, or the `listed` answer it feeds (useSectionTabs / useSectionIsListed).
  const READS = /hideUnopenedInApp\(|\.listed\b|useSectionIsListed\(|isListed\(/;
  // Web-only pages: the marketing landing (the app opens on sign-in, never the landing). Exact both ways.
  const WEB_ONLY = new Set(["src/components/landing/SectionsShowcase.tsx"]);

  it("finds the marks, and each file outside the web-only list hides them in the app", () => {
    const files = walk("src").filter((f) => !f.startsWith("src/test/") && MARK.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(files.length).toBeGreaterThan(6);
    const missing = files.filter((f) => !WEB_ONLY.has(f) && !READS.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(missing).toEqual([]);
    for (const f of WEB_ONLY) expect(files).toContain(f);
  });
});
