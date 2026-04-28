---
name: Big 7 profile gate
description: Universal /complete-profile gate enforced in ProtectedRoute for all non-legacy users; blocks app access until 7 fields + ID upload + policy acceptance are satisfied
type: feature
---

**Cutoff (legacy bypass)**: A `profiles.is_legacy_user` boolean was backfilled to `true` on 2026-04-27 for every existing row. New signups default to `false` and must clear the gate.

**Gate location**: `src/components/ProtectedRoute.tsx` — runs after the email-verification + ban + approval-status checks. Only redirects to `/complete-profile` when `is_legacy_user !== true` **AND** a non-null profile row was actually loaded. If `profile === null` (fetch timed out / RLS hiccup) the gate **fails open** so legacy users are never bounced to /complete-profile on a slow network. The page itself also self-redirects legacy users back to /dashboard as a second line of defense.

**Big 7 required fields** (all must be non-empty strings on `profiles`):
1. `full_name`
2. `avatar_url`
3. `bio` (≥20 characters)
4. `date_of_birth` (must compute to ≥18 years)
5. `phone` (10 digits)
6. `location`
7. `id_document_url` (uploaded to existing `id-documents` storage bucket)

Plus runtime acceptance of platform rules / terms / privacy on `/complete-profile`.

**UI**: `src/pages/CompleteProfile.tsx` shows a live checklist card (green check / red X) above the form. Submit button is disabled until every item is satisfied; label flips between "Complete all items above" and "Enter app".

**Fresh data**: The gate consumes `useCurrentUser` which uses React Query (30s staleTime) plus a realtime postgres_changes subscription on the user's own `profiles` row, so uploading an ID or saving the bio opens the gate without a manual reload.

**Conflicts to remember**: This contradicts the original `auto-approval-flow` memory which said no ID upload was required. As of 2026-04-27 the product owner explicitly chose to require ID for every new user; legacy accounts are intentionally exempt.
