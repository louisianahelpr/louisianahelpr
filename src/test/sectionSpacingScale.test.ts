import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

/**
 * PAGES DO NOT TYPE THEIR OWN SECTION GAP (Q191).
 *
 * Owner, 2026-09-23: "update the spacing on every other phone width. Like all
 * the profile tabs everything that you think needs to be tighter. Also make
 * sure nothing is hand rolled. Most things should use the same component or
 * shell." Q176 put the SHELL gaps (header → title → first content) on
 * `--shell-gap`. Below the title every page still typed its own gap between
 * its sections, so equivalent screens sat 16, 20 or 24px apart on a 375 phone
 * (measured on the built app against prod, ~/.lh-shots/q191/before.json):
 * Profile tabs 16 (ProfileTabBody's `space-y-4`), Work Record / Home History /
 * After a Job / Payment 20 (`space-y-5`), Gift Card / Help / Post a Job 24
 * (`space-y-6`), a public profile 24 (`gap-6`).
 *
 * The fix is ONE token, `--section-gap` (12px on a phone, 16px from `sm`), read
 * through Tailwind's `section` spacing key (`space-y-section`, `gap-section`)
 * and ProfileTabBody. This file proves the scale exists and that no page in
 * scope types a section-sized gap (>= 20px: space-y-5+, gap-5+) outside the
 * exact list of justified exceptions below. The rendered gaps are proven by
 * e2e/prod-audit/shell-spacing.spec.ts ("every page's sections sit
 * --section-gap apart").
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Shown able to fail on the original defect (the page gaps this fix removed)
// and on the scale itself:
// @mutate src/pages/GiftCard.tsx | <aside className="space-y-section"> | <aside className="space-y-6">
// @mutate src/pages/WorkRecord.tsx | <div className="space-y-section"> | <div className="space-y-5">
// @mutate src/components/profile/ProfileTabBody.tsx | export const PROFILE_TAB_BODY_CLASS = "space-y-section"; | export const PROFILE_TAB_BODY_CLASS = "space-y-4";
// @mutate src/index.css | --section-gap: 0.75rem; | --section-gap: 1.25rem;
// @mutate tailwind.config.ts | section: "var(--section-gap)", | section: "1.25rem",

function tsxUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) tsxUnder(rel, out);
    else if (name.endsWith(".tsx") && !/\.test\.tsx$/.test(name)) out.push(rel);
  }
  return out;
}

/**
 * The files whose layout is a PAGE's: every page, every Profile tab
 * component, and every module Profile renders a tab from (read from
 * ProfileTabPanels' own lazy imports, so a new tab is scanned the day it is
 * added). PaymentTab is the Earnings tab's body, one import further down.
 */
function pageFiles(): string[] {
  const set = new Set([...tsxUnder("src/pages"), ...tsxUnder("src/components/profile")]);
  for (const m of read("src/pages/profile/ProfileTabPanels.tsx").matchAll(/import\("@\/([^"]+)"\)/g)) {
    const rel = `src/${m[1]}.tsx`;
    if (existsSync(join(ROOT, rel))) set.add(rel);
  }
  set.add("src/components/PaymentTab.tsx");
  return [...set].sort();
}

/** A section-sized gap: 20px or more, as a stack (`space-y`) or flex/grid gap. */
const SECTION_SIZED = /(?<![\w-])((?:[\w[\]-]+:)*)(space-y|gap-y|gap)-(\d+)(?![\w.])/g;

function sectionSizedIn(rel: string): string[] {
  const src = blankComments(read(rel));
  const hits: string[] = [];
  for (const m of src.matchAll(SECTION_SIZED)) if (Number(m[3]) >= 5) hits.push(m[0]);
  return hits;
}

/**
 * Every section-sized gap that is NOT a page's section stack, by exact count
 * (two-way: a file that drops one fails until its count here drops with it).
 */
