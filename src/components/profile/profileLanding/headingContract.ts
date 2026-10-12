/**
 * The /profile landing's heading contract, shared by the app, its unit test
 * (src/test/profileLandingHeadingContract.test.tsx) and the journey that signs
 * the helper back in (e2e/journeys/03-account.spec.ts "sign back in").
 *
 * Owner, 2026-10-09 (59f14c55a): the page title reads "Profile" (the one h1)
 * and the member's name sits beside their photo as an h2 in IdentityHeader.
 * The journey still looked for the name as the h1 and failed every night after
 * (e2e-journeys 38157785191, 38181872855: "not signed back in as the helper"
 * while the page showed heading "E2E Helper" [level=2]). The unit test renders
 * IdentityHeader and fails when the name's level stops matching this constant,
 * so a future move fails in Vitest on the PR, not in the release gate.
 */
export const PROFILE_PAGE_TITLE = "Profile";
export const PROFILE_NAME_HEADING_LEVEL = 2;
