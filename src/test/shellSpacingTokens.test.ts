import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

/**
 * THE PAGE SHELLS SHARE ONE PHONE SPACING RHYTHM (Q176).
 *
 * Owner, 2026-09-23, with a 375px screenshot of the public /browse page: "Do
 * you think it's too much space above and below for phone width? If so fix
 * these page shells for public and authed so they are all consistent on phone
 * width." Measured on the built app against prod (every catalog route,
 * ~/.lh-shots/shell-spacing/before.json): public pages sat 28px under the nav
 * with 16 below the title, PageHeader pages 16/16, AuthShell 24/16, while
 * PageScaffold (Dashboard, My Jobs, Messages) was 12/12. Four shells, four
 * rhythms, because each typed its own literal.
 *
 * The fix is two CSS tokens in src/index.css — `--shell-gap` (12px) and
 * `--public-nav-h` (the marketing nav's bar height) — read by every shell. This
 * file proves the shells READ them (a literal creeping back is the drift); the
 * rendered numbers are proven by e2e/prod-audit/shell-spacing.spec.ts.
 */

const ROOT = process.cwd();
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

// Shown able to fail:
// @mutate src/components/PageHeader.tsx | : "pt-[var(--shell-gap)] pb-[var(--shell-gap)] sm:pt-6 sm:pb-6", | : "pt-4 pb-4 sm:pt-6 sm:pb-6",
// @mutate src/components/marketing/PublicLayout.tsx | 0.25rem) + var(--public-nav-h))" | 1.5rem) + 3rem)"
// @mutate src/components/ui/PageScaffold.tsx | gap-[var(--shell-gap)] lg:gap-4 | gap-3 lg:gap-4
// @mutate src/index.css | --shell-gap: 0.75rem; | --shell-gap: 1rem;
// @mutate src/components/auth/AuthShell.tsx | mb-[var(--shell-gap)] sm:mb-4 | mb-4

/** Each shell and the token usages it must carry (the oracle is the token, not this list). */
const SHELLS: { file: string; must: string[]; mustNot?: RegExp[] }[] = [
  {
    file: "src/components/PageHeader.tsx",
    must: [
      "pt-[calc(var(--safe-area-top,0px)+var(--shell-gap))]",
      "pb-[var(--shell-gap)] sm:pb-6",
      '"pt-[var(--shell-gap)] pb-[var(--shell-gap)] sm:pt-6 sm:pb-6"',
    ],
    // A phone literal back in the title padding is the drift itself.
    mustNot: [/"pt-4 pb-4/, /\+1rem\)\]/, /pb-4 sm:pb-6/],
  },
  {
    file: "src/components/ui/PageScaffold.tsx",
    must: ["pt-[var(--shell-gap)] lg:pt-5", "gap-[var(--shell-gap)] lg:gap-4"],
    mustNot: [/pt-3 lg:pt-5/, /gap-3 lg:gap-4/],
  },
  {
    file: "src/components/auth/AuthShell.tsx",
    must: ["pt-[calc(var(--safe-area-top,0px)_+_var(--shell-gap))]", "mb-[var(--shell-gap)] sm:mb-4"],
    mustNot: [/_\+_24px\)\] sm:pt-8/],
  },
  { file: "src/components/marketing/PublicLayout.tsx", must: ["var(--public-nav-h)"] },
  { file: "src/components/Navbar.tsx", must: ["h-[var(--public-nav-h)]"], mustNot: [/h-14 lg:h-16/] },
  // Skeletons mirror the shell they stand in for, or the swap jumps.
  { file: "src/components/SkeletonLoaders.tsx", must: ["pt-[var(--shell-gap)] pb-[var(--shell-gap)] sm:pt-6 sm:pb-6"] },
  { file: "src/components/LoginRouteSkeleton.tsx", must: ["pt-[calc(var(--safe-area-top,0px)_+_var(--shell-gap))]"] },
];

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("page shells share the phone spacing tokens (Q176)", () => {
  it("defines --shell-gap as 12px and --public-nav-h as the nav bar height, once each", () => {
    const css = blankComments(readFileSync(join(ROOT, "src/index.css"), "utf8"));
    const gaps = [...css.matchAll(/--shell-gap:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(gaps, "--shell-gap must be defined exactly once, at 0.75rem (12px)").toEqual(["0.75rem"]);
    const navs = [...css.matchAll(/--public-nav-h:\s*([^;]+);/g)].map((m) => m[1].trim());
    // h-14 on phone, h-16 from lg — the Navbar's own bar, unchanged.
    expect(navs).toEqual(["3.5rem", "4rem"]);
  });

  for (const s of SHELLS) {
    it(`${s.file} reads the shared tokens`, () => {
      const src = code(s.file);
      for (const m of s.must) expect(src, `${s.file} lost \`${m}\``).toContain(m);
      for (const re of s.mustNot ?? []) expect(src, `${s.file} is back on a hand-typed phone value ${re}`).not.toMatch(re);
    });
  }

  it("every nav spacer in src clears the Navbar with --public-nav-h, never a hand-typed height", () => {
    // Derived from the world: any inline `height: calc(max(var(--safe-area-top…` is a nav spacer.
    const spacers: string[] = [];
    const bad: string[] = [];
    for (const f of tsxFiles(join(ROOT, "src"))) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/height:\s*"calc\(max\(var\(--safe-area-top[^"]*"/g)) {
        spacers.push(relative(ROOT, f));
        if (!m[0].includes("var(--public-nav-h)")) bad.push(`${relative(ROOT, f)}: ${m[0]}`);
      }
    }
    expect(spacers.length, "no nav spacers found — the scan has rotted").toBeGreaterThanOrEqual(2);
    expect(bad).toEqual([]);
  });

  it("the token is read by at least as many shell sites as the fix put there", () => {
    let uses = 0;
    for (const f of tsxFiles(join(ROOT, "src/components"))) {
      uses += (blankComments(readFileSync(f, "utf8")).match(/var\(--shell-gap\)/g) ?? []).length;
    }
    expect(uses).toBeGreaterThanOrEqual(11);
  });
});
