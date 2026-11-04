/**
 * Q2027 (owner D10, 2026-10-17): one icon set at one weight, and only 4-5 text
 * sizes. This is the lint half: an EXACT, two-way ratchet on how many icon
 * stroke weights and text sizes the app's source uses, so the count can only
 * fall, and each fall lowers the baseline in the same commit.
 *
 * Measured 2026-11-03 (Builder 88, grep over the non-test .tsx files in src; this
 * file's reader also reads .ts): ONE icon set (lucide-react, 554 imports; no second icon library);
 * 11 stroke weights (75 x 2.25, 52 x 2.5, 46 x 2, 44 x 1.75, 17 x 1.5, 12 x 3,
 * and the one-offs 5 x 2.4, 2 x 1.8, 1 x 2.6, 1 x 1.4, 1 x 1.6). The five
 * one-off weights were snapped to their nearest neighbour (2.4 and 2.6 -> 2.5,
 * 1.8 -> 1.75, 1.4 and 1.6 -> 1.5) in this commit: 11 -> 6.
 * Text sizes: 17 ds-* tokens, the Tailwind defaults text-xs..text-4xl, the
 * headline/page-title tokens and 8 arbitrary text-[Npx|rem] sizes: 35 in all. Getting to
 * 4-5 is a visual change on every screen and waits on the owner's look; until
 * then this stops the scale from growing.
 *
 * 2026-11-04 (Builder 90, lead decision on Q2027, owner pre-approved): FIVE text sizes, 11 / 13 / 16 / 20 / 28
 * (body and inputs 16: iOS zooms on a focused input under 16px). Every ds-* token and Tailwind default size in
 * tailwind.config.ts now resolves to one of the five, the headline tokens in src/index.css are 28 / 20 / 16, and
 * the landing H2s use text-ds-28. The check below resolves every text-size class the app uses to its px and holds
 * the set at exactly the five. EXEMPT, by the owner's lock (CLAUDE.md "The landing hero is LOCKED"): the landing
 * H1 "Louisiana's local partner." and its subhead in src/components/landing/HeroSection.tsx keep their own sizes.
 * Not yet on the scale (exact two-way counts, to fall to 0): inline style fontSize literals and src/index.css
 * font-size declarations outside the five.
 * 2026-11-04 (Builder 106): 26 -> 3 inline and 19 -> 5 in index.css. Chart text (recharts takes numbers, never a
 * className) reads the two scale sizes in src/lib/chartText.ts; the clamp() titles use .text-headline-section (20px);
 * the senior rungs, print sheet, chip row, top-bar, card and sticky titles moved to scale sizes. Left, each relative
 * or a floor on purpose: the PDF export's 8pt table (jsPDF points), the two 0.82em "$" glyphs (a ratio of the
 * amount beside them, which is 16 or 20), the input zoom floor max(16px, 1em), the tracker's 0.91em and the senior
 * card title calc() (relative so Senior Mode still scales them), and the two section-tab fit clamps (lead 11-04:
 * never over 13px, smaller only when a phone is too narrow for the tabs).
 *
 * 2026-11-04 (Builder 1, owner picked B): ONE icon weight on screen. App.tsx wraps the app in LucideProvider with
 * strokeWidth={ICON_STROKE_PX} (1.75, src/lib/iconWeight.ts) and nonScalingStroke, so a lucide icon draws 1.75 CSS px
 * lines at any size. An icon's own strokeWidth (literal or ternary) overrides that, so the sweep removes them all:
 * ICON_STROKE_WIDTH_SITES is the exact two-way count of `strokeWidth=` attributes in non-test .tsx (273 at the
 * start). Same day, the sweep: 250 lucide overrides removed (the nav ternaries 2.3/1.8, 2.4/2/1.6, the dialog X
 * 2.5/2 included), so the count is 0. Left in RAW_SVG_STROKE_FILES: hand-drawn <svg>/<path> the provider cannot reach
 * (the error-boundary icons, ChunkRecoveringState, SuccessMoment, Footer's Facebook glyph, previewParts, the
 * empty-state illustrations, KpiSparkline, QuietHoursClock); bringing the icon-like ones to 1.75 non-scaling is next.
 * @mutate src/lib/iconWeight.ts | export const ICON_STROKE_PX = 1.75; | export const ICON_STROKE_PX = 2;
 * @mutate src/App.tsx | <LucideProvider strokeWidth={ICON_STROKE_PX} nonScalingStroke> | <LucideProvider strokeWidth={ICON_STROKE_PX}>
 * @mutate src/components/profile/ProfileEditForm.tsx | <Check className="w-3 h-3" /> Looks good | <Check className="w-3 h-3" strokeWidth={3} /> Looks good
 * @mutate tailwind.config.ts |         "ds-17": ["16px", |         "ds-17": ["17px",
 * @mutate src/index.css |   --headline-section: 20px; |   --headline-section: 19px;
 * @mutate src/components/landing/LiveJobsSection.tsx | leading-[1.05] text-ds-28" | leading-[1.05] text-ds-28 sm:text-[44px]"
 * @mutate src/components/LanguageToggle.tsx | <Languages className="h-4 w-4 shrink-0" aria-hidden | <Languages className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden
 * @mutate src/components/ui/EmptyState.tsx |             style={{ color: "hsl(var(--bark))" }}\n          />\n        </div>\n      )} |             style={{ color: "hsl(var(--bark))" }}\n            strokeWidth={1.4}\n          />\n        </div>\n      )}
 * @mutate src/components/feedback/SuccessMoment.tsx |             strokeWidth={2.5} |             strokeWidth={2.6}
 * @mutate src/lib/chartText.ts | export const CHART_TOOLTIP_PX = 13; | export const CHART_TOOLTIP_PX = 12;
 * @mutate src/components/analytics/AnalyticsCharts.tsx |   fontSize: CHART_TOOLTIP_PX,\n} as const; |   fontSize: "0.78rem",\n} as const;
 * @mutate src/index.css | .job-card-title { font-size: 1rem !important; } | .job-card-title { font-size: 1.0625rem !important; }
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

const files = execFileSync("git", ["ls-files", "src/*.ts", "src/*.tsx", "src/**/*.ts", "src/**/*.tsx"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !/(^|\/)(test|__tests__)\//.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.endsWith(".d.ts"))
  .map((f) => resolve(ROOT, f))
  .filter((f) => existsSync(f));
