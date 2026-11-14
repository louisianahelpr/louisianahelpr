/**
 * THE EXPLORE HEADER (owner, 2026-10-22, after the lead's WebKit recording: first card at 242/844pt, the header
 * did not collapse, a 3px header nudge on scroll; 2026-10-23: "this was about the top nav not scrolling well").
 * The header is: the section chips on ONE row with the bell and the photo (no "Explore" title), the section's thin
 * underline tabs, then the search, and it is STEADY: nothing in it hides, shrinks or moves while the list scrolls.
 *
 *  1. The nudge's cause: html.page-scrolled turned the title card holding the header into a compact blurred bar
 *     (2.4px of padding, a border, a centred shrinking h1). A title card holding the Explore header keeps its
 *     resting box: the reset rule must outrank both page-scrolled rules (light and dark) and zero every property
 *     they change.
 *  2. The four sections draw the header OUTSIDE their scroll column (SectionScreen; Jobs' title card already is),
 *     with the tabs inside it, in the owner's order: chips row, tabs, search.
 *  3. (Nav redesign, owner 2026-11-06: the bottom bar switches sections, so the chips row left the phone top bar.)
 *     The top bar is the section's own visible title, the page's one h1, then the bell, Messages, "+", You.
 *  4. "Coming soon" for everyone (owner, 2026-10-22): the chips never say "Preview"; a tester inside a preview
 *     section sees its empty Browse say "Opens soon", and NO "Coming soon – early preview" banner over the
 *     content (owner, 2026-10-28: "remove coming soon early preview. the bottom stuff already says that. same for
 *     homes and declutter").
 * Measured (WebKit, read-only prod session, ~/.lh-shots/ui5-explore/): Jobs Browse first card 242 -> 169px at 375;
 * while scrolling, nothing in the header moves at 375 or 1440 (before: 69 -> 70.4px at 375, 77.4 -> 79.4px at 1440).
 *
 * @mutate src/index.css | html.page-scrolled .page-title-card:has(.explore-header), | html.page-scrolled .page-title-card:has(.no-such-header),
 * @mutate src/components/sections/ExploreSwitcher.tsx |         track.scrollLeft = picked.offsetLeft + picked.offsetWidth - track.clientWidth; |
 * @mutate src/index.css | .page-title-card:has(.explore-header) { padding: 0 !important; border-width: 0 !important; } | .page-title-card:has(.explore-header) { border-width: 0 !important; }
 * @mutate src/index.css | :root.page-scrolled[data-theme] .page-title-card:has(.explore-header) {\n  transition: none !important; | :root.page-scrolled[data-theme] .page-title-card:has(.explore-header) {
 * @mutate src/components/sections/SectionScreen.tsx |         {section && (\n          // py/gap | {false && (\n          // py/gap
 * @mutate src/components/sections/AppTopBar.tsx |             <h1 className="min-w-0 truncate text-page-title text-foreground" title={title}>{title}</h1> |             <h1 className="sr-only">{title}</h1>
 * @mutate src/components/rentals/listings/RentBrowse.tsx | title={preview ? "Coming soon" | title={preview ? "Opens soon"
 * @mutate src/components/sections/ExploreSwitcher.tsx |     const soon = !unknown && (!on \|\| isPreview(s)); |     const soon = !unknown && (!on);
 * @mutate src/components/sections/SectionScreen.tsx |           <div className={`flex min-h-full flex-col gap-4 pt-1 ${fab ? "pb-20" : "pb-6"}`}>\n |           <div className={`flex flex-col gap-4 pt-1 ${fab ? "pb-20" : "pb-6"}`}>\n            {section && <p role="status">Coming soon – early preview</p>}\n
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "..", "..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

/** Every rule body in index.css whose selector list contains `sel` (comments blanked). */
function rulesFor(css: string, sel: RegExp): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (sel.test(m[1])) out.push(m[2]);
  return out;
}

