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
 *  3. The chips row is the top bar: no visible title, the section's name kept as the page's one h1 (sr-only).
 *  4. "Coming soon" for everyone (owner, 2026-10-22): the chips never say "Preview"; a tester inside a preview
 *     section sees the "Coming soon – early preview" banner, and its empty Browse says "Opens soon".
 * Measured (WebKit, read-only prod session, ~/.lh-shots/ui5-explore/): Jobs Browse first card 242 -> 169px at 375;
 * while scrolling, nothing in the header moves at 375 or 1440 (before: 69 -> 70.4px at 375, 77.4 -> 79.4px at 1440).
 *
 * @mutate src/index.css | html.page-scrolled .page-title-card:has(.explore-header), | html.page-scrolled .page-title-card:has(.no-such-header),
 * @mutate src/components/sections/ExploreSwitcher.tsx |         track.scrollLeft = picked.offsetLeft + picked.offsetWidth - track.clientWidth; |
 * @mutate src/index.css | .page-title-card:has(.explore-header) { padding: 0 !important; border-width: 0 !important; } | .page-title-card:has(.explore-header) { border-width: 0 !important; }
 * @mutate src/index.css | :root.page-scrolled[data-theme] .page-title-card:has(.explore-header) {\n  transition: none !important; | :root.page-scrolled[data-theme] .page-title-card:has(.explore-header) {
 * @mutate src/components/sections/SectionScreen.tsx |         {section && (\n          // py/gap | {false && (\n          // py/gap
 * @mutate src/components/sections/AppTopBar.tsx |             <h1 className="sr-only">{title}</h1> |             <h1 className="text-page-title">{title}</h1>
 * @mutate src/components/sections/ExploreSwitcher.tsx |     const soon = !on \|\| isPreview(s); |     const soon = !on;
 * @mutate src/components/sections/SectionScreen.tsx | {section && <SectionPreviewBanner section={section} />} |
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

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
    // Drawn for every section screen (Home's has none), and the tester's banner with it.
    expect(screen).toMatch(/\{section && \(\s*<div data-explore-header=""/);
    expect(screen).toContain("{section && <SectionPreviewBanner section={section} />}");
    const header = screen.indexOf("data-explore-header");
    const scroll = screen.indexOf("data-app-page-scroll");
    expect(header).toBeGreaterThan(0);
    expect(scroll).toBeGreaterThan(header);
    // The header's own block closes before the scroll column opens.
    expect(screen.slice(header, scroll)).toMatch(/<AppTopBar title=\{title\} explore section=\{section\} \/>\s*\{tabs\}\s*\{globalSearch && <ExploreSearchEntry \/>\}\s*<\/div>/);
    for (const f of ["src/components/declutter/DeclutterHomeView.tsx", "src/components/shops/ShopsHomeView.tsx", "src/components/rentals/RentalsHomeView.tsx"]) {
      expect({ f, tabsProp: /<SectionScreen[^>]*\btabs=\{/.test(code(f)) }).toEqual({ f, tabsProp: true });
    }
    const jobs = code("src/pages/jobs/JobsSection.tsx");
    const head = jobs.slice(jobs.indexOf('className="explore-header'), jobs.indexOf("</div>", jobs.indexOf('className="explore-header')));
    const order = ['<AppTopBar title={section.label} explore section="jobs"', "<SectionTabs "].map((s) => head.indexOf(s));
    expect(order[0]).toBeGreaterThan(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Jobs' search is an icon in the status chip row now, never a field in the header (owner 2026-10-25;
    // src/test/jobsSearchIsAnIcon.test.tsx).
    expect(head).not.toContain("<ExploreSearchEntry");
  });

  it("3. on a phone the chips row is the top bar: no visible title, the section's name is the sr-only h1", () => {
    const bar = code("src/components/sections/AppTopBar.tsx");
    expect(bar).toMatch(/<header className="app-top-bar explore-top-row[^"]*"[^>]*>\s*<h1 className="sr-only">\{title\}<\/h1>\s*<div className="min-w-0 flex-1">\s*<ExploreSwitcher current=\{section\} \/>/);
  });

  it("3b. four chips that do not fit scroll sideways: the open section's chip is brought into view and the edge fades (measured 278px of chips in a 237px track at 375)", () => {
    const sw = code("src/components/sections/ExploreSwitcher.tsx");
    expect(sw).toMatch(/track\.scrollLeft = picked\.offsetLeft \+ picked\.offsetWidth - track\.clientWidth;/);
    expect(sw).toMatch(/new ResizeObserver\(reveal\)/);
    expect(sw).toMatch(/className=\{more \? "explore-chips-more" : undefined\}/);
    expect(css).toMatch(/\.explore-chips-more \[role="radiogroup"\] \{[^}]*mask-image: linear-gradient/);
  });

  it("4. 'Coming soon' for everyone: no Preview mark on the chips; the tester's banner and 'Opens soon'", () => {
    const sw = code("src/components/sections/ExploreSwitcher.tsx");
    expect(sw).not.toMatch(/PreviewPill|previewLabel/);
    expect(sw).toMatch(/const soon = !on \|\| isPreview\(s\);/);
    expect(code("src/components/sections/SectionPreviewBanner.tsx")).toContain("Coming soon – early preview");
    for (const f of ["src/components/declutter/DeclutterHomeView.tsx", "src/components/shops/ShopsHomeView.tsx", "src/components/rentals/listings/RentBrowse.tsx"]) {
      expect({ f, opensSoon: /preview \? "Opens soon"/.test(code(f)) }).toEqual({ f, opensSoon: true });
    }
  });
});