const code = files.map((f) => blankComments(readFileSync(f, "utf8"))).join("\n");

/** Exact baselines. Lower them when a weight or size goes away; never raise them. */
const STROKE_WEIGHTS = ["1.5", "1.75", "2", "2.5"]; // 2026-11-04 (Builder 1): only the RAW_SVG_STROKE_FILES drawings are left
/** The five sizes (px). Exact. */
const TEXT_SCALE = [11, 13, 16, 20, 28];
/** Off-scale literals still to move onto the scale (exact; lower when one goes). */
const INLINE_FONT_SIZE_LITERALS = 3;
/** Q2027 one weight: `strokeWidth=` attributes left in non-test .tsx (exact; lower as the sweep removes them, to 0). */
const ICON_STROKE_WIDTH_SITES = 0;
/** Files whose strokeWidth is on a raw <svg>/<path>, not a lucide icon (the provider cannot reach them). Sweep fills it. */
const RAW_SVG_STROKE_FILES: string[] = [
  "src/components/ChunkRecoveringState.tsx",
  "src/components/RouteErrorBoundary.tsx",
  "src/components/ErrorBoundary.tsx",
  "src/components/Footer.tsx",
  "src/components/admin/KpiSparkline.tsx",
  "src/components/empty-state/illustrations/EmptyInbox.tsx",
  "src/components/empty-state/illustrations/EmptyNotifications.tsx",
  "src/components/feedback/SuccessMoment.tsx",
  "src/components/empty-state/illustrations/EmptyJobs.tsx",
  "src/components/empty-state/illustrations/EmptyReviews.tsx",
  "src/components/empty-state/illustrations/EmptySavedHelprs.tsx",
  "src/components/empty-state/illustrations/EmptyPosts.tsx",
  "src/pages/admin/preview/previewParts.tsx",
  "src/components/profile/QuietHoursClock.tsx",
];
const CSS_OFF_SCALE_FONT_SIZES = 5;

/** The locked landing hero (owner lock, CLAUDE.md): its H1 and subhead class strings are not on the scale by design. */
function blankLockedHero(path: string, src: string): string {
  if (!path.endsWith("src/components/landing/HeroSection.tsx")) return src;
  return src
    .replace(/className="landing-h1[^"]*"/, (m) => " ".repeat(m.length))
    .replace(/className="mt-6 lg:mt-7 text-\[16px\] sm:text-\[17px\] lg:text-\[20px\] leading-relaxed[^"]*"/, (m) => " ".repeat(m.length));
}
const scaleCode = files.map((f) => blankLockedHero(f, blankComments(readFileSync(f, "utf8")))).join("\n");
const tw = readFileSync(resolve(ROOT, "tailwind.config.ts"), "utf8");
const css = blankComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));

/** px of one size class, from tailwind.config.ts fontSize, an arbitrary value, or the headline CSS tokens. */
function resolvePx(token: string): number | null {
  const arb = /^\[(\d+(?:\.\d+)?)(px|rem|em)\]$/.exec(token);
  if (arb) return arb[2] === "px" ? Number(arb[1]) : Number(arb[1]) * 16;
  const cfg = new RegExp(`(?:^|\\s)"?${token.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}"?:\\s*\\["(\\d+)px"`, "m").exec(tw);
  if (cfg) return Number(cfg[1]);
  const varName = token === "page-title" ? "headline-hero" : token;
  const v = new RegExp(`--${varName}:\\s*(\\d+)px`).exec(css);
  return v ? Number(v[1]) : null;
}

