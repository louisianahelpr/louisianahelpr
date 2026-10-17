# lh-money-escrow REVIEW ONLY, ready/declutter-add-a-helpr-v2 @ 4f45a073f (via lead's hub-review, 2026-10-17)
Verdict: APPROVE WITH NOTES. Trailer:
Sensitive-Review: lh-money-escrow: approve-with-notes (4f45a073f; no new money path, link-only; owner decision on A10 seller-fault setup-job cancel fee; LOW: banned-seller order still offered, job_already_funded denylist->allowlist, retry/draft path posts unlinked paid job)
Findings:
1 MEDIUM owner decision: spec A10, buyer cancel fee on the setup job when the Declutter order is refunded for SELLER fault -> owner pop-up before leaving testers; make Q?addhelpr-refund a condition for declutter_add_helpr beyond testers.
2 LOW: a banned seller's paid order stays 'paid'; declutter_setup_helpr (:80) / declutter_link_setup_job (:151-155) should refuse or offer nothing when the seller is banned / a refund is pending.
3 LOW: job_already_funded denylist -> allowlist: refuse unless COALESCE(payment_status,'unpaid') IN ('unpaid','abandoned','failed'); fix the comment + H17 proof.
4 LOW: unlinked paid setup jobs: the retry path (useJobSubmit.ts:471) never links; flushDraft (:783) keeps a draft that reposts without ?declutterOrder= -> relink on retry and skip the draft (as haul-away did), or document it.
5 inherited gift-card lost-response flaw (main), not new.
6 Stack dependency: it sits on 446e378eb; conflicts expected with 113670a88 in DeclutterHandoverViews.tsx (lazy OrderDeliveryPanel) and lifecycleErrors.ts (helpr_* copy moved to helprTasks/errorCopy.ts); re-measure /posts (360 KB) for the new AddHelprPanel import.
PGlite 24/24 not re-run by the reviewer.
