/**
 * THE REDESIGNED LANDING TELLS THE TRUTH (owner-approved redesign, 2026-10-20;
 * the lead's binding honesty fixes in LANDING-APPROVED.md). Each rule below is
 * one of those fixes, checked against the code that makes it true:
 *   - the seasonal pill follows the month (never a stale season);
 *   - the hero search really searches (owner, 2026-10-20: "search all four"):
 *     the words reach the Jobs feed's own `q` filter, the public board when
 *     signed out and Jobs > Browse when signed in (Jobs is the only section
 *     open to everyone today);
 *   - the task chips carry no prices (no real completed-job data behind them yet);
 *   - the hero has NO phone mock and is one centered column (owner, 2026-10-20,
 *     after seeing the mock live; it once had to "leave Marie off the phone");
 *   - the money band's hours are the cron's own number, never typed;
 *   - no price-drop timing is claimed for Declutter;
 *   - "Continue with Apple" sits behind the one social switch and loads lazily;
 *   - the nav shows Declutter only once its switch is open to everyone.
 *
 * @mutate src/components/landing/seasonalPill.ts |   if (month >= 5 && month <= 10) return | if (month >= 4 && month <= 10) return
 * @mutate src/components/landing/heroSearch.ts |   return { signedIn: q ? `/search${qs}` : "/jobs", signedOut: `/browse${qs}` }; |   return { signedIn: "/jobs", signedOut: "/signup" };
 * @mutate src/components/landing/HeroSection.tsx |     const t = heroSearchTargets(query); |     const t = heroSearchTargets("");
 * @mutate src/components/landing/SectionsShowcase.tsx | "Helpr holds the money. Nobody is paid out until the work is done." | "Held through Stripe. Nobody is paid out until the work is done."
 * @mutate src/components/landing/LandingAppleButton.tsx |   if (!SOCIAL_SIGN_IN_ENABLED) return null; |
 * @mutate src/components/Navbar.tsx |   const declutterOpen = !sectionIsComingSoon("declutter", open); |   const declutterOpen = true;
 * @mutate src/components/landing/HeroSection.tsx | className="flex flex-col items-center text-center gap-5 sm:gap-6 min-w-0" | className="flex flex-col items-start gap-5 sm:gap-6 min-w-0"
 * @mutate src/components/landing/HeroSection.tsx | <div className="relative mx-auto w-full max-w-[760px]"> | <div className="relative mx-auto w-full max-w-6xl">
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { seasonalPill } from "@/components/landing/seasonalPill";
import { heroSearchTargets, SEARCH_MAX, SEARCH_PARAM, TASK_CHIPS } from "@/components/landing/heroSearch";

const ROOT = process.cwd();
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("landing redesign: the honesty fixes hold", () => {
  it("the seasonal pill follows the month: storm season is exactly June through November", () => {
    const months = Array.from({ length: 12 }, (_, m) => seasonalPill(m));
    const storm = months.map((p, m) => (p.startsWith("Storm season") ? m : -1)).filter((m) => m >= 0);
    expect(storm).toEqual([5, 6, 7, 8, 9, 10]);
    // Every month has a pill, and the hero reads it from today's date.
    expect(months.every((p) => p.length > 10)).toBe(true);
    expect(read("src/components/landing/HeroSection.tsx")).toMatch(/seasonalPill\(new Date\(\)\.getMonth\(\)\)/);
  });

  it("the search reaches the Jobs feed's own q filter: public board signed out, Jobs > Browse signed in", () => {
    const t = heroSearchTargets("  Mow   the lawn & trim ");
    expect(t.signedOut).toBe("/browse?q=Mow+the+lawn+%26+trim");
    expect(t.signedIn).toBe("/search?q=Mow+the+lawn+%26+trim");
    // The pages read it back exactly (useDashboardFilters: param("q")).
    expect(new URLSearchParams(t.signedOut.split("?")[1]).get(SEARCH_PARAM)).toBe("Mow the lawn & trim");
    expect(read("src/hooks/useDashboardFilters.ts")).toMatch(/useState\(\(\) => param\("q"\)\)/);
    // /browse is the guest feed and /jobs embeds the signed-in feed, both on those filters.
    expect(read("src/pages/home/DashboardGuest.tsx")).toMatch(/useDashboardFilters\(/);
    expect(read("src/pages/jobs/JobsSection.tsx")).toMatch(/<Dashboard embeddedHeader=\{header\} \/>/);
    // Empty search: the plain feed, no empty q; long input is capped.
    expect(heroSearchTargets("   ")).toEqual({ signedIn: "/jobs", signedOut: "/browse" });
    expect(new URLSearchParams(heroSearchTargets("x".repeat(200)).signedOut.split("?")[1]).get("q")?.length).toBe(SEARCH_MAX);
    // The hero submits through it, with the session check, under the owner's words.
    const hero = read("src/components/landing/HeroSection.tsx");
    expect(hero).toMatch(/const t = heroSearchTargets\(query\);\s*void goSignedInOr\(navigate, t\.signedIn, t\.signedOut\);/);
    // Signed out it searches Jobs only, so it promises nothing else (owner 2026-10-21).
    expect(hero).toMatch(/placeholder="Search local jobs"/);
    expect(hero).not.toMatch(/items, shops and homes/);
  });

  it("the chips are task names only: no price anywhere in the hero", () => {
    expect(TASK_CHIPS.length).toBeGreaterThan(2);
    for (const c of TASK_CHIPS) expect(c, c).not.toMatch(/\$|\d/);
    const hero = read("src/components/landing/HeroSection.tsx");
    expect(hero).not.toMatch(/\$\d|Typical prices/);
  });

  it("the hero has no phone mock and is ONE centered column, max 760px (owner, 2026-10-20)", () => {
    // The HTML phone mock is gone, not hidden: a real screenshot of the new Home replaces it later.
    expect(existsSync(join(ROOT, "src/components/landing/PhoneMock.tsx"))).toBe(false);
    const hero = read("src/components/landing/HeroSection.tsx");
    expect(hero).not.toMatch(/PhoneMock|grid-cols/);
    expect(hero).toMatch(/<div className="relative mx-auto w-full max-w-\[760px\]">/);
    const column = hero.match(/data-testid="landing-hero-column" className="([^"]*)"/);
    expect(column, "the hero column").not.toBeNull();
    expect(column![1]).toMatch(/\bitems-center\b/);
    expect(column![1]).toMatch(/\btext-center\b/);
    // The chips centre with it.
    expect(hero).toMatch(/<ul className="flex flex-wrap justify-center gap-2/);
  });

  it("the money band's hours are the cron's number, and Declutter claims no price-drop timing", () => {
    const blocks = read("src/components/landing/SectionsShowcase.tsx");
    expect(blocks).toMatch(/import \{ AUTO_COMPLETE_HOURS \} from "\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/escrowTiming";/);
    expect(blocks).toMatch(/\$\{AUTO_COMPLETE_HOURS\} hours/);
    expect(blocks).not.toMatch(/\b\d+ hours\b/);
    expect(blocks).not.toMatch(/each evening|every evening|drop each/i);
  });

  it("no other company or vendor named in the landing's copy (design spec v2 §1.7; Apple only as the sign-in provider)", () => {
    const files = ["HeroSection.tsx", "SectionsShowcase.tsx", "HowItWorksSection.tsx", "seasonalPill.ts", "heroSearch.ts"].map((f) => `src/components/landing/${f}`);
    expect(files.length).toBeGreaterThan(4);
    for (const f of files) expect(read(f), f).not.toMatch(/\bStripe\b|\bUSPS\b|Instead of/);
  });

  it("Continue with Apple sits behind the one social switch and loads only when the close is on screen", () => {
    const apple = read("src/components/landing/LandingAppleButton.tsx");
    expect(apple).toMatch(/if \(!SOCIAL_SIGN_IN_ENABLED\) return null;/);
    const blocks = read("src/components/landing/SectionsShowcase.tsx");
    expect(blocks).toMatch(/const LandingAppleButton = lazy\(\(\) => import\("\.\/LandingAppleButton"\)\);/);
    expect(blocks).toMatch(/\{joinSeen && \(\s*<Suspense fallback=\{null\}>\s*<LandingAppleButton \/>/);
    // Never a static import: socialAuth pulls Supabase into the landing's first paint.
    expect(blocks).not.toMatch(/from "@\/lib\/socialAuth"/);
  });

  it("the landing nav shows Declutter only once its switch is open to everyone (fails closed)", () => {
    const nav = read("src/components/Navbar.tsx");
    expect(nav).toMatch(/const declutterOpen = !sectionIsComingSoon\("declutter", open\);/);
    // Only the landing bar reads it: every other public page's bar stays free of React Query.
    expect(nav).toMatch(/\{landing && <LandingNavLinks \/>\}/);
    expect(nav).toMatch(/\{declutterOpen && \(/);
  });
});