function strokeWeights(): string[] {
  const set = new Set<string>();
  for (const m of code.matchAll(/strokeWidth=(?:\{|")\s*([0-9.]+)\s*(?:\}|")/g)) set.add(String(Number(m[1])));
  return [...set].sort((a, b) => Number(a) - Number(b));
}

function textSizes(source = code): string[] {
  const set = new Set<string>();
  const re = /(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl|ds-\d+|\[\d+(?:\.\d+)?(?:px|rem|em)\]|headline-[a-z]+|page-title|display-[a-z]+)(?![\w-])/g;
  for (const m of source.matchAll(re)) set.add(m[1]);
  return [...set].sort();
}

describe("Q2027: icon weights and text sizes only ever shrink", () => {
  it("reads the whole app (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("one icon set: lucide-react is the only icon library imported", () => {
    const libs = new Set<string>();
    for (const m of code.matchAll(/from\s+"(lucide-react|react-icons[^"]*|@heroicons\/[^"]*|@phosphor-icons\/[^"]*|@radix-ui\/react-icons|@tabler\/icons[^"]*)"/g)) libs.add(m[1]);
    expect([...libs]).toEqual(["lucide-react"]);
  });

  it("icon stroke weights are exactly the baseline set (no new one-off weight)", () => {
    expect(strokeWeights()).toEqual(STROKE_WEIGHTS);
  });

  it("one icon weight: the app sets 1.75px non-scaling lines for every lucide icon in one place", () => {
    const app = blankComments(readFileSync(resolve(ROOT, "src/App.tsx"), "utf8"));
    expect(app).toMatch(/<LucideProvider\s+strokeWidth=\{ICON_STROKE_PX\}\s+nonScalingStroke\s*>/);
    expect(readFileSync(resolve(ROOT, "src/lib/iconWeight.ts"), "utf8")).toMatch(/export const ICON_STROKE_PX = 1\.75;/);
  });

  it("icon-level strokeWidth overrides only ever fall (exact, two-way; target 0)", () => {
    let n = 0;
    for (const f of files) {
      // App.tsx holds the one weight itself (LucideProvider strokeWidth={ICON_STROKE_PX}), checked above.
      if (!f.endsWith(".tsx") || f.endsWith("src/App.tsx") || RAW_SVG_STROKE_FILES.some((r) => f.endsWith(r))) continue;
      n += (blankComments(readFileSync(f, "utf8")).match(/\bstrokeWidth=/g) ?? []).length;
    }
    expect(n, `strokeWidth= sites: ${n}. Lower ICON_STROKE_WIDTH_SITES when one goes; never add one`).toBe(ICON_STROKE_WIDTH_SITES);
  });

  it("every text-size class the app uses resolves to exactly the five sizes (locked landing hero exempt)", () => {
    const classes = textSizes(scaleCode);
    expect(classes.length).toBeGreaterThan(10);
    const unresolved = classes.filter((c) => resolvePx(c) === null);
    expect(unresolved, "classes whose size could not be read").toEqual([]);
    const px = [...new Set(classes.map((c) => resolvePx(c) as number))].sort((a, b) => a - b);
    expect(px, classes.map((c) => `${c}=${resolvePx(c)}`).join(" ")).toEqual(TEXT_SCALE);
  });

  it("off-scale literal sizes outside the class scale are exactly the baseline (two-way)", () => {
    const inline = [...code.matchAll(/fontSize:\s*(?:"[^"]+"|'[^']+'|\d+)/g)].length;
    expect(inline).toBe(INLINE_FONT_SIZE_LITERALS);
    const onScale = new Set(["11px", "13px", "16px", "20px", "28px", "1.75rem", "1.25rem", "1rem", "0.8125rem"]);
    const decls = [...css.matchAll(/font-size:\s*([^;!}]+)/g)].map((m) => m[1].trim());
    expect(decls.length).toBeGreaterThan(10);
    const off = decls.filter((d) => !onScale.has(d) && !/^var\(--headline-/.test(d) && d !== "inherit");
    expect(off.length, off.join(" | ")).toBe(CSS_OFF_SCALE_FONT_SIZES);
  });

  it("chart text (recharts takes numbers, not classes) is on the scale", () => {
    const chart = blankComments(readFileSync(resolve(ROOT, "src/lib/chartText.ts"), "utf8"));
    const sizes = [...chart.matchAll(/export const (CHART_\w+_PX) = (\d+);/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(sizes.length).toBeGreaterThan(1);
    for (const [name, px] of sizes) expect(TEXT_SCALE, name).toContain(px);
  });
});
