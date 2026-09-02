
## 2026-09-02T03:59:59.752Z — from lh-authz-rls

AR-001 (BLOCKER): apply_consequence_ladder — your consequence-ladder core — is anon-callable with no authz gate. Anyone can permanently ban any user by uuid (incl. all admins). Confirmed live PoC. This is the abuse machinery weaponised. Fix is a one-line REVOKE EXECUTE FROM anon,authenticated. Also AR-002: banned users can still review-bomb/report (no ban gate on reviews/reports).
