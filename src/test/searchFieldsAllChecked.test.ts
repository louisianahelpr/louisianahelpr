/**
 * EVERY SEARCH FIELD IN THE APP IS CHECKED IN A REAL BROWSER — inventory from
 * source, minus what the browser specs drive, is empty.
 *
 * OWNER, 2026-10-01, from the iOS app: "Check the x's on the search bars
 * globally bc the ones in the app are the same way", and "Search should not
 * cover the page titles in app."
 *
 * The browser half lives in two specs that each list their surfaces with the
 * component `file` that renders them:
 *   - e2e/prod-audit/search-x-off-center-press.spec.ts — the ✕ is centred in
 *     its field, stays put while pressed, and one off-centre press clears or
 *     closes the field;
 *   - e2e/prod-audit/search-keeps-title.spec.ts — the open field never
 *     covers or removes the page title.
 * Both run at 375 and 1440, Chromium and WebKit.
 *
 * Before this file, the press spec named six surfaces by hand and nothing
 * tied that list to the app: BrowseSearchBar's PHONE bar on /home (a separate
 * render from the desktop strip the spec drove) had never been pressed at
 * 375, and nothing would have noticed a seventh search ✕.
 *
 * What is derived here, from src (comments blanked):
 *   A. every search field — an <input>/<Input>/<CommandInput> that is
 *      type="search" or whose aria-label/placeholder says "search";
 *   B. which of those files render a search ✕ (a button labelled
 *      "Close search" / "Clear search");
 *   C. every ScreenHeaderRow `expandingSearch` caller.
 * And it requires:
 *   - every ✕ file (B) has a press-spec surface that runs at 375 AND one that
 *     runs at 1440, and a title-spec surface;
 *   - every expanding-search caller (C) has a title-spec surface;
 *   - every search field with no ✕ (A minus B) is on NO_X below, exactly,
 *     with its reason — and the native WebKit ✕ stays hidden, or every one
 *     of them would grow an unchecked ✕.
 */
// @mutate e2e/prod-audit/search-x-off-center-press.spec.ts | close: `[data-feed-strip] ${CLOSE}`,\n    minWidth: 900, | close: `[data-feed-strip] ${CLOSE}`,
// @mutate e2e/prod-audit/search-x-off-center-press.spec.ts | name: "legal", file: "src/pages/info/Legal.tsx", | name: "legal", file: "src/pages/info/Legal.ts",
// @mutate e2e/prod-audit/search-keeps-title.spec.ts | name: "messages", file: "src/components/messages/ConversationList.tsx", | name: "messages", file: "src/components/messages/ConversationList.ts",
// @mutate src/index.css | input[type="search"]::-webkit-search-cancel-button, | input[type="search"]::-webkit-search-cancelled,
// @mutate src/components/admin/AdminUsers.tsx | aria-label="Clear search" | aria-label="Clear"
// @mutate e2e/prod-audit/search-x-off-center-press.spec.ts | close: `[data-browse-phone-controls] ${CLOSE}`,\n    maxWidth: 899, | close: `[data-browse-phone-controls] ${CLOSE}`,
// @mutate e2e/prod-audit/search-x-off-center-press.spec.ts | name: "admin-command-palette", file: "src/components/admin/AdminCommandPalette.tsx", | name: "admin-command-palette", file: "src/components/admin/AdminCommandPalette.ts",
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { en } from "@/lib/i18n/en";

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");
const PRESS_SPEC = "e2e/prod-audit/search-x-off-center-press.spec.ts";
const TITLE_SPEC = "e2e/prod-audit/search-keeps-title.spec.ts";

/** Search fields that render no ✕ of their own, and why that is fine. Exact:
 * a stale entry fails, and so does a new ✕-less field missing from here. */
