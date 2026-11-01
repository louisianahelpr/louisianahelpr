/**
 * THE REDESIGNED LANDING TELLS THE TRUTH (owner-approved redesign, 2026-10-20;
 * the lead's binding honesty fixes in LANDING-APPROVED.md). Each rule below is
 * one of those fixes, checked against the code that makes it true:
 *   - no seasonal pill and no example chips (owner, 2026-10-23: removed);
 *   - the hero search really searches (owner, 2026-10-20: "search all four"):
 *     the words reach the Jobs feed's own `q` filter, the public board when
 *     signed out and Jobs > Browse when signed in (Jobs is the only section
 *     open to everyone today);
 *   - the hero's only price is the proof row's dated, checked $20 tip (LandingProof);
 *   - the hero has NO phone mock and is one centered column (owner, 2026-10-20,
 *     after seeing the mock live; it once had to "leave Marie off the phone");
 *   - the money band's hours are the cron's own number, never typed;
 *   - no price-drop timing is claimed for Declutter;
 *   - "Continue with Apple" sits behind the one social switch and loads lazily;
 *   - the landing's top bar is the one public bar, "Jobs | Log in · Join free"
 *     (owner, 2026-10-21): no Declutter link, no "How it works", no sections
 *     read of its own.
 *
 * @mutate src/components/landing/heroSearch.ts |   return { signedIn: q ? `/search${qs}` : "/jobs", signedOut: `/browse${qs}` }; |   return { signedIn: "/jobs", signedOut: "/signup" };
 * @mutate src/components/landing/HeroSection.tsx |     const t = heroSearchTargets(query); |     const t = heroSearchTargets("");
 * @mutate src/components/landing/SectionsShowcase.tsx | "Helpr holds the money. Nobody is paid out until the work is done." | "Held through Stripe. Nobody is paid out until the work is done."
 * @mutate src/components/landing/LandingAppleButton.tsx |   if (!SOCIAL_SIGN_IN_ENABLED) return null; |
 * @mutate src/components/Navbar.tsx |         {!user && ( |         {landing && <Link to="/signup?redirect=%2Fdeclutter">Declutter</Link>}\n        {!user && (
 * @mutate src/components/landing/HeroSection.tsx | className="flex flex-col items-center text-center min-w-0" | className="flex flex-col items-start min-w-0"
 * @mutate src/components/landing/HeroSection.tsx |       <LandingProof />\n | \n
 * @mutate src/components/landing/LiveJobsSection.tsx |           .from("open_jobs_browse") |           .from("jobs")
 * @mutate src/components/landing/LiveJobsSection.tsx |   if (j.pricing_mode === "quotes") return "Get quotes"; |
 * @mutate src/components/landing/HeroSection.tsx | <div className="relative mx-auto w-full max-w-[760px]"> | <div className="relative mx-auto w-full max-w-6xl">
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { heroSearchTargets, SEARCH_MAX, SEARCH_PARAM } from "@/components/landing/heroSearch";
import { liveJobDate, liveJobPrice } from "@/components/landing/LiveJobsSection";

const ROOT = process.cwd();
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("landing redesign: the honesty fixes hold", () => {
  it("no seasonal pill and no example chips (owner, 2026-10-23)", () => {
    expect(existsSync(join(ROOT, "src/components/landing/seasonalPill.ts"))).toBe(false);
    const hero = read("src/components/landing/HeroSection.tsx");
    expect(hero).not.toMatch(/seasonalPill|TASK_CHIPS|Popular searches|landing-chip/);
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
    expect(read("src/pages/jobs/JobsSection.tsx")).toMatch(/<Dashboard embeddedHeader=\{makeHeader\} \/>/);
    // Empty search: the plain feed, no empty q; long input is capped.
    expect(heroSearchTargets("   ")).toEqual({ signedIn: "/jobs", signedOut: "/browse" });
    expect(new URLSearchParams(heroSearchTargets("x".repeat(200)).signedOut.split("?")[1]).get("q")?.length).toBe(SEARCH_MAX);
    // The hero submits through it, with the session check, under the owner's words.
    const hero = read("src/components/landing/HeroSection.tsx");
    expect(hero).toMatch(/const t = heroSearchTargets\(query\);\s*void goSignedInOr\(navigate, t\.signedIn, t\.signedOut\);/);
    // Signed out it searches Jobs only, so it promises nothing else (owner 2026-10-21).
    expect(hero).toContain(`placeholder={es ? es.searchLabel : "Search local jobs"}`);
    expect(hero).not.toMatch(/items, shops and homes/);
  });

  it("the hero shows the proof row, and its only price is the checked tip", () => {
    const hero = read("src/components/landing/HeroSection.tsx");
    expect(hero).toMatch(/<LandingProof \/>/);
    expect(hero).not.toMatch(/\$\d|Typical prices/);
    const proof = read("src/components/landing/LandingProof.tsx");
    expect(proof.match(/\$\d+/g)).toEqual(["$20"]);
    // Never "every member is verified": browsing and applying are not ID-gated.
    expect(proof).not.toMatch(/every member/i);
  });

  it("Live now shows real open jobs: the public board's own view, fetched late, nothing typed (owner, 2026-10-23)", () => {
    const live = read("src/components/landing/LiveJobsSection.tsx");
    // The same view the public board reads (it drops seed, ownerless and closed jobs).
    expect(live).toMatch(/\.from\("open_jobs_browse"\)/);
    expect(live).not.toMatch(/\.from\("jobs"\)/);
    // Never a static Supabase import: the chunk stays out of the landing's first paint.
    expect(live).not.toMatch(/^import .*supabase/m);
    expect(live).toMatch(/await import\("@\/integrations\/supabase\/client"\)/);
    // No job, price or count typed into the page.
    expect(live).not.toMatch(/\$\d/);
    // A failed read is said, never an empty-looking section.
    expect(live).toMatch(/data-testid="landing-live-jobs-failed"/);
    // It sits right under the hero.
    const index = read("src/pages/info/Index.tsx");
    expect(index.indexOf("<LiveJobsSection />")).toBeGreaterThan(index.indexOf("<HeroSection />"));
    expect(index.indexOf("<LiveJobsSection />")).toBeLessThan(index.indexOf("<SectionsShowcase />"));
    // Price and date read the row as it is: quotes jobs have no price; a date never shifts a day.
    expect(liveJobPrice({ budget: "75.00", pricing_mode: "set_price" })).toBe("$75");
    expect(liveJobPrice({ budget: "12.50", pricing_mode: "set_price" })).toBe("$12.50");
    expect(liveJobPrice({ budget: "75.00", pricing_mode: "quotes" })).toBe("Get quotes");
    expect(liveJobDate("2026-10-24")).toBe("Sat, Oct 24");
    expect(liveJobDate(null)).toBeNull();
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
  });

  it("the money band's hours are the cron's number, and Declutter claims no price-drop timing", () => {
    const blocks = read("src/components/landing/SectionsShowcase.tsx");
    expect(blocks).toMatch(/import \{ APPROVAL_WINDOW_HOURS \} from "\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/escrowTiming";/);
    expect(blocks).toMatch(/\$\{APPROVAL_WINDOW_HOURS\} hours/);
    expect(blocks).not.toMatch(/\b\d+ hours\b/);
    expect(blocks).not.toMatch(/each evening|every evening|drop each/i);
  });

  it("no other company or vendor named in the landing's copy (design spec v2 §1.7; Apple only as the sign-in provider)", () => {
    const files = ["HeroSection.tsx", "SectionsShowcase.tsx", "HowItWorksSection.tsx", "LandingProof.tsx", "LiveJobsSection.tsx", "heroSearch.ts"].map((f) => `src/components/landing/${f}`);
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

  it("the landing's top bar is the one public bar: no Declutter, no How it works, no sections read (owner, 2026-10-21)", () => {
    const nav = read("src/components/Navbar.tsx");
    // The bar's contents never branch on `landing` (it only sets the row's measure)...
    const landingUses = nav.match(/\blanding\b(?!\?:)/g) ?? [];
    expect(landingUses.length).toBeGreaterThan(0);
    expect(nav).not.toMatch(/\{landing &&|landing \?/);
    // ...and nothing on it reads the sections answer or links a section that may not be open.
    expect(nav).not.toMatch(/useSectionsOpen|sectionIsComingSoon|LandingNavLinks|declutter|how-it-works|Get started/i);
    expect(nav).toMatch(/to="\/browse"/);
    expect(nav).toMatch(/to="\/signup"/);
  });
});
