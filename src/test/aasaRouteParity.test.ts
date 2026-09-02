import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeDeepLinkUrl } from "@/lib/deepLinkRoute";

/**
 * Every path the AASA claims must be servable BY THE WEB, not just by the app.
 *
 * `src/lib/deepLinkRoute.ts` states the invariant in its own header — "All
 * allowed paths in AASA must either match an App.tsx route or normalize to one
 * here" — and it was false for five patterns at once: `/j/*`, `/u/*`, `/m/*`,
 * `/messages/*` and `/post-job/*` were claimed and normalized, but no route in
 * `src/App.tsx` matched any of them, so on the web all five fell through to
 * `path="*"` and rendered NotFound.
 *
 * That is the wrong half of the contract to have working. AASA only routes
 * into the app for someone who ALREADY HAS the app; the recipient of a texted
 * short link is by construction the person most likely not to. They got the
 * 404, and nothing recorded it — Apple hands the URL to Safari silently when
 * the app is absent (see the header of `scripts/aasa-link-census.mjs` on why
 * this class of rot is invisible from both client and server).
 *
 * So this test is deliberately STATIC and lives in vitest rather than in the
 * deployment probe: it costs milliseconds, needs no network, and fails on the
 * commit that introduces the drift instead of on the deploy that ships it.
 *
 * It checks three things:
 *   1. every non-excluded `paths` claim resolves to a registered route,
 *   2. `paths` and `components` describe the same list (they are two
 *      representations of one decision, and Apple reads `components` on iOS 13+
 *      while older tooling and every human reads `paths`), and
 *   3. every `NOT` rule precedes every claim — a first-match-wins list where an
 *      exclusion sits below a wildcard is an exclusion that does nothing.
 */

const repoRoot = resolve(__dirname, "../..");
const aasa = JSON.parse(
  readFileSync(resolve(repoRoot, "public/.well-known/apple-app-site-association"), "utf8"),
);
const appSrc = readFileSync(resolve(repoRoot, "src/App.tsx"), "utf8");

const detail = aasa.applinks.details[0];
const paths: string[] = detail.paths;
const components: { "/": string; exclude?: boolean }[] = detail.components;

/**
 * Every `path=` registered in the router, MINUS the `*` catch-all. Matching the
 * catch-all is precisely the failure this test exists to catch, so it must not
 * count as a match.
 */
const registered = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== "*");

/** React Router path pattern → regex over a concrete pathname. */
function routeMatcher(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\/\*$/, "(?:/.*)?")
    .replace(/:[A-Za-z0-9_]+/g, "[^/]+");
  return new RegExp(`^${body}$`);
}
const matchers = registered.map(routeMatcher);
const isRegistered = (pathname: string) => matchers.some((re) => re.test(pathname));

/**
 * A concrete URL for a claim. Apple's `*` matches any characters including
 * `/`, but one segment is the shape every link we actually mint uses, and it
 * is the shape the normalizer's own regexes are written against.
 */
const SAMPLE_SEGMENT = "sample-id";
const concrete = (claim: string) => claim.replace(/\*/g, SAMPLE_SEGMENT);

describe("AASA ↔ router parity", () => {
  const claims = paths.filter((p) => !p.startsWith("NOT "));

  /**
   * THE WEB HALF, and the one that was broken.
   *
   * On the web nothing calls `normalizeDeepLinkUrl` unless a <Route> matched
   * first and mounted something that does — the normalizer runs off Capacitor's
   * `appUrlOpen`, which never fires in a browser. So web reachability is
   * exactly "React Router matches the claimed path", with no normalizer in the
   * loop. Asserting the NORMALIZED path instead would have passed on the broken
   * router (`/j/x` normalizes to `/jobs/x`, which has always been a route) and
   * missed every one of the six patterns this test was written for.
   */
  it.each(claims)("claim %s matches a <Route> in src/App.tsx", (claim) => {
    const pathname = concrete(claim);
    expect(
      isRegistered(pathname),
      `${claim} is claimed in AASA but ${pathname} matches no <Route>, so on the web it falls through to path="*" and renders the in-app 404`,
    ).toBe(true);
  });

  /**
   * THE APP HALF. A claim the normalizer refuses (`null`) or hands back
   * verbatim onto a nonexistent route is dead inside the app instead.
   */
  it.each(claims)("claim %s normalizes onto a real route", (claim) => {
    const target = normalizeDeepLinkUrl(`https://louisianahelpr.com${concrete(claim)}`);
    expect(target, `${claim} is claimed but normalizeDeepLinkUrl returns null`).not.toBeNull();
    const pathname = (target as string).split(/[?#]/, 1)[0];
    expect(
      isRegistered(pathname),
      `${claim} normalizes to ${pathname}, which matches no <Route> in src/App.tsx`,
    ).toBe(true);
  });

  it("paths and components describe the same list, in the same order", () => {
    expect(components.map((c) => (c.exclude ? `NOT ${c["/"]}` : c["/"]))).toEqual(paths);
  });

  it("every NOT rule precedes every claim", () => {
    // First-match-wins: an exclusion listed after a broader claim never runs.
    // (Mirrors the deployment probe's check, but at commit time.)
    const firstClaim = paths.findIndex((p) => !p.startsWith("NOT "));
    const lastExclusion = paths.reduce(
      (acc, p, i) => (p.startsWith("NOT ") ? i : acc),
      -1,
    );
    expect(lastExclusion).toBeLessThan(firstClaim);
  });

  it("the excluded auth paths stay excluded", () => {
    // Not a style preference — a gated decision, and the gate is not the hash
    // fix that landed in c538e318. supabase-js reads the fragment only inside
    // detectSessionInUrl, which runs at client CONSTRUCTION (app boot from
    // capacitor://localhost/, long before appUrlOpen delivers the link), so
    // claiming these would render the reset form with `ready=true` and NO
    // session, and updateUser({password}) would fail with "Auth session
    // missing" AFTER the user typed a new password. The precondition is an
    // explicit setSession() from the fragment on the native deep-link path.
    // Delete this test in the same commit that adds it — not before.
    expect(paths).toContain("NOT /reset-password");
    expect(paths).toContain("NOT /account-pending");
  });
});