const NO_X: Record<string, string> = {
  // Q913 (owner, 2026-10-07): the six admin fields listed here got a clear ✕
  // and joined the press spec.
  // Landing redesign (2026-10-20): the hero search is signed-out only (a signed-in
  // visitor is sent to /home) and both browser specs drive signed in, so it has
  // no ✕ to press yet; it filters nothing in place, it navigates on submit.
  // Q2242 (lead ruling, 2026-10-20): no ✕ — a submit box that navigates, not a live filter.
  "src/components/landing/HeroSection.tsx": "landing hero search: a submit box that navigates, not a live filter; no ✕ by decision (Q2242)",
  // TRAIN24 (2026-10-20): J1's Post a job screen 1 filters the category groups live with no ✕; open as Q2260.
  "src/components/postjob/JobCategoryGroups.tsx": "Post a job category search (J1 screen 1): live filter, no ✕ yet (Q2260)",
};

/** ✕ files that render ONLY below the desktop breakpoint, so the press spec
 * can drive them at 375 alone. Exact: a stale entry fails, and each one's
 * surface must say `maxWidth: 899`. */
// Empty since 2026-10-19: Jobs > Browse's phone-only compact row became the shared SectionSearchRow,
// whose ✕ is also pressed at 1440 (Declutter, Shops, Homes show it at every width).
const PHONE_ONLY: Record<string, string> = {};

/** ✕ files that render ONLY at the desktop breakpoint, so the press spec
 * drives them at 1440 alone. Exact: a stale entry fails, and each one's
 * surface must say `minWidth: 900`. */
