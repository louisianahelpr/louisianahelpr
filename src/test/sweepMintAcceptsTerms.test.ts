/**
 * Sweeps must measure pages, not the Terms re-consent modal. A Terms bump puts
 * every test account behind LATEST_TERMS_VERSION, and TermsReconsentDialog is
 * non-dismissible, so loading-states-refresh and press-every-control would
 * press and time the modal on every authed route. Both mint paths therefore
 * accept the current Terms as the user (scripts/lib/acceptCurrentTerms.mjs),
 * reading the version from the app's own src/lib/consent.ts.
 *
 * @mutate scripts/audit/pressProdSafety.mjs |   await acceptCurrentTerms(supabaseUrl(), anonKey(), session.access_token, session.user.id); // TERMS-CONSENT at mint |   // removed
 * @mutate scripts/test-signin-link.mjs |     await acceptCurrentTerms(supabaseUrl, anonKey, session.access_token, resolvedUserId); |     // removed
 * @mutate scripts/lib/acceptCurrentTerms.mjs |   const terms = src.match(/export const LATEST_TERMS_VERSION = "([^"]+)"/)?.[1]; |   const terms = "Jun 2026";
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error untyped .mjs helper
import { latestConsentVersions } from "../../scripts/lib/acceptCurrentTerms.mjs";
import { LATEST_TERMS_VERSION, LATEST_PRIVACY_VERSION } from "@/lib/consent";

const MINT_PATHS: [string, RegExp][] = [
  ["scripts/audit/pressProdSafety.mjs", /await acceptCurrentTerms\(supabaseUrl\(\), anonKey\(\), session\.access_token, session\.user\.id\)/],
  ["scripts/test-signin-link.mjs", /await acceptCurrentTerms\(supabaseUrl, anonKey, session\.access_token, resolvedUserId\)/],
];
const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("sweep session mint accepts the current Terms", () => {
  it("reads the app's own versions", () => {
    expect(latestConsentVersions(read("src/lib/consent.ts"))).toEqual({ terms: LATEST_TERMS_VERSION, privacy: LATEST_PRIVACY_VERSION });
  });

  it("covers both mint paths", () => {
    expect(MINT_PATHS.length).toBeGreaterThanOrEqual(2);
  });

  it.each(MINT_PATHS)("%s calls it on every fresh session", (file, call) => {
    expect(read(file)).toMatch(call);
  });
});
