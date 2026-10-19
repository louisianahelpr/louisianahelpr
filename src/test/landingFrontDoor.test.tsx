/**
 * THE LANDING PAGE IS THE FRONT DOOR FOR ALL FOUR SECTIONS (owner, 2026-10-19,
 * PROMPT-LEAD "LANDING PAGE"): one block per section, a trust row, ONE obvious
 * sign-up action, and "coming soon" only on a section not yet open to everyone.
 *
 * No mocked Supabase (CLAUDE.md: no new mocked-Supabase specs; lead review
 * 2026-10-19). Layers checked here:
 *   1. the page: Index renders the section blocks and the trust + close; the
 *      page has exactly ONE filled button, the hero's, and it goes to /signup;
 *      the close repeats it as a text link with the same signed-in routing;
 *   2. the decision: the pure "coming soon" rule fails CLOSED (pending or
 *      failed = coming soon; Jobs never), and a missing RPC (PGRST202) is a
 *      quiet empty answer, not an error per visit; any other failure is
 *      reported at most once per session (the global QueryCache reporter
 *      skips the query), and the answer is never persisted to disk;
 *   1b. the links: a signed-out visitor is never sent to a sign-in-only
 *      section (Declutter/Shops/Homes go to sign-up with a return path), and
 *      a failed session check still navigates (code-review 2026-10-19);
 *   3. the server: features_open_to_everyone() (newest definition) reads only
 *      audience = 'everyone' for the three section keys, and anon may call it
 *      (the landing is signed out). Executed 3x in PGlite on 2026-10-19:
 *      ['shops'] with shops = everyone and quotes = everyone (quotes is not
 *      a section key, so it stays private), [] with none open, same as anon.
 */
// @mutate src/components/landing/useSectionsOpen.ts |   return open === null \|\| !open.has(feature); |   return open !== null && !open.has(feature);
// @mutate src/lib/missingRpc.ts |   if (e.code !== "PGRST202") return false; |   return false;
// @mutate src/components/landing/SectionsShowcase.tsx |   return { to: `/signup?redirect=${encodeURIComponent(path)}`, | return { to: path,
// @mutate src/lib/queryClient.ts |       if (query.meta?.reportsItself === true) return; |
// @mutate src/components/landing/useSectionsOpen.ts |     meta: { persist: false, reportsItself: true }, |     meta: { reportsItself: true },
// @mutate src/components/landing/useSectionsOpen.ts |   if (reported) return false; |
// @mutate src/components/landing/goSignedInOr.ts |     navigate(signedOut); |
// @mutate src/components/landing/SectionsShowcase.tsx |               const soon = sectionIsComingSoon(s.feature, open); |               const soon = false;
// @mutate src/pages/info/Index.tsx |       <SectionsShowcase />\n |
// @mutate src/components/landing/HeroSection.tsx |             <Link to="/signup" onClick={goToAccount} data-testid="landing-signup"> |             <Link to="/browse" onClick={goToAccount} data-testid="landing-signup">
// @mutate supabase/migrations/20261019051933_features_open_to_everyone.sql |     AND key = ANY (ARRAY['declutter', 'shops', 'rentals']); | ;
// @mutate supabase/migrations/20261019051933_features_open_to_everyone.sql | GRANT EXECUTE ON FUNCTION public.features_open_to_everyone() TO anon, authenticated, service_role; | GRANT EXECUTE ON FUNCTION public.features_open_to_everyone() TO authenticated, service_role;
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { SECTIONS } from "@/components/sections/sectionsConfig";
import { reportSectionsOpenFailureOnce, sectionIsComingSoon } from "@/components/landing/useSectionsOpen";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { cardLinkFor } from "@/components/landing/SectionsShowcase";

