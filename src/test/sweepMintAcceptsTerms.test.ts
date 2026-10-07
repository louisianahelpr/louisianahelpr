/**
 * Sweeps must measure pages, not the Terms re-consent modal. A Terms bump puts
 * every test account behind LATEST_TERMS_VERSION, and TermsReconsentDialog is
 * non-dismissible, so loading-states-refresh and press-every-control would
 * press and time the modal on every authed route. Both mint paths therefore
 * accept the current Terms as the user (scripts/lib/acceptCurrentTerms.mjs),
 * reading the version from the app's own src/lib/consent.ts.
 *
 * @mutate scripts/audit/pressProdSafety.mjs |   await acceptCurrentTerms(supabaseUrl(), anonKey(), session.access_token, session.user.id); // TERMS-CONSENT at mint |   // removed
 * @mutate scripts/test-signin-link.mjs |     await acceptCurrentTerms(supabaseUrl, anonKey, session.access_token, session.user.id); |     // removed
 * @mutate e2e/journeys/fixtures.ts |     await acceptCurrentTerms(SUPABASE_URL, ANON, session.access_token, session.user.id); // TERMS-CONSENT at mint |     // removed
 * @mutate scripts/lib/acceptCurrentTerms.mjs |   const terms = src.match(/export const LATEST_TERMS_VERSION = "([^"]+)"/)?.[1]; |   const terms = "Jun 2026";
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { latestConsentVersions } from "../../scripts/lib/acceptCurrentTerms.mjs";
import { LATEST_TERMS_VERSION, LATEST_PRIVACY_VERSION } from "@/lib/consent";
import { blankComments } from "./helpers/blankNonCode";

const MINT_PATHS: [string, RegExp][] = [
  ["scripts/audit/pressProdSafety.mjs", /await acceptCurrentTerms\(supabaseUrl\(\), anonKey\(\), session\.access_token, session\.user\.id\)/],
  ["scripts/test-signin-link.mjs", /await acceptCurrentTerms\(supabaseUrl, anonKey, session\.access_token, session\.user\.id\)/],
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

/**
 * The CLASS (Q1429, nightly-red #2436, 2026-10-07): the two paths above were
 * listed by hand, and the journeys harness's CI mint (e2e/journeys/fixtures.ts
 * getSession, service-role mintAdminSession) was not one of them, so the
 * "Oct 2026" Terms bump put the re-consent dialog over 4 of e2e-journeys
 * 37554735234's 5 failures. Every tracked e2e/ or scripts/ file that mints a
 * session (calls mintAdminSession) now either accepts the current Terms the
 * same way or is listed below with why it does not; the list is exact both ways.
 */
const NO_ACCEPT: Record<string, string> = {
  // The mint itself.
  "scripts/lib/adminSession.mjs": "defines mintAdminSession",
  // Answers a typed login's password grant from a route handler; the specs
  // using it (auth, slow-network, payment-lifecycle) assert the login itself.
  "e2e/helpers/mintedPasswordGrant.ts": "login-form specs, not a page sweep; not audited for the dialog (2026-10-07)",
  // Create their own accounts with terms_version_accepted = LATEST_TERMS_VERSION.
  "e2e/journeys/throwaway.ts": "creates throwaway accounts already on the current Terms",
  "e2e/privacy/privacy-requests.spec.ts": "creates its accounts already on the current Terms",
  // Stripe TEST-mode money loops (skipped under live Stripe); not audited for the dialog.
  "e2e/prod-gift-card.spec.ts": "Stripe test-mode money loop; not audited for the dialog (2026-10-07)",
  "e2e/prod-lifecycle.spec.ts": "Stripe test-mode money loop; not audited for the dialog (2026-10-07)",
};

describe("every session mint accepts the current Terms, or says why not", () => {
  const ROOT = resolve(__dirname, "../..");
  const minters = execFileSync("git", ["ls-files", "-z", "--", "e2e", "scripts"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
    .split("\0")
    .filter((f) => /\.(ts|mts|mjs|js)$/.test(f) && !/\.d\.mts$/.test(f))
    .filter((f) => /\bmintAdminSession\s*\(/.test(blankComments(read(f))));

  it("finds the mint sites (inventory floor)", () => {
    expect(minters.length).toBeGreaterThan(6);
  });

  it("each one accepts the current Terms or is listed", () => {
    const unlisted = minters.filter((f) => !NO_ACCEPT[f] && !/\bacceptCurrentTerms\s*\(/.test(blankComments(read(f))));
    expect(unlisted, "a new session mint must call acceptCurrentTerms (scripts/lib/acceptCurrentTerms.mjs) or be listed in NO_ACCEPT with its reason").toEqual([]);
  });

  it("the list is exact (a listed file that no longer mints, or now accepts, is removed)", () => {
    const stale = Object.keys(NO_ACCEPT).filter((f) => !minters.includes(f) || /\bacceptCurrentTerms\s*\(/.test(blankComments(read(f))));
    expect(stale).toEqual([]);
  });
});