describe("the Explore header is steady (owner 2026-10-22/23)", () => {
  const css = code("src/index.css");

  it("1a. at rest that title card is no card on every width (no padding, no border), so the scrolled reset changes nothing", () => {
    const rest = rulesFor(css, /^\s*\.page-title-card:has\(\.explore-header\)\s*$/m);
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatch(/padding:\s*0 !important/);
    expect(rest[0]).toMatch(/border-width:\s*0 !important/);
  });

  it("1. a title card holding the Explore header keeps its resting box while the page is scrolled, light and dark", () => {
    // What the page-scrolled rules change on a title card, measured from the CSS itself (floor: 5 properties).
    const changed = new Set<string>();
    for (const body of rulesFor(css, /\.page-scrolled[^,{]*\.page-title-card\s*$/m)) {
      for (const m of body.matchAll(/([a-z-]+)\s*:/g)) changed.add(m[1]);
    }
    expect(changed.size).toBeGreaterThan(4);
    const reset = rulesFor(css, /html\.page-scrolled \.page-title-card:has\(\.explore-header\)/);
    expect(reset).toHaveLength(1);
    const sels = /([^{}]+)\{[^{}]*\}/.exec(css.slice(css.indexOf("html.page-scrolled .page-title-card:has(.explore-header)")))?.[1] ?? "";
    // The dark page-scrolled rule (:root.page-scrolled[data-theme="dark"]) is (0,4,0): the reset needs a selector above it.
    expect(sels).toMatch(/:root\.page-scrolled\[data-theme\] \.page-title-card:has\(\.explore-header\)/);
    const body = reset[0];
    for (const prop of ["padding", "margin-left", "margin-right", "border-width", "background-color", "backdrop-filter", "-webkit-backdrop-filter", "transition"]) {
      expect({ prop, set: new RegExp(`(^|[;\\s])${prop}\\s*:[^;]*!important`).test(body) }).toEqual({ prop, set: true });
    }
    // Every property a page-scrolled rule changes is covered by the reset (padding-* by padding).
    for (const prop of changed) {
      const covered = new RegExp(`(^|[;\\s])${prop.replace(/-(top|bottom|left|right)$/, "")}(-[a-z]+)?\\s*:`).test(body) || ["position", "border-radius", "border-bottom"].includes(prop);
      expect({ prop, covered }).toEqual({ prop, covered: true });
    }
  });

  it("2. the four sections draw the header outside the scroll column, chips row then tabs then search", () => {
    const screen = code("src/components/sections/SectionScreen.tsx");
    // Drawn for every section screen (Home's has none).
    expect(screen).toMatch(/\{section && \(\s*<div data-explore-header=""/);
    const header = screen.indexOf("data-explore-header");
    const scroll = screen.indexOf("data-app-page-scroll");
    expect(header).toBeGreaterThan(0);
    expect(scroll).toBeGreaterThan(header);
    // The header's own block closes before the scroll column opens.
    expect(screen.slice(header, scroll)).toMatch(/<AppTopBar title=\{title\} explore section=\{section\} search=\{barSearch\} mine=\{mine\} showAdd=\{showAdd\} add=\{add\} \/>\s*\{tabs\}\s*\{globalSearch && <ExploreSearchEntry \/>\}\s*<\/div>/);
    for (const f of ["src/components/declutter/DeclutterHomeView.tsx", "src/components/shops/ShopsHomeView.tsx", "src/components/rentals/RentalsHomeView.tsx"]) {
      expect({ f, tabsProp: /<SectionScreen[^>]*\btabs=\{/.test(code(f)) }).toEqual({ f, tabsProp: true });
    }
    const jobs = code("src/pages/jobs/JobsSection.tsx");
    const head = jobs.slice(jobs.indexOf('className="explore-header'), jobs.indexOf("</div>", jobs.indexOf('className="explore-header')));
    const order = ['<AppTopBar title={tr(navKey(section.path, section.label) ?? "nav.jobs")} explore section="jobs"', "<SectionTabs "].map((s) => head.indexOf(s));
    expect(order[0]).toBeGreaterThan(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Jobs' search is an icon in the status chip row now, never a field in the header (owner 2026-10-25;
    // src/test/jobsSearchIsAnIcon.test.tsx).
    expect(head).not.toContain("<ExploreSearchEntry");
  });

  // Owner 11-08 (the Vinted header): a bar that carries the section's search names the page with a visually hidden h1
  // instead (still the page's one h1); every other bar keeps the visible title, Dashboard's `search={null}` included.
  // F148 (11-09) split them into two rows; the compact top (owner 11-14) made the search the bar's one row again, with the
  // bell and the photo inline on its right (src/test/compactTopRow.test.tsx).
  it("3. on a phone a bar with a search is ONE row (hidden h1, the search, the bell and the photo); a bar without one shows its visible title; no chips row", () => {
    const bar = code("src/components/sections/AppTopBar.tsx");
    expect(bar).toMatch(/<header className=\{COMPACT_TOP_ROW\}[^>]*>\s*\{title && <h1 className="sr-only">\{title\}<\/h1>\}\s*<div data-testid="app-top-bar-search" className="min-w-0 flex-1">\{search\}<\/div>/);
    expect(bar).toMatch(/<header className=\{TITLE_TOP_ROW\}[^>]*>\s*\{title \? \(\s*<h1 className="min-w-0 truncate text-page-title text-foreground" title=\{title\}>\{title\}<\/h1>/);
    expect(bar).not.toMatch(/<ExploreSwitcher/);
  });

  it("3b. four chips that do not fit scroll sideways: the open section's chip is brought into view and the edge fades (measured 278px of chips in a 237px track at 375)", () => {
    const sw = code("src/components/sections/ExploreSwitcher.tsx");
    expect(sw).toMatch(/track\.scrollLeft = picked\.offsetLeft \+ picked\.offsetWidth - track\.clientWidth;/);
    expect(sw).toMatch(/new ResizeObserver\(reveal\)/);
    expect(sw).toMatch(/className=\{more \? "explore-chips-more" : undefined\}/);
    expect(css).toMatch(/\.explore-chips-more \[role="radiogroup"\] \{[^}]*mask-image: linear-gradient/);
  });

  it("4. 'Coming soon' for everyone: no Preview mark on the chips, no 'early preview' banner anywhere, a tester's empty Browse says 'Coming soon'", () => {
    const sw = code("src/components/sections/ExploreSwitcher.tsx");
    expect(sw).not.toMatch(/PreviewPill|previewLabel/);
    // While the switch answer is out the chip is neutral instead (exploreChipNeverSoonWhileAsking, lead 11-05).
    expect(sw).toMatch(/const soon = !unknown && \(!on \|\| isPreview\(s\)\);/);
    // The banner's class, from source (owner 2026-10-28): no screen draws the "early preview" words again.
    const screens = trackedFiles("src").filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx") && !f.startsWith("src/test/"));
    expect(screens.length).toBeGreaterThan(200);
    expect(screens.filter((f) => /early preview/i.test(code(f)))).toEqual([]);
    // Shops left this list with the shops audit 11-10 F1 (lead): its empty Browse says one thing, "No shops near you
    // yet. Be the first: open a free shop." (src/components/shops/shopOrderScreens.test.tsx), never "Coming
    // soon" beside "open a free shop"; it still never says "Opens soon".
    expect(code("src/components/shops/ShopsHomeView.tsx")).not.toMatch(/Opens soon|"Coming soon"/);
    for (const f of ["src/components/rentals/listings/RentBrowse.tsx"]) {
      // One word (owner's UI audit 11-09, F139): it said "Opens soon" while the menu, Create and Settings said "Coming soon".
      expect({ f, comingSoon: /preview \? "Coming soon"/.test(code(f)), opensSoon: /Opens soon/.test(code(f)) }).toEqual({ f, comingSoon: true, opensSoon: false });
    }
    // Owner 2026-10-30: Declutter reads as open to everyone who has it (useSectionTabs OPEN_FOR_THOSE_WHO_HAVE_IT),
    // so its Browse never says "Opens soon" (declutterTabs.test.tsx renders the real empty state).
    expect(code("src/components/declutter/DeclutterBrowseView.tsx")).not.toMatch(/Opens soon/);
  });
});
