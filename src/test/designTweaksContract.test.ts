/**
 * The eight small modern tweaks the owner approved on the mock-ups
 * (wip/design-tweaks-mock, 2026-10-18), built for real: each sentence below
 * fails if its tweak is undone. Olive/rust and Montserrat stay; Bodoni Moda
 * stays on the landing H1 only.
 *
 * @mutate src/index.css |   font-family: Montserrat, "Montserrat Fallback", system-ui, -apple-system, sans-serif !important;\n  font-style: normal !important;\n  font-weight: 650 !important;\n  font-size: var(--headline-hero) !important; |   font-family: "Bodoni Moda", Georgia, serif !important;\n  font-style: italic !important;\n  font-weight: 700 !important;\n  font-size: var(--headline-hero) !important;
 * @mutate src/index.css | .font-display:not(.landing-h1, .landing-h1 *) { | .font-display-off {
 * @mutate src/components/landing/HeroSection.tsx | className="landing-h1 relative | className="relative
 * @mutate src/components/dashboard/JobCard.tsx | className={`${JOB_CARD_RAIL} ${catStyle.dot}`} | className="hidden"
 * @mutate src/main.tsx | installLargeTitles();\n |
 * @mutate src/components/dashboard/FilterSheet.tsx |         side="bottom"\n        floor\n |         side="bottom"\n
 * @mutate src/components/dashboard/BrowseTasksToolbar.tsx |       <CategoryChipRow\n |       {filters.selectedCategory && <CategoryChipRow\n
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   if (mine.isLoading) return <ListingsSkeleton />; |   if (mine.isLoading) return <p role="status">Loading your listings…</p>;
 * @mutate src/index.css |   [data-feed-card]:active, [data-activity-card]:active, button:active {\n    transform: scale(0.97); |   [data-feed-card]:active, [data-activity-card]:active, button:active {\n    transform: none;
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   const [maxMiles, setMaxMiles] = useState<number \| null>(null); |   const [maxMiles, setMaxMiles] = useState<number \| null>(25);
 * @mutate src/components/MobileNav.tsx |           {/* No Post "+" here any more |           <button aria-label="Post a new job"><Plus /></button>\n          {/* No Post "+" here any more
 * @mutate src/components/shops/ShopsHomeView.tsx |           <SectionActionPill\n            disabled={mine.isLoading} |           <Button\n            disabled={mine.isLoading}
 * @mutate src/pages/posts/PostedJobsTab.tsx |           Post a job\n |
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
  it("T1: page titles are Montserrat, upright; Bodoni only on the landing H1", () => {
    const title = rule(".text-page-title");
    expect(title).toMatch(/font-family:\s*Montserrat/);
    expect(title).toMatch(/font-style:\s*normal/);
    const display = rule(".font-display:not(.landing-h1, .landing-h1 *)");
    expect(display).toMatch(/font-family:\s*Montserrat/);
    expect(display).toMatch(/font-style:\s*normal/);
    expect(code("src/components/landing/HeroSection.tsx")).toMatch(/className="landing-h1 relative z-10 font-display/);
  });

  it("T2: cards have no outline and no blur", () => {
    const card = rule(".liquid-glass,\n:where(.bg-card),\n[data-feed-card],\n[data-activity-card]");
    expect(card).toMatch(/border-color:\s*transparent/);
    expect(card).toMatch(/backdrop-filter:\s*none/);
  });

  it("T3: job cards are main's card again (owner 2026-10-19: keep the same style): colour rail, coloured category tab, price chip", () => {
    // Superseded owner 2026-10-19 ("keep the SAME style and setup as the job
    // card on origin/main today"): the rail T3 removed is back on the cards.
    for (const f of ["src/components/dashboard/JobCard.tsx", "src/components/job-card/JobCardShell.tsx"]) {
      expect(code(f), f).toMatch(/\$\{JOB_CARD(_SHELL)?_RAIL\}/);
    }
    // ...with main's coloured category tab and price chip.
    expect(code("src/components/job/JobCategoryTab.tsx")).toMatch(/catStyle\.badge/);
    expect(code("src/components/job/MoneyChip.tsx")).not.toMatch(/money-chip/);
  });

  it("T4: large titles are installed once at boot and shrink on scroll", () => {
    expect(code("src/main.tsx")).toMatch(/^installLargeTitles\(\);$/m);
    expect(css).toMatch(/html\.page-scrolled \.page-title-card h1 \{/);
  });

  it("T5: skeleton bones are a clear grey, and My Listings loads as a skeleton", () => {
    expect(rule("[data-skeleton]")).toMatch(/background-color:\s*hsl\(220 12% 91%\)/);
    expect(code("src/components/declutter/DeclutterHomeView.tsx")).toMatch(/if \(mine\.isLoading\) return <ListingsSkeleton \/>;/);
  });

  it("T6: Filters opens as a slide-up sheet with a grab handle below desktop web", () => {
    expect(code("src/components/dashboard/FilterSheet.tsx")).toMatch(/side="bottom"\s+floor\s/);
    expect(code("src/components/dashboard/FilterSheet.tsx")).toMatch(/if \(anchorRef && webDesktop\)/);
    expect(code("src/components/ui/sheet.tsx")).toMatch(/isFloor && <div aria-hidden className="sheet-grab-handle" \/>/);
    expect(rule(".sheet-floor")).toMatch(/bottom:\s*0/);
  });

  it("T7: the category chips are always shown as one pill row with an edge fade", () => {
    const toolbar = code("src/components/dashboard/BrowseTasksToolbar.tsx");
    expect(toolbar).toMatch(/\n\s*<CategoryChipRow\n/);
    expect(toolbar).not.toMatch(/selectedCategory\s*&&\s*\(?\s*<CategoryChipRow/);
    expect(rule(".category-chip-row,\n.chip-row")).toMatch(/mask-image:\s*linear-gradient/);
    expect((code("src/components/declutter/DeclutterHomeView.tsx").match(/className="chip-row"/g) ?? []).length).toBeGreaterThan(1);
  });

  it("T8: cards and buttons dip under the finger, never under Reduce Motion", () => {
    expect(css).toMatch(/\[data-feed-card\]:active, \[data-activity-card\]:active, button:active \{\s*transform: scale\(0\.97\);/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*button:active[^}]*transform: none/);
  });

  it("inventory: every tweak section is present", () => {
    // Counted on the raw file: the section headings ARE comments, which `css` has blanked.
    const raw = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
    const n = (raw.match(/^\/\* T[1-8] — /gm) ?? []).length;
    expect(n).toBeGreaterThan(7);
  });

  it("owner 10-19: Declutter opens on Any distance, the dock has no +, and each section's add action is the shared pill", () => {
    expect(code("src/components/declutter/DeclutterHomeView.tsx")).toMatch(/useState<number \| null>\(null\)/);
    const nav = code("src/components/MobileNav.tsx");
    expect(nav).not.toMatch(/<Plus\b/);
    expect(nav).not.toMatch(/Post a new job/);
    const pills: Array<[string, RegExp]> = [
      ["src/components/declutter/DeclutterHomeView.tsx", /<SectionActionPill[\s\S]{0,120}?Sell an item/],
      ["src/components/shops/ShopsHomeView.tsx", /<SectionActionPill[\s\S]{0,200}Open a shop/],
      ["src/components/rentals/RentalsHomeView.tsx", /<SectionActionPill[\s\S]{0,120}?Add a property/],
      ["src/pages/posts/PostedJobsTab.tsx", /<SectionActionPill[\s\S]{0,160}?Post a job/],
    ];
    for (const [f, re] of pills) expect(code(f), f).toMatch(re);
    expect(pills.length).toBeGreaterThan(3);
  });
});