const ROOT = process.cwd();
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("landing: the front door for all four sections", () => {
  it("Index renders the section blocks, How it works, then trust + the close", () => {
    const src = read("src/pages/info/Index.tsx");
    const order = ["<HeroSection />", "<SectionsShowcase />", "<HowItWorksSection />", "<TrustAndJoin />"].map((t) => src.indexOf(t));
    expect(order.every((i) => i > -1), order.join(",")).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("ONE filled button on the page (the hero's, to /signup); the close is a text link with the same signed-in routing", () => {
    const hero = read("src/components/landing/HeroSection.tsx");
    const blocks = read("src/components/landing/SectionsShowcase.tsx");
    expect(hero.match(/btn-grad-primary/g)?.length).toBe(1);
    expect(blocks).not.toMatch(/btn-grad-primary/);
    expect(hero).toMatch(/<Link to="\/signup" onClick=\{goToAccount\} data-testid="landing-signup">/);
    expect(blocks).toMatch(/to="\/signup"\s+onClick=\{goToAccount\}/);
    expect(blocks).toMatch(/goSignedInOr\(navigate, "\/home", "\/signup"\)/);
    expect(hero).toMatch(/goSignedInOr\(navigate, "\/home", "\/signup"\)/);
  });

  it("one block per section (inventory from sectionsConfig); an open card never sends a signed-out visitor to a sign-in-only page", () => {
    const blocks = read("src/components/landing/SectionsShowcase.tsx");
    expect(SECTIONS.length).toBeGreaterThan(3);
    expect(blocks).toMatch(/SECTIONS\.map\(\(s\) =>/);
    // The mark comes from the fail-closed rule, nothing else.
    expect(blocks).toMatch(/const soon = sectionIsComingSoon\(s\.feature, open\);/);
    expect(blocks).toMatch(/\{!soon && \(\s*<Link\s+to=\{link\.to\}/);
    expect(blocks).toMatch(/goSignedInOr\(navigate, link\.signedIn, link\.to\)/);
    for (const s of SECTIONS) {
      const link = cardLinkFor(s.key, s.path, s.navLabel);
      expect(link.signedIn, s.key).toBe(s.path);
      if (s.key === "jobs") {
        expect(link).toMatchObject({ to: "/browse", text: "Browse Jobs" }); // the public guest board
      } else {
        // Declutter/Shops/Homes are ProtectedRoute pages: sign-up, returning to the section.
        expect(link.to, s.key).toBe(`/signup?redirect=${encodeURIComponent(s.path)}`);
        expect(link.text, s.key).toBe(`Join to browse ${s.navLabel}`);
      }
    }
  });

  it("a failed session check still navigates to the signed-out route", () => {
    const go = read("src/components/landing/goSignedInOr.ts");
    expect(go).toMatch(/\} catch \(error\) \{[\s\S]*navigate\(signedOut\);[\s\S]*\}/);
  });

  it("the read waits for the block to be on screen after load, never first paint, and uses React Query + unwrap", () => {
    const blocks = read("src/components/landing/SectionsShowcase.tsx");
    const hook = read("src/components/landing/useSectionsOpen.ts");
    expect(blocks).toMatch(/document\.readyState === "complete"/);
    expect(blocks).not.toMatch(/rootMargin/);
    expect(hook).toMatch(/useQuery\(\{/);
    expect(hook).toMatch(/enabled: start/);
    expect(hook).toMatch(/unwrap\(res\)/);
    // Never persisted; the global reporter skips it; the hook reports at most once.
    expect(hook).toMatch(/meta: \{ persist: false, reportsItself: true \}/);
    expect(read("src/lib/queryClient.ts")).toMatch(/if \(query\.meta\?\.reportsItself === true\) return;/);
    expect(hook.match(/report\(/g)?.length).toBe(1);
  });

  it("fails CLOSED: pending or failed reads mark every gated section Coming soon; Jobs never", () => {
    for (const s of SECTIONS) {
      // pending
      expect(sectionIsComingSoon(s.feature, null), `${s.key} while pending`).toBe(s.feature !== null);
      // failed (settles empty)
      expect(sectionIsComingSoon(s.feature, new Set()), `${s.key} after a failed read`).toBe(s.feature !== null);
      // open to everyone
      expect(sectionIsComingSoon(s.feature, new Set(s.feature ? [s.feature] : [])), `${s.key} once open`).toBe(false);
    }
    // only the named switch opens its section
    expect(sectionIsComingSoon("declutter", new Set(["shops"]))).toBe(true);
  });

  it("a missing RPC (PGRST202) is a quiet empty answer; any other error is not", () => {
    expect(isMissingRpcNamed({ code: "PGRST202" }, "features_open_to_everyone")).toBe(true);
    expect(isMissingRpcNamed({ code: "42501" }, "features_open_to_everyone")).toBe(false);
    expect(isMissingRpcNamed(null, "features_open_to_everyone")).toBe(false);
    // It exists with other parameters (PostgREST's hint names it): a real failure, not "not deployed".
    expect(isMissingRpcNamed({
      code: "PGRST202",
      message: "Could not find the function public.features_open_to_everyone(p_x) in the schema cache",
      hint: "Perhaps you meant to call the function public.features_open_to_everyone",
    }, "features_open_to_everyone")).toBe(false);
    // Any other failure is reported once per session, however many visits' worth of retries.
    expect(reportSectionsOpenFailureOnce(new Error("x"))).toBe(true);
    expect(reportSectionsOpenFailureOnce(new Error("y"))).toBe(false);
  });

  it("features_open_to_everyone (newest definition) reads only the three section keys at audience 'everyone', and anon may call it", () => {
    const dir = join(ROOT, "supabase/migrations");
    const def = effectiveDefs(dir).get("features_open_to_everyone");
    expect(def, "features_open_to_everyone is defined by no migration").toBeDefined();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/SECURITY DEFINER/i);
    expect(body).toMatch(/WHERE\s+audience\s*=\s*'everyone'/i);
    expect(body).toMatch(/AND\s+key\s*=\s*ANY\s*\(ARRAY\['declutter',\s*'shops',\s*'rentals'\]\)/i);
    // ...which are exactly the switches the landing's sections name.
    expect(SECTIONS.map((s) => s.feature).filter(Boolean).sort()).toEqual(["declutter", "rentals", "shops"]);
    expect(body).not.toMatch(/auth\.uid|testers/i);
    const grants = migrationFiles(dir)
      .map((f) => blankSqlComments(readFileSync(join(dir, f), "utf8")))
      .filter((s) => /features_open_to_everyone\(\)/.test(s))
      .join("\n");
    expect(grants).toMatch(/GRANT EXECUTE ON FUNCTION public\.features_open_to_everyone\(\) TO anon\b/);
    expect(grants).toMatch(/REVOKE ALL ON FUNCTION public\.features_open_to_everyone\(\) FROM PUBLIC/);
  });
});