// @two-way src/test/sectionSpacingScale.test.ts:A file whose count DROPPED must lower its entry
const ALLOWED: Record<string, { n: number; why: string }> = {
  // Horizontal gaps inside a row, not a vertical rhythm.
  "src/components/NotificationPreferences.tsx": { n: 6, why: "gap between the per-channel toggle columns of a row (horizontal)" },
  "src/pages/HelpCenter.tsx": { n: 1, why: "gap between an FAQ question and its chevron (horizontal)" },
  "src/components/profile/ScheduleTab.tsx": { n: 1, why: "min-[1024px]:gap-6 — the desktop two-column gap between calendar and list, not the phone stack" },
  // AuthShell card forms: one form rhythm shared by every auth card, inside the card.
  "src/pages/Login.tsx": { n: 8, why: "AuthShell card form rhythm + the lg two-panel split" },
  "src/pages/signup/SignupStep1.tsx": { n: 7, why: "AuthShell card form rhythm + the lg two-panel split" },
  "src/pages/signup/SignupStep2.tsx": { n: 1, why: "AuthShell card form rhythm" },
  "src/pages/Signup.tsx": { n: 1, why: "AuthShell card form rhythm" },
  "src/pages/ForgotPassword.tsx": { n: 1, why: "AuthShell card form rhythm" },
  "src/pages/ResetPassword.tsx": { n: 1, why: "AuthShell card form rhythm" },
  "src/pages/SignupPending.tsx": { n: 1, why: "AuthShell card rhythm" },
  "src/pages/AccountBanned.tsx": { n: 1, why: "AuthShell card rhythm" },
  "src/pages/CompleteProfile.tsx": { n: 1, why: "the profile-completion card's own field rhythm" },
  // Centred compositions with no title row (NOT_A_TITLE_ROW in shell-spacing.spec).
  "src/pages/NotFound.tsx": { n: 1, why: "centred 404 composition" },
  "src/pages/PaymentSuccess.tsx": { n: 1, why: "centred payment-return composition" },
  // Field rhythm INSIDE one padded card, not gaps between a page's sections.
  "src/pages/petProfiles/PetDetail.tsx": { n: 1, why: "inside the pet detail card" },
  "src/pages/petProfiles/PetForm.tsx": { n: 2, why: "inside the pet form card" },
  "src/pages/Support.tsx": { n: 1, why: "inside the contact form card" },
};

describe("one in-page section scale (Q191)", () => {
  it("defines --section-gap as 12px on a phone and 16px from sm, once each", () => {
    const css = blankComments(read("src/index.css"));
    const vals = [...css.matchAll(/--section-gap:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(vals, "--section-gap: 0.75rem (phone), then 1rem inside the sm media query").toEqual(["0.75rem", "1rem"]);
    expect(css).toMatch(/@media \(min-width: 640px\) \{\s*:root \{\s*--section-gap: 1rem;/);
  });

  it("Tailwind's `section` spacing key reads the token", () => {
    expect(blankComments(read("tailwind.config.ts"))).toContain('section: "var(--section-gap)",');
  });

  it("the Profile tab body and its header read the token", () => {
    expect(blankComments(read("src/components/profile/ProfileTabBody.tsx"))).toContain('PROFILE_TAB_BODY_CLASS = "space-y-section"');
    expect(blankComments(read("src/components/profile/ProfileTabHeader.tsx"))).toContain('"-mb-[var(--section-gap)]"');
  });

  it("no page types a section-sized gap outside the justified list (exact, two-way)", () => {
    const files = pageFiles();
    expect(files.length, "page scan came back short — it has rotted").toBeGreaterThan(80);
    const found: Record<string, number> = {};
    for (const f of files) {
      const hits = sectionSizedIn(f);
      if (hits.length) found[relative(ROOT, join(ROOT, f))] = hits.length;
    }
    const want = Object.fromEntries(Object.entries(ALLOWED).map(([f, v]) => [f, v.n]));
    expect(
      found,
      "A page set its own >=20px section gap. Use the shared scale (`space-y-section` / `gap-section`, " +
        "--section-gap: 12px phone, 16px sm+) — or, if it is genuinely not a section gap (a horizontal row, " +
        "a card's own fields), list it in ALLOWED with why. A file whose count DROPPED must lower its entry.",
    ).toEqual(want);
  });

  it("the scale is actually used across pages (floor)", () => {
    let users = 0;
    for (const f of pageFiles()) if (/\b(space-y|gap)-section\b/.test(blankComments(read(f)))) users++;
    expect(users).toBeGreaterThanOrEqual(15);
  });
});
