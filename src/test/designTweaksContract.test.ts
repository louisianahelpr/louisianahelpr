/**
 * The eight small modern tweaks the owner approved on the mock-ups
 * (wip/design-tweaks-mock, 2026-10-18), built for real: each sentence below
 * fails if its tweak is undone. Olive/rust and Montserrat stay; Bodoni Moda
 * stays on the landing H1 only.
 *
 * @mutate src/index.css |   font-family: Montserrat, "Montserrat Fallback", system-ui, -apple-system, sans-serif !important;\n  font-style: normal !important;\n  font-weight: 650 !important;\n  font-size: var(--headline-hero) !important; |   font-family: "Bodoni Moda", Georgia, serif !important;\n  font-style: italic !important;\n  font-weight: 700 !important;\n  font-size: var(--headline-hero) !important;
 * @mutate src/index.css | .font-display:not(.landing-h1, .landing-h1 *, .font-moment) { | .font-display-off {
 * @mutate src/components/landing/HeroSection.tsx | className="landing-h1 relative | className="relative
 * @mutate src/components/dashboard/JobCard.tsx |         {/* No category rail: |         <span aria-hidden className={`${JOB_CARD_RAIL}`} />\n        {/* No category rail:
 * @mutate src/components/ui/skeletons/JobCardSkeleton.tsx |         {/* No category rail: |         <span className={JOB_CARD_RAIL} />\n        {/* No category rail:
 * @mutate src/components/job/JobCategoryTab.tsx | className={`job-cat-label inline-flex | className={`job-cat-label bg-primary inline-flex
 * @mutate src/main.tsx | installLargeTitles();\n |
 * @mutate src/components/dashboard/FilterSheet.tsx |         floor\n        // The Filters button |         floor={false}\n        // The Filters button
 * @mutate src/components/dashboard/BrowseTasksToolbar.tsx |       {renderHeading && <h1 className="sr-only">{headingTitle}</h1>} |       {renderHeading && <h1 className="sr-only">{headingTitle}</h1>}<CategoryChipRow selectedCategory={null} setSelectedCategory={() => {}} />
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   if (mine.isLoading) return <ListingsSkeleton />; |   if (mine.isLoading) return <p role="status">Loading your listings…</p>;
 * @mutate src/index.css |   [data-feed-card]:active, [data-activity-card]:active, button:active {\n    transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) scale(0.97); |   [data-feed-card]:active, [data-activity-card]:active, button:active {\n    transform: none;
 * @mutate src/lib/declutter/browseFilters.ts |     maxMiles: positive(p.get("mi")), |     maxMiles: positive(p.get("mi")) ?? 25,
 * @mutate src/components/MobileNav.tsx |               {/* The center "+" (owner-approved mock-up, 2026-10-20): one raised |               <button aria-label="Post a new job"><Plus /></button>\n              {/* The center "+" (owner-approved mock-up, 2026-10-20): one raised
 * @mutate src/components/shops/ShopDashboardView.tsx | <SectionActionPill className="mt-3" onClick={() => navigate("/shops/mine")}>Open a shop</SectionActionPill> | <Button className="mt-3" onClick={() => navigate("/shops/mine")}>Open a shop</Button>
 * @mutate src/components/declutter/DeclutterHomeView.tsx |             <SectionActionPill className="mt-3" onClick={() => navigate(sectionByKey("declutter").add.path)}> |             <SectionActionPill className="mt-3" onClick={() => navigate("/declutter")}>
 * @mutate src/components/DesktopSidebarNav.tsx |           data-testid="sidebar-create" |           data-testid="sidebar-made"
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
const css = blankCssComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));

function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) return "";
  return css.slice(i, css.indexOf("}", i));
}

describe("design tweaks (owner 2026-10-18)", () => {
  it("T1: page titles are Montserrat, upright; Bodoni only on the landing H1 (moments are Montserrat since 2026-10-25)", () => {
    const title = rule(".text-page-title");
    expect(title).toMatch(/font-family:\s*Montserrat/);
    expect(title).toMatch(/font-style:\s*normal/);
    const display = rule(".font-display:not(.landing-h1, .landing-h1 *, .font-moment)");
    expect(display).toMatch(/font-family:\s*Montserrat/);
    expect(display).toMatch(/font-style:\s*normal/);
    expect(code("src/components/landing/HeroSection.tsx")).toMatch(/className="landing-h1 relative z-10 font-display/);
  });

  it("T2: cards have no outline and no blur", () => {
    const card = rule(".liquid-glass,\n:where(.bg-card),\n[data-feed-card],\n[data-activity-card]");
    expect(card).toMatch(/border-color:\s*transparent/);
    expect(card).toMatch(/backdrop-filter:\s*none/);
  });

  it("T3: job cards carry no colour rail and the category is an icon + label", () => {
    for (const f of ["src/components/dashboard/JobCard.tsx", "src/components/job-card/JobCardShell.tsx"]) {
      expect(code(f), f).not.toMatch(/\$\{JOB_CARD(_SHELL)?_RAIL\}/);
    }
    // ...and neither do their loading bones (the stripe outlived the cards once).
    for (const f of ["src/components/ui/skeletons/JobCardSkeleton.tsx", "src/components/ui/skeletons/ApplicationCardSkeleton.tsx"]) {
      expect(code(f), f).not.toMatch(/\bJOB_CARD(_SHELL)?_RAIL\b/);
    }
    const tab = code("src/components/job/JobCategoryTab.tsx");
    expect(tab).toMatch(/job-cat-label inline-flex/);
    expect(tab).not.toMatch(/catStyle\.badge/);
    expect(rule(".money-chip")).toMatch(/background:\s*transparent/);
  });

  it("T4: large titles are installed once at boot and shrink on scroll", () => {
    expect(code("src/main.tsx")).toMatch(/^installLargeTitles\(\);$/m);
    expect(css).toMatch(/html\.page-scrolled \.page-title-card h1 \{/);
  });

  it("T5: skeleton bones are a clear grey, and My Listings loads as a skeleton", () => {
    expect(rule("[data-skeleton]")).toMatch(/background-color:\s*hsl\(220 12% 91%\)/);
    expect(code("src/components/declutter/DeclutterHomeView.tsx")).toMatch(/if \(mine\.isLoading\) return <ListingsSkeleton \/>;/);
  });

  // LEAD-SHEET-X-ONLY (owner 10-31): no grab handle on any sheet; the X (or a tap outside) closes it.
  // @mutate src/components/ui/sheet.tsx |           {/* LEAD-SHEET-X-ONLY (owner 10-31): no drag bar or grab handle; a sheet closes with its X or a tap outside. */}\n |           {isFloor && <div aria-hidden className="sheet-grab-handle" />}\n
  it("T6: Filters opens as a slide-up sheet below desktop web, with no grab handle", () => {
    // Desktop web: the small drop-down under the Filters button (owner 2026-10-28; filterDropdownOnDesktop.test.tsx).
    expect(code("src/components/dashboard/FilterSheet.tsx")).toMatch(/side="bottom"\s+floor\s/);
    expect(code("src/components/ui/sheet.tsx")).not.toMatch(/sheet-grab-handle|grab-handle/);
    expect(code("src/index.css")).not.toMatch(/sheet-grab-handle/);
    expect(rule(".sheet-floor")).toMatch(/bottom:\s*0/);
  });

  it("T7, as amended 10-19: no category pill row on any Browse; categories live in the filter sheet", () => {
    const toolbar = code("src/components/dashboard/BrowseTasksToolbar.tsx");
    expect(toolbar).not.toMatch(/<CategoryChipRow\b/);
    expect(code("src/components/dashboard/filterSheet/jobFilterSections.tsx")).toMatch(/key: "category",/);
    // Shops: the shared search row, its category choices in the filter sheet behind it (owner 2026-10-19).
    expect(code("src/components/shops/ShopsHomeView.tsx")).toMatch(/<SectionSearchRow\b[\s\S]*<ChoiceSheet\b/);
    expect(code("src/components/shops/ShopsHomeView.tsx")).not.toMatch(/chip-row/);
    // The fade marks only a row that really continues (Messages chips, 2026-10-28): .chip-row[data-more].
    expect(rule(".chip-row[data-more]")).toMatch(/mask-image:\s*linear-gradient/);
    // Declutter's distance chips moved into the slide-up filter sheet; its search and filters end the tabs row (owner 10-30).
    expect(code("src/components/declutter/DeclutterBrowseView.tsx")).toMatch(/<InlineListSearch[^>]*label="Search items"/);
  });

  it("T8: cards and buttons dip under the finger, never under Reduce Motion", () => {
    // 2026-10-19: the dip composes the Tailwind translate back in (pressKeepsTranslate: a bare
    // scale() dropped a centred search X out from under the finger), and Reduce Motion keeps only it.
    expect(css).toMatch(/\[data-feed-card\]:active, \[data-activity-card\]:active, button:active \{\s*transform: translate\(var\(--tw-translate-x, 0\), var\(--tw-translate-y, 0\)\) scale\(0\.97\);/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*button:active[^}]*transform: translate\(var\(--tw-translate-x, 0\), var\(--tw-translate-y, 0\)\) !important/);
  });

  it("inventory: every tweak section is present", () => {
    // Counted on the raw file: the section headings ARE comments, which `css` has blanked.
    const raw = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
    const n = (raw.match(/^\/\* T[1-8] — /gm) ?? []).length;
    expect(n).toBeGreaterThan(7);
  });

  it("owner 10-19/10-20: Declutter opens on Any distance, the dock's ONE + is the center Create (it opens the sheet, never a post-a-job shortcut), and each section's add action is the shared pill", () => {
    // Any distance unless the URL (a saved search, Q2275) names one.
    expect(code("src/components/declutter/DeclutterBrowseView.tsx")).toMatch(/useState<number \| null>\(start\.maxMiles\)/);
    expect(code("src/lib/declutter/browseFilters.ts")).toMatch(/maxMiles: positive\(p\.get\("mi"\)\),/);
    const nav = code("src/components/MobileNav.tsx");
    // Superseded 2026-10-20 (owner-approved mock-up: center + in the bottom bar): exactly one +, the Create button.
    expect(nav.match(/<Plus\b/g) ?? []).toHaveLength(1);
    expect(nav).toContain('data-testid="dock-create"');
    expect(nav).not.toMatch(/Post a new job/);
    const pills: Array<[string, RegExp]> = [
      // Declutter's add action is its own pill (no section "+" in the header since owner 2026-10-28).
      ["src/components/declutter/DeclutterHomeView.tsx", /<SectionActionPill className="mt-3" onClick=\{\(\) => navigate\(sectionByKey\("declutter"\)\.add\.path\)\}>/],
      ["src/components/shops/ShopDashboardView.tsx", /<SectionActionPill[\s\S]{0,200}Open a shop/],
      ["src/components/rentals/RentalsHomeView.tsx", /<SectionActionPill[\s\S]{0,120}?Add a property/],
      // Jobs' add action is the desktop rail's "+ Create" (owner 2026-10-28: "do we need the post a job since the
      // create is to post"); on a phone the dock's center Create, asserted above.
      ["src/components/DesktopSidebarNav.tsx", /data-testid="sidebar-create"/],
    ];
    for (const [f, re] of pills) expect(code(f), f).toMatch(re);
    expect(pills.length).toBeGreaterThan(3);
  });
});
