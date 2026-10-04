/**
 * Q236(e): ONE page-title size everywhere, auth cards included (owner decision
 * 2026-09-27).
 *
 * The dominant page-title primitive is `.text-page-title` (src/index.css:
 * `font-size: var(--headline-hero)`), worn by PageHeader, ProfileTabHeader and
 * AppPage. Sites that keep their own face and colour take the SAME size
 * through `.text-headline-hero` (size only, the same --headline-hero token).
 * Before this, the auth card said 24px (text-ds-24), ScreenHeaderRow and the
 * admin headers said 20px (text-ds-20), and "Almost there." said up to 44px
 * (inline clamp), next to PageHeader's 22.4-24.8px.
 *
 * The inventory is DERIVED from the tree: every JSX `<h1 ...>` opening tag in
 * every non-test .tsx file under src, comments blanked. Each one must carry
 * `text-page-title`, `text-headline-hero` or `sr-only`, and no other size
 * (a `text-ds-N` / Tailwind `text-xl`-style size class, or an inline
 * `fontSize`). ScreenHeaderRow's visible title twins (the aria-hidden spans
 * that paint the name in search mode and for decorative skeleton titles) are
 * held to the same rule.
 *
 * @mutate src/components/auth/AuthShell.tsx | font-display italic font-bold text-headline-hero leading-tight truncate | font-display italic font-bold text-ds-24 leading-tight truncate
 * @mutate src/components/admin/AdminSectionHeader.tsx | leading-tight truncate text-headline-hero | leading-tight truncate text-ds-20
 * @mutate src/pages/auth/CompleteProfile.tsx | font-display italic font-bold text-headline-hero leading-tight mt-2 | font-display italic font-bold leading-tight mt-2
 * @mutate src/components/ui/ScreenHeaderRow.tsx | text-foreground text-headline-hero leading-none shrink-0 | text-foreground text-ds-20 leading-none shrink-0
 * @mutate src/components/dashboard/DashboardBlockedScreen.tsx | <h1 className="text-page-title text-foreground"> | <h1 className="text-page-title text-foreground text-ds-24">
 */
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "../..");

/** Exact exemptions, each with its reason. */
// @two-way src/test/pageTitleOneSize.test.ts:stale exemption
const EXEMPT: Record<string, string> = {
  // LOCKED landing hero (CLAUDE.md): font, colour and copy are off-limits.
  "src/components/landing/HeroSection.tsx": "locked landing hero",
  // The decorative "404" numeral, not a page title.
  "src/pages/info/NotFound.tsx": "decorative 404 numeral",
};

const TITLE_SIZE = /\b(text-page-title|text-headline-hero|sr-only)\b/;
const OTHER_SIZE = /\btext-ds-\d+\b|\btext-(xs|sm|base|lg|\d?xl)\b|\bfontSize\b|font-size/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : [];
  });
}

/** The JSX opening tag starting at `start` (`<h1`), up to its closing `>` outside braces. */
function openingTag(code: string, start: number): string {
  let depth = 0;
  for (let i = start + 3; i < code.length; i++) {
    const c = code[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return code.slice(start, i + 1);
  }
  return code.slice(start);
}

const files = walk(join(REPO, "src")).map((abs) => ({
  rel: relative(REPO, abs),
  code: blankComments(readFileSync(abs, "utf8")),
}));

const h1s = files.flatMap((f) =>
  [...f.code.matchAll(/<h1(?=[\s>])/g)].map((m) => ({
    rel: f.rel,
    line: f.code.slice(0, m.index).split("\n").length,
    tag: openingTag(f.code, m.index!),
  })),
);

describe("Q236(e): one page-title size", () => {
  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(h1s.length).toBeGreaterThan(20);
    for (const f of Object.keys(EXEMPT)) {
      expect(h1s.map((h) => h.rel), `exemption ${f} no longer has an h1 — drop it`).toContain(f);
    }
  });

  it("every exemption still needs its exemption", () => {
    const offSize = (h: { tag: string }) => !TITLE_SIZE.test(h.tag) || OTHER_SIZE.test(h.tag);
    const stale = Object.keys(EXEMPT).filter((f) => !h1s.some((h) => h.rel === f && offSize(h)));
    expect(stale.map((f) => `stale exemption ${f}: its h1 already wears the title size — remove it`)).toEqual([]);
  });

  it("every <h1> wears the one title size and no other", () => {
    const bad = h1s
      .filter((h) => !EXEMPT[h.rel])
      .filter((h) => !TITLE_SIZE.test(h.tag) || OTHER_SIZE.test(h.tag))
      .map((h) => `${h.rel}:${h.line} ${h.tag.replace(/\s+/g, " ").slice(0, 160)}`);
    expect(bad).toEqual([]);
  });

  it("ScreenHeaderRow's visible title twins wear the same size", () => {
    const src = files.find((f) => f.rel === "src/components/ui/ScreenHeaderRow.tsx")!.code;
    const titleClasses = [...src.matchAll(/"font-display[^"]*"/g)].map((m) => m[0]);
    // the h1, its decorative span twin, and the search-mode span
    expect(titleClasses.length).toBe(3);
    for (const c of titleClasses) {
      expect(c).toMatch(/\btext-headline-hero\b/);
      expect(c).not.toMatch(OTHER_SIZE);
    }
  });
});
