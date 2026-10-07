/**
 * Sweeps and journeys must measure pages, not the Terms re-consent modal. A
 * Terms bump puts every test account behind LATEST_TERMS_VERSION, and
 * TermsReconsentDialog is non-dismissible, so every authed screen of every
 * suite would show the modal instead of the page.
 *
 * It happened twice: loading-states-refresh breached 331 times on 2026-09-23,
 * and on 2026-10-07 e2e-journeys 37554735234 failed 5 chromium + 3 webkit
 * journeys behind the re-agree modal (nightly-red #2436), because the Oct 2026
 * bump (25936d6ca) landed while only pressProdSafety and test-signin-link
 * accepted at mint and the journeys' own getSession (e2e/journeys/fixtures.ts,
 * also the a11y sweep's) did not.
 *
 * So the CLASS is closed at the one mint every harness uses
 * (scripts/lib/adminSession.mjs mintAdminSession): it accepts the current
 * Terms as the user by default (scripts/lib/acceptCurrentTerms.mjs, version
 * read from the app's own src/lib/consent.ts). Inventory: every
 * mintAdminSession( call in e2e/ and scripts/. A caller may opt out with
 * `acceptTerms: false` only if it is listed below with its reason (exact).
 *
 * @mutate scripts/lib/adminSession.mjs | if (acceptTerms) await acceptCurrentTerms( | if (false) await acceptCurrentTerms(
 * @mutate scripts/lib/adminSession.mjs |   acceptTerms = true, |   acceptTerms = false,
 * @mutate scripts/test-signin-link.mjs |     await acceptCurrentTerms(supabaseUrl, anonKey, session.access_token, session.user.id); |     // removed
 * @mutate scripts/lib/acceptCurrentTerms.mjs |   const terms = src.match(/export const LATEST_TERMS_VERSION = "([^"]+)"/)?.[1]; |   const terms = "Jun 2026";
 * @mutate e2e/journeys/fixtures.ts |         transport: playwrightTransport(api), |         transport: playwrightTransport(api), acceptTerms: false,
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error untyped .mjs helper
import { latestConsentVersions } from "../../scripts/lib/acceptCurrentTerms.mjs";
import { LATEST_TERMS_VERSION, LATEST_PRIVACY_VERSION } from "@/lib/consent";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Callers that opt out of accepting at mint, and why. Exact, two-way. */
const OPT_OUT: Record<string, string> = {
  "scripts/test-signin-link.mjs": "accepts right after minting itself, unless --keep-consent asks for the dialog",
  "e2e/journeys/throwaway.ts": "its own profile write sets terms_version_accepted for the throwaway account",
  "e2e/privacy/privacy-requests.spec.ts": "each disposable account writes terms_version_accepted itself",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(resolve(ROOT, dir))) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const rel = join(dir, name);
    const st = statSync(resolve(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(m?js|ts|tsx|sh)$/.test(name)) out.push(rel);
  }
  return out;
}

/** Each `mintAdminSession({...})` call's argument text, per file (comments blanked). */
function mintCalls(): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const f of [...walk("e2e"), ...walk("scripts")]) {
    if (f === "scripts/lib/adminSession.mjs") continue;
    const src = blankComments(read(f));
    for (const m of src.matchAll(/mintAdminSession\(\s*\{/g)) {
      // The argument object: from its "{" to the matching "}".
      let depth = 0;
      let end = m.index! + m[0].length - 1;
      for (let i = end; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) { end = i; break; }
      }
      const arg = src.slice(m.index! + m[0].length - 1, end + 1);
      byFile.set(f, [...(byFile.get(f) ?? []), arg]);
    }
  }
  return byFile;
}

describe("every minted test session accepts the current Terms", () => {
  it("reads the app's own versions", () => {
    expect(latestConsentVersions(read("src/lib/consent.ts"))).toEqual({ terms: LATEST_TERMS_VERSION, privacy: LATEST_PRIVACY_VERSION });
  });

  it("the one mint accepts the Terms by default, after the session is minted", () => {
    const src = blankComments(read("scripts/lib/adminSession.mjs"));
    expect(src).toMatch(/import \{ acceptCurrentTerms \} from "\.\/acceptCurrentTerms\.mjs";/);
    expect(src).toMatch(/\n\s+acceptTerms = true,\n/);
    expect(src).toMatch(/if \(acceptTerms\) await acceptCurrentTerms\(base, anonKey, r\.session\.access_token, r\.session\.user\.id\);/);
  });

  it("only the listed callers opt out, each with a reason (exact)", () => {
    const calls = mintCalls();
    // Floor: the journeys/a11y getSession, gift-card, lifecycle, privacy,
    // throwaway, pressProdSafety, test-signin-link (7 files on 2026-10-07).
    expect(calls.size).toBeGreaterThan(6);
    const optingOut = [...calls].filter(([, args]) => args.some((a) => /acceptTerms\s*:\s*false/.test(a))).map(([f]) => f).sort();
    expect(optingOut).toEqual(Object.keys(OPT_OUT).sort());
    for (const why of Object.values(OPT_OUT)) expect(why.length).toBeGreaterThan(20);
  });

  it("test-signin-link still accepts on its own unless --keep-consent", () => {
    expect(read("scripts/test-signin-link.mjs")).toMatch(/if \(!args\.includes\("--keep-consent"\)\) \{\n\s+await acceptCurrentTerms\(supabaseUrl, anonKey, session\.access_token, session\.user\.id\);/);
  });
});
