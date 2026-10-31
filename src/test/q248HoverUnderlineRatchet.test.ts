// PROVEN ABLE TO FAIL: adding one more raw `hover:underline` anywhere under
// src/**/*.tsx, or dropping one without lowering HOVER_UNDERLINE_SITE_COUNT
// below, turns this red in both directions.
// @mutate src/components/AttachmentLink.tsx | text-primary hover:underline | text-primary hover:underline hover:underline

/**
 * Q248(b): 36 hand-rolled `hover:underline` sites vs. the 4 files that use
 * the shared `.link-standard` class (src/index.css) — the ONE canonical
 * text-link affordance (spring-eased underline reveal + focus ring + a
 * pointer-coarse 44px hit target). Migrating all 36 was judged not mechanical
 * (each site has its own surrounding markup/typography), so this is an
 * EXACT, two-way count: it fails if a new hand-rolled site appears, and it
 * fails if the count drops without this baseline being lowered in the same
 * commit (CLAUDE.md "every number we track stays current").
 *
 * Measured 2026-09-24: `grep -rn "hover:underline" src --include="*.tsx" | wc -l` → 35 (36 on 09-23; PublicReviewWall deleted, Q364)
 * Measured 2026-09-23: `grep -rl "link-standard" src --include="*.tsx" | wc -l` → 4
 * Measured 2026-10-05: same grep → 5 (TurnstileField Retry, Q1314)
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

function tsxFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

const HOVER_UNDERLINE_SITE_COUNT = 34; // 34 on 2026-10-23: -1, the landing hero's "Browse local jobs" link moved to the Live now section, which uses .link-standard (option B, lead); 35 on 2026-10-21: -1, ReportDialog's "Change" link (board 157 puts reason and details on one screen, builder1g); 36 on 2026-10-20: -1, IdentityHeader deleted (board 18 YouCard, builder1f); 37 on 2026-10-20: -2, the landing redesign (the close's "Create your free account" became its primary button and its Log in link a plain underline); 39 on 2026-10-19: +1, Homes "Leave this home" quiet text action (EndTenancyButton, homes rent/deposit polish); 38 earlier that day: +4, the new landing page's text links (SectionsShowcase x3, HeroSection "Log in"), dashboards-landing-1019
const LINK_STANDARD_FILE_COUNT = 21; // 21 on 2026-10-31 (B29 OPS-4): the town pages' "More near you" links (HireTownPage) use the standard (20 on 2026-10-31 (B12 AUD31-16): Login's Create an account in a Declutter bounce notice (Login) uses the standard (19 on 2026-10-31 (B71 BUY-12): the cart hold line's "See their other items" link (DeclutterReserveSheet) uses the standard (18 on 2026-10-30 (B93 DB-13, counted by B96): a Declutter receipt's "See the order" link (Receipts) uses the standard (17 on 2026-10-30 (B63 Spanish, lander 13): the English / Español switch (LanguageToggle) uses the standard instead of a raw hover:underline (16 on 2026-10-29 (B59): the Helpr Guarantee card's "How it works" link (GuaranteePromise) uses the standard (15 on 2026-10-28 (audit P5-11, b8): the legal tax-guidance line (LegalChrome) and Admin's tax card source link (TaxReserveCard) use the standard (13 on 2026-10-28 (deep audit #30): Selling's "Show N closed offers" toggle uses the standard (12 on 2026-10-28 (declutter-audit): Declutter Browse's "Can't find it? Post what you're looking for" link uses the standard (11 on 2026-10-23 (ui5, card critique item 13): the card face's small "Manage job" link (MineJobFace) uses the standard (10 on 2026-10-23: LiveJobsSection's two "Browse local jobs" links use the standard (landing option B, lead) (9 on 2026-10-21 (builder2g, one job tracker): the job card's 8-icon stepper and its tooltip links left with the stepper (10 on 2026-10-19 (declutter-design): the Declutter item page's "See the seller" text link became the seller card, so it no longer uses the standard (11 earlier on 2026-10-19: the public shop page's "Sign in" link uses the standard, not a raw hover:underline (10 on 2026-10-16: the Declutter Wanted view's match links use the standard (9 on 2026-10-15: "Suggest a category" (SuggestCategory.tsx) uses the standard, not a raw hover:underline (8 on 2026-10-14: the Declutter item page's "See the seller" link uses the standard, not a raw hover:underline) (7 on 2026-10-12: the admin Sign-up leads card's "Show all" uses the standard, not a raw hover:underline (6 on 2026-10-07: HelpCenter's "Report a bug", Q1028))))))))))))))))

describe("Q248(b): hover:underline vs the shared link-standard", () => {
  const files = tsxFiles();

  it("finds a real corpus of .tsx files to scan", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("exactly 35 hand-rolled hover:underline sites (raise or lower this baseline in the same commit as any change)", () => {
    let hits = 0;
    for (const f of files) {
      const src = readFileSync(resolve(ROOT, f), "utf8");
      hits += (src.match(/hover:underline/g) ?? []).length;
    }
    expect(hits).toBe(HOVER_UNDERLINE_SITE_COUNT);
  });

  it("exactly 8 files on the shared link-standard (raise or lower this baseline in the same commit as any change)", () => {
    const onStandard = files.filter((f) => readFileSync(resolve(ROOT, f), "utf8").includes("link-standard"));
    expect(onStandard.length).toBe(LINK_STANDARD_FILE_COUNT);
  });
});