const DESKTOP_ONLY: Record<string, string> = {
  // Q2205 (2026-10-19): the phone /home bar that also rendered BrowseSearchBar
  // left with the old Home feed; its one caller is Jobs > Browse's desktop feed
  // strip (Dashboard renders the strip only when isWebDesktop).
  "src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx": "desktop feed strip only; phone uses the compact row",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test") continue;
      out.push(...walk(p));
    } else if (name.endsWith(".tsx") && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
/** A `t("key")` call reads as its English words, so a field whose label moved into the dictionary (chat screens,
 * 10-30) is still seen as the search field it is. A key with no English stays as written. */
const english = en as Record<string, string>;
const withEnglish = (src: string) => src.replace(/\bt\("([\w.]+)"\)/g, (call, key: string) => (key in english ? JSON.stringify(english[key]) : call));
const sources = walk(SRC).map((p) => ({ file: rel(p), src: withEnglish(blankComments(readFileSync(p, "utf8"))) }));

/** The attribute text of each opening tag, braces balanced (JSX values hold `>`). */
function openingTags(src: string, names: string[]): { name: string; attrs: string }[] {
  const out: { name: string; attrs: string }[] = [];
  const re = new RegExp(`<(${names.join("|")})\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ name: m[1], attrs: src.slice(m.index + m[0].length, i) });
  }
  return out;
}

const isSearchField = (t: { name: string; attrs: string }) =>
  t.name === "CommandInput" ||
  /\btype="search"/.test(t.attrs) ||
  /\b(aria-label|placeholder)=\{?["`'][^"`']*\bsearch/i.test(t.attrs);

const SEARCH_FIELD_FILES = sources
  .filter((s) => openingTags(s.src, ["input", "Input", "CommandInput"]).some(isSearchField))
  .map((s) => s.file)
  .sort();
const X_FILES = sources
  .filter((s) => /"(Close|Clear) search"/.test(s.src))
  .map((s) => s.file)
  .sort();
/** ✕ files whose field OPENS (a "Close search" ✕ that leaves the search). A
 * file whose only ✕ is "Clear search" is a permanent field (Q913's admin
 * filter boxes): nothing opens, so there is no title for it to cover. */
const OPENING_X_FILES = sources
  .filter((s) => /"Close search"/.test(s.src))
  .map((s) => s.file)
  .sort();
const EXPANDING_CALLERS = sources
  .filter((s) => s.file !== "src/components/ui/ScreenHeaderRow.tsx" && /\bexpandingSearch=\{/.test(s.src))
  .map((s) => s.file)
  .sort();

type Surface = { name: string; file: string; minWidth?: number; maxWidth?: number };

/** The spec's SURFACES entries, each up to the next `name:`. */
function specSurfaces(spec: string): Surface[] {
  const src = blankComments(readFileSync(path.join(ROOT, spec), "utf8"));
  const start = src.indexOf("const SURFACES");
  expect(start, `${spec}: no SURFACES list`).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\n];", start));
  const chunks = body.split(/(?=\bname: ")/).slice(1);
  return chunks.map((c) => {
    const num = (k: string) => {
      const m = c.match(new RegExp(`\\b${k}: (\\d+)`));
      return m ? Number(m[1]) : undefined;
    };
    return {
      name: c.match(/^name: "([^"]+)"/)![1],
      file: c.match(/\bfile: "([^"]+)"/)?.[1] ?? "",
      minWidth: num("minWidth"),
      maxWidth: num("maxWidth"),
    };
  });
}

const runsAt = (s: Surface, vw: number) => (s.minWidth ?? 0) <= vw && (s.maxWidth ?? Infinity) >= vw;

function specRunsBothWidthsAndEngines(spec: string) {
  const src = blankComments(readFileSync(path.join(ROOT, spec), "utf8"));
  expect(src, `${spec} must loop both engines`).toMatch(/for \(const engine of \["chromium", "webkit"\]/);
  expect(src, `${spec} must loop 375 and 1440`).toMatch(/for \(const vw of \[375, 1440\]/);
}

describe("every search field is driven in a real browser (inventory minus checked = empty)", () => {
  it("the source inventory is what it is (exact counts, both directions)", () => {
    // Measured 2026-10-01: 12 search fields in 12 files; 6 render a ✕; 3
    // expanding header searches. Q913 (2026-10-07): all 12 render a ✕, 6 of
    // them (the admin boxes) a "Clear search" one on a permanent field.
    // +1 2026-10-19: Homes Browse's slim City or ZIP row (RentBrowse.tsx), a permanent field with a "Clear search" ✕.
    // 2026-10-19: +2, the section dashboards' permanent Browse rows (Jobs, Declutter).
    // 2026-10-19 (Q2205): -2, PostsHeader / JobsHeader left with the old My Posts / My Jobs pages.
    // 2026-10-19 (shared section shell): -2, the Jobs, Declutter and Homes Browse rows became ONE
    // shared SectionSearchRow (Shops' new search uses it too): 3 files out, 1 in.
    // 2026-10-20: +1, the landing's hero search (HeroSection, on NO_X).
    // 2026-10-20 (TRAIN24): +1, Post a job's category search (JobCategoryGroups, on NO_X, Q2260).
    // 2026-10-21: +1, /search (board 89, SearchPage), a permanent field with a "Clear search" ✕.
    // 2026-10-27: +1, Jobs > Posted / Working's in-place search (InlineListSearch), an opening field with a "Close search" ✕.
    expect(SEARCH_FIELD_FILES.length, SEARCH_FIELD_FILES.join("\n")).toBe(15);
    expect(X_FILES, "files rendering a search ✕").toEqual([
      "src/components/admin/AdminCommandPalette.tsx",
      "src/components/admin/AdminNotificationLogs.tsx",
      "src/components/admin/AdminReferrals.tsx",
      "src/components/admin/AdminSubscriptions.tsx",
      "src/components/admin/AdminUsers.tsx",
      "src/components/admin/settings/AdminUserSearchField.tsx",
      "src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx",
      "src/components/messages/ConversationList.tsx",
      "src/components/profile/SavedHelpersTab.tsx",
      "src/components/sections/InlineListSearch.tsx",
      "src/components/sections/SectionSearchRow.tsx",
      "src/pages/info/Legal.tsx",
      "src/pages/search/SearchPage.tsx",
    ]);
    expect(EXPANDING_CALLERS).toEqual([
      "src/components/messages/ConversationList.tsx",
    ]);
  });

  it("every file with a search ✕ also has a search field (no orphan ✕ the scan cannot see)", () => {
    expect(X_FILES.filter((f) => !SEARCH_FIELD_FILES.includes(f))).toEqual([]);
  });

  it("every search ✕ is pressed at 375 AND at 1440 by the press spec", () => {
    specRunsBothWidthsAndEngines(PRESS_SPEC);
    const surfaces = specSurfaces(PRESS_SPEC);
    expect(surfaces.length).toBeGreaterThanOrEqual(X_FILES.length);
    for (const s of surfaces) expect(s.file, `${PRESS_SPEC}: surface "${s.name}" names no existing file`).toSatisfy((f: string) => X_FILES.includes(f));
    const missing: string[] = [];
    for (const f of Object.keys(PHONE_ONLY)) {
      expect(X_FILES, `PHONE_ONLY entry ${f} renders no search ✕ — remove it`).toContain(f);
      const own = surfaces.filter((s) => s.file === f);
      expect(own.length, `${f}: no press-spec surface`).toBeGreaterThan(0);
      for (const s of own) expect(s.maxWidth, `${s.name}: a PHONE_ONLY surface must say maxWidth: 899`).toBe(899);
    }
    for (const f of Object.keys(DESKTOP_ONLY)) {
      expect(X_FILES, `DESKTOP_ONLY entry ${f} renders no search ✕ — remove it`).toContain(f);
      expect(PHONE_ONLY[f], `${f} cannot be both phone-only and desktop-only`).toBeUndefined();
      const own = surfaces.filter((s) => s.file === f);
      expect(own.length, `${f}: no press-spec surface`).toBeGreaterThan(0);
      for (const s of own) expect(s.minWidth, `${s.name}: a DESKTOP_ONLY surface must say minWidth: 900`).toBe(900);
    }
    for (const f of X_FILES) {
      for (const vw of PHONE_ONLY[f] ? [375] : DESKTOP_ONLY[f] ? [1440] : [375, 1440]) {
        if (!surfaces.some((s) => s.file === f && runsAt(s, vw))) missing.push(`${f} @${vw}`);
      }
    }
    expect(missing, `search ✕s the press spec never presses`).toEqual([]);
  });

  it("every opening search (✕ files and expanding header searches) is in the title spec", () => {
    specRunsBothWidthsAndEngines(TITLE_SPEC);
    const surfaces = specSurfaces(TITLE_SPEC);
    const files = new Set(surfaces.map((s) => s.file));
    const want = [...new Set([...OPENING_X_FILES, ...EXPANDING_CALLERS])].sort();
    expect(want.filter((f) => !files.has(f)), `searches the title spec never opens`).toEqual([]);
    expect([...files].filter((f) => !want.includes(f)), `title-spec surfaces naming a file with no opening search`).toEqual([]);
  });

  // Six before Q913; four since Q2205 (PostsHeader / JobsHeader left with the old My Posts / My Jobs pages);
  // five since 2026-10-27 (Jobs > Posted / Working's search opens in place: InlineListSearch).
  it("the opening searches are exactly these five (a permanent field is not one)", () => {
    expect(OPENING_X_FILES).toEqual([
      "src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx",
      "src/components/messages/ConversationList.tsx",
      "src/components/profile/SavedHelpersTab.tsx",
      "src/components/sections/InlineListSearch.tsx",
      "src/pages/info/Legal.tsx",
    ]);
  });

  it("every search field without a ✕ is accounted for, exactly", () => {
    const noX = SEARCH_FIELD_FILES.filter((f) => !X_FILES.includes(f));
    expect(noX).toEqual(Object.keys(NO_X).sort());
  });

  it("the native WebKit search ✕ stays hidden (else every type=search field grows an unchecked one)", () => {
    const css = blankComments(readFileSync(path.join(SRC, "index.css"), "utf8"));
    const m = css.match(/([^{}]*)\{([^{}]*)\}/g)?.find((r) => r.includes("::-webkit-search-cancel-button"));
    expect(m, "no rule targets ::-webkit-search-cancel-button").toBeDefined();
    expect(m!).toMatch(/display:\s*none/);
  });
});
