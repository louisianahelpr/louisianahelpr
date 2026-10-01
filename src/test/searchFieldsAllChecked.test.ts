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
// @mutate e2e/prod-audit/search-x-off-center-press.spec.ts | maxWidth: 899, | minWidth: 900,
// @mutate e2e/prod-audit/search-x-off-center-press.spec.ts | name: "legal", file: "src/pages/info/Legal.tsx", | name: "legal", file: "src/pages/info/Legal.ts",
// @mutate e2e/prod-audit/search-keeps-title.spec.ts | name: "jobs", file: "src/pages/jobs/JobsHeader.tsx", | name: "jobs", file: "src/pages/jobs/Jobs.tsx",
// @mutate src/index.css | input[type="search"]::-webkit-search-cancel-button, | input[type="search"]::-webkit-search-cancelled,
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");
const PRESS_SPEC = "e2e/prod-audit/search-x-off-center-press.spec.ts";
const TITLE_SPEC = "e2e/prod-audit/search-keeps-title.spec.ts";

/** Search fields that render no ✕ of their own, and why that is fine. Exact:
 * a stale entry fails, and so does a new ✕-less field missing from here. */
const NO_X: Record<string, string> = {
  "src/components/admin/AdminCommandPalette.tsx": "cmdk palette; Escape closes the dialog, no clear button",
  "src/components/admin/AdminNotificationLogs.tsx": "admin filter box, always open; select-all + delete clears",
  "src/components/admin/AdminReferrals.tsx": "admin filter box, always open; select-all + delete clears",
  "src/components/admin/AdminSettings.tsx": "admin user lookup, always open; select-all + delete clears",
  "src/components/admin/AdminSubscriptions.tsx": "admin filter box, always open; select-all + delete clears",
  "src/components/admin/AdminUsers.tsx": "admin filter box, always open; select-all + delete clears",
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
const sources = walk(SRC).map((p) => ({ file: rel(p), src: blankComments(readFileSync(p, "utf8")) }));

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
    // Measured 2026-10-01: 12 search fields in 12 files; 6 render a ✕; 3 expanding header searches.
    expect(SEARCH_FIELD_FILES.length, SEARCH_FIELD_FILES.join("\n")).toBe(12);
    expect(X_FILES, "files rendering a search ✕").toEqual([
      "src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx",
      "src/components/messages/ConversationList.tsx",
      "src/components/profile/SavedHelpersTab.tsx",
      "src/pages/info/Legal.tsx",
      "src/pages/jobs/JobsHeader.tsx",
      "src/pages/posts/PostsHeader.tsx",
    ]);
    expect(EXPANDING_CALLERS).toEqual([
      "src/components/messages/ConversationList.tsx",
      "src/pages/jobs/JobsHeader.tsx",
      "src/pages/posts/PostsHeader.tsx",
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
    for (const f of X_FILES) {
      for (const vw of [375, 1440]) {
        if (!surfaces.some((s) => s.file === f && runsAt(s, vw))) missing.push(`${f} @${vw}`);
      }
    }
    expect(missing, `search ✕s the press spec never presses`).toEqual([]);
  });

  it("every opening search (✕ files and expanding header searches) is in the title spec", () => {
    specRunsBothWidthsAndEngines(TITLE_SPEC);
    const surfaces = specSurfaces(TITLE_SPEC);
    const files = new Set(surfaces.map((s) => s.file));
    const want = [...new Set([...X_FILES, ...EXPANDING_CALLERS])].sort();
    expect(want.filter((f) => !files.has(f)), `searches the title spec never opens`).toEqual([]);
    expect([...files].filter((f) => !want.includes(f)), `title-spec surfaces naming a file with no opening search`).toEqual([]);
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
