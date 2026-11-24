/**
 * Deep audit 11-22 #12 (owner rule: the back arrow sits LEFT of the page title, never alone on its own row).
 *
 * The sell screen ("Show it off"), the sell chooser, the tip moment and a closed or missing job link each hid the
 * shared header's title (`phoneHidesTitle` / `hidesTitle`), so the back arrow had a ~60px row to itself and the
 * title sat below it or was missing. CLASS CHECK: every page file that hides the shared header's title is listed
 * here with why (the page paints the same title beside or right under the arrow itself). EXACT, both ways: a new
 * page that hides its title fails until it shows "<- Title" or earns a line here.
 *
 * Inventory (from source, comments blanked): every non-test file under src/ that names `phoneHidesTitle` or
 * `hidesTitle`, minus the shared primitives that only pass the prop through.
 *
 * @mutate src/components/declutter/SellOneScreen.tsx | : "sf.sellAnItem")} backTo="/declutter?tab=selling" narrow> | : "sf.sellAnItem")} backTo="/declutter?tab=selling" phoneHidesTitle={!form.free} hidesTitle={!form.free} narrow>
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | <AppPage title="Sell something" backTo="/declutter?tab=selling" narrow> | <AppPage title="Sell something" backTo="/declutter?tab=selling" phoneHidesTitle narrow>
 * @mutate src/pages/tips/TipMoment.tsx | <AppPage title="Tip" backTo="/home">\n      <div className="flex flex-col items-center text-center | <AppPage title="Tip" backTo="/home" phoneHidesTitle>\n      <div className="flex flex-col items-center text-center
 * @mutate src/pages/jobs/JobDetail.tsx | hidesTitle={!showsGuestPage && (authLoading \|\| isLoading)} | hidesTitle={!showsGuestPage}
 * @mutate src/pages/jobs/JobDetail.tsx | headerWrapperClassName={showsStateCard ? CARD_HEADER_COLUMN : NARROW_HEADER_COLUMN} | headerWrapperClassName={NARROW_HEADER_COLUMN}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** The shared header primitives: they define or forward the prop, they are not pages. */
const PRIMITIVES = new Set([
  "src/components/AppPage.tsx",
  "src/components/PageHeader.tsx",
  "src/components/marketing/PublicHeaderPage.tsx",
  "src/components/profile/ProfileTabHeader.tsx",
]);

/** Pages that hide the header's painted title, and the title they paint instead. EXACT. */
const HIDES_TITLE_WITH_WHY: Record<string, string> = {
  "src/components/declutter/DeclutterItemView.tsx": "owner mockup 11-01: the item's name is painted in the body beside Save and Share",
  "src/components/declutter/DeclutterSkeletons.tsx": "the item page's bones, the same header flags as DeclutterItemView (declutterItemSkeletonMatchesPage)",
  "src/pages/u/PublicProfilePage.tsx": "phone only, once loaded: the person's name is the profile hero right under the arrow",
  "src/pages/jobs/JobDetail.tsx": "only while the job loads (no 'Job' -> job title flash); every loaded branch paints its title",
};

const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
const hiders = files.filter((f) => !PRIMITIVES.has(f) && /\b(phoneHidesTitle|hidesTitle)\b/.test(code(f))).sort();

describe("the back arrow sits beside the page title, never alone (deep audit 11-22 #12)", () => {
  it("reads the real tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(800);
    for (const p of PRIMITIVES) expect(code(p)).toMatch(/\bhidesTitle\b/);
    expect(hiders.length).toBeGreaterThan(2);
  });

  it("every page that hides its header title is listed with why (exact, both ways)", () => {
    expect(hiders).toEqual(Object.keys(HIDES_TITLE_WITH_WHY).sort());
  });

  it("the four screens from the audit paint '<- Title' at every width", () => {
    expect(code("src/components/declutter/SellOneScreen.tsx")).not.toMatch(/\b(phoneHidesTitle|hidesTitle)\b/);
    expect(code("src/components/declutter/DeclutterSellChooser.tsx")).toContain('<AppPage title="Sell something" backTo="/declutter?tab=selling" narrow>');
    expect(code("src/pages/tips/TipMoment.tsx")).not.toMatch(/\bphoneHidesTitle\b/);
    expect(code("src/pages/jobs/JobDetail.tsx")).toContain("hidesTitle={!showsGuestPage && (authLoading || isLoading)}");
  });

  it("a closed or missing job's '<- Job' lines up with its 440px card at 1440", () => {
    const page = code("src/pages/jobs/JobDetail.tsx");
    expect(page).toContain("headerWrapperClassName={showsStateCard ? CARD_HEADER_COLUMN : NARROW_HEADER_COLUMN}");
    const cards = page.match(/className="mx-auto w-full max-w-\[440px\] flex" data-job-not-found=/g) ?? [];
    expect(cards.length).toBe(2);
    expect(code("src/lib/publicContainer.ts")).toMatch(/CARD_HEADER_COLUMN = "mx-auto max-w-\[calc\(440px\+2\.5rem\)\] sm:max-w-\[calc\(440px\+4rem\)\] lg:max-w-\[calc\(440px\+6rem\)\]"/);
  });
});
