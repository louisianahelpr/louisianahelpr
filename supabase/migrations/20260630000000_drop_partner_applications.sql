-- Retire the partner-application flow.
--
-- "Partner" was a redundant second door into the business-verification path:
-- businesses self-serve sign up and submit license + insurance via
-- BusinessVerificationCard -> AdminCredentialQueue. No partners were ever
-- onboarded, so the intake table, its policies, and the anon-revoke grants are
-- all dead weight. Drop the table (CASCADE clears dependent policies/indexes).
--
-- Replay-safe: guarded with IF EXISTS so a from-scratch rebuild that never
-- created the table (or ran the later index/revoke migrations) still succeeds.

DROP TABLE IF EXISTS public.partner_applications CASCADE;
