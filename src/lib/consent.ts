// Client-side mirror of supabase/functions/_shared/legalVersions.ts.
// The edge runtime (Deno) can't import the Vite src/ tree, so these
// constants exist in two places by necessity. A version bump here fires
// the Terms re-consent modal on the next authed load for any user whose
// profiles.terms_version_accepted no longer matches — see
// src/components/TermsReconsentDialog.tsx.
//
// When a policy is materially updated, bump ALL of:
//   1. supabase/functions/_shared/legalVersions.ts (edge)
//   2. this file (client)
//   3. src/pages/legal/legalSections.ts LAST_UPDATED[key] (rendered date)
// The parity test at legalVersions.parity.test.ts guards drift.

export const LATEST_TERMS_VERSION = "Sep 2026";

// The Privacy Policy is versioned on its own (Q289): legal_acceptances records
// both, and a Terms-only bump must not claim a Privacy version that never existed.
export const LATEST_PRIVACY_VERSION = "Jun 2026";