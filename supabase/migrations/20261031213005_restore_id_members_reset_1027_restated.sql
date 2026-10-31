-- The members Stripe verified, whom the data change of 2026-10-27 16:59 UTC reset to not_started, are verified again
-- (owner 2026-10-30: "16 wrongly reset members restored automatically, no second charge"). stripe-idv-start restored
-- them only if they tapped; this restores them without a tap.
--
-- LEAD-B49-REBUILD (Builder 28, 10-31): B49's 20261031021658 (wip/l36-1030-b49-on-train), byte-identical SQL, under a
-- timestamp after main's newest. Re-measured read-only on prod 2026-10-31 ~16:30 CT: the same selection still matches 16.
-- Proof: src/test/pglite/restoreIdMembersReset.pglite.mjs.
--
-- Selected by the audit trail, every condition required. Read-only on prod 2026-10-30, this selects exactly 16 people:
--   * the reset itself: helper_verifications idv_status verified -> not_started inside 2026-10-27 16:59:00-17:00:00 UTC;
--   * Stripe verified them: the step to verified was processing -> verified, the last status change before the reset.
--     This is what leaves out the other 7 reset that minute (manual_review -> verified on 10-23, a bulk change, no
--     Stripe verdict). They keep not_started, and the attempts fix in 20261030225327 still applies to the 5 at 3 tries;
--   * the session on their row is the one audited before that step;
--   * nothing has changed since: profile still not_started, no idv_status audit row after the reset;
--   * not a test account: is_seed is not true and no test_accounts row.
--
-- Stripe itself was not asked: no live Stripe from a migration. The audit trail is the evidence, and stripe-idv-start's
-- tap (Stripe's verified, for this very member) stays for anyone this leaves out.
--
-- No charge: no fee column, attempt count or Stripe session is touched, and no new session is started. No notice is sent.
-- The audit trigger writes one row per person (changed_by NULL). Replay-safe: a restored member no longer matches.
UPDATE public.profiles p
   SET idv_status = 'verified', idv_failure_reason = NULL
  FROM public.helper_verifications r
  JOIN public.helper_verifications v
    ON v.user_id = r.user_id AND v.field = 'idv_status' AND v.old_value = 'processing' AND v.new_value = 'verified'
   AND v.changed_at < r.changed_at
 WHERE p.user_id = r.user_id
   AND r.field = 'idv_status' AND r.old_value = 'verified' AND r.new_value = 'not_started'
   AND r.changed_at >= timestamptz '2026-10-27 16:59:00+00'
   AND r.changed_at <  timestamptz '2026-10-27 17:00:00+00'
   AND p.idv_status = 'not_started'
   AND p.is_seed IS NOT TRUE
   AND NOT EXISTS (SELECT 1 FROM public.test_accounts ta WHERE ta.user_id = p.user_id)
   AND p.idv_session_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.helper_verifications s
                WHERE s.user_id = p.user_id AND s.field = 'idv_session_id' AND s.new_value = p.idv_session_id
                  AND s.changed_at < v.changed_at)
   AND NOT EXISTS (SELECT 1 FROM public.helper_verifications x
                    WHERE x.user_id = p.user_id AND x.field = 'idv_status'
                      AND x.changed_at > v.changed_at AND x.changed_at < r.changed_at)
   AND NOT EXISTS (SELECT 1 FROM public.helper_verifications x
                    WHERE x.user_id = p.user_id AND x.field = 'idv_status' AND x.changed_at > r.changed_at);
