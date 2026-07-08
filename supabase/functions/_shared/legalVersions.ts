// Legal document versions — mirrored to `src/pages/legal/legalSections.ts`
// (the front-end LAST_UPDATED map that renders in each PolicyFooter). The
// edge runtime (Deno) can't import from the src/ tree at build time, so
// these constants exist twice by necessity — the parity test
// `legalVersions.parity.test.ts` guards against drift by loading both
// files at test time and asserting they agree.
//
// When you materially change a policy, bump BOTH sides in the same PR:
//   1. src/pages/legal/legalSections.ts → LAST_UPDATED[key]
//   2. this file → the matching constant
// A bumped version here also drives the re-consent flow: users whose
// `legal_acceptances.terms_version` (or privacy_version) is older than
// what's stated here should be prompted to re-accept before continuing.

export const LEGAL_TERMS_VERSION = "Jun 2026";
export const LEGAL_PRIVACY_VERSION = "Jun 2026";
export const LEGAL_COMMUNITY_VERSION = "Jun 2026";
