# Front/back parity matrix (Q54), measured 2026-09-26

Every rule the client enforces that the server also enforces, and every server
value the client displays, with the test that fails when the two sides drift.
Dated record: the counts below were measured on 2026-09-26 against
origin/main 117dbf4bc plus branch `cloud/open-process-q54`, by counting the
rows of the tables in this file. They are not regenerated; re-count the rows
when you add one.

Server side = the NEWEST migration event for each constraint or function (any
dollar-quote tag), or the edge function in `supabase/functions/`. Client side =
`src/`. "New" = guard added on this branch, each proven red by applying every
`@mutate` line in it (evidence in the Q54 report).

## Counts (2026-09-26)

| measure | count |
|---|---|
| pairs in the inventory (rows of the rule tables below, one-sided table excluded) | 80 |
| pairs with a parity test before this sweep | 42 |
| pairs newly tested on this branch | 36 |
| pairs still without a parity test (MIME class row, saved-search radius) | 2 |
| real mismatches found (client and server disagree today) | 6 rows, all in ai-job-builder (F1) |

## Text lengths and text shape — new guard `src/test/textLimitParity.test.ts`

| rule | client file:line | server file:line | parity test | status |
|---|---|---|---|---|
| chat message max 4000 | src/lib/messageLimits.ts:8 | supabase/migrations/20260831014020_add_message_content_length_check.sql:26 (messages_content_length_check) | textLimitParity | new, agrees |
| business name max 80 | src/components/profile/CredentialsTab.tsx:31 | supabase/migrations/20260827180000_credential_business_name.sql:43 (profiles_business_name_len) | textLimitParity | new, agrees |
| support name min 2 | src/pages/info/Support.tsx:70 | supabase/functions/contact-support/index.ts:80 | textLimitParity | new, agrees |
| support name max 100 | src/pages/info/Support.tsx:71 | supabase/functions/contact-support/index.ts:81 | textLimitParity | new, agrees |
| support email max 254 | src/pages/info/Support.tsx:72 | supabase/functions/contact-support/index.ts:82 | textLimitParity | new, agrees |
| support subject max 120 | src/pages/info/Support.tsx:73 | supabase/functions/contact-support/index.ts:83 | textLimitParity | new, agrees |
| support message min 10 | src/pages/info/Support.tsx:74 | supabase/functions/contact-support/index.ts:84 | textLimitParity | new, agrees |
| support message max 5000 | src/pages/info/Support.tsx:75 | supabase/functions/contact-support/index.ts:85 | textLimitParity | new, agrees |
| support subject max (in-app subject builder) | src/lib/supportSubject.ts:16 | supabase/functions/contact-support/index.ts:83 | textLimitParity | new, agrees |
| support email shape (EMAIL_RE) | src/pages/info/Support.tsx:77 | supabase/functions/contact-support/index.ts:90 | textLimitParity | new, agrees |
| gift note max 140 | src/pages/profile/giftCards/constants.ts:3 | supabase/functions/create-gift-card-checkout/index.ts:21 | textLimitParity | new, agrees |
| gift recipient email shape | src/pages/profile/GiftCard.tsx:73 | supabase/functions/create-gift-card-checkout/index.ts:26 | textLimitParity | new, agrees |
| gift occasion/design id <= 48 | src/pages/profile/giftCards/giftCardDesigns.ts:46 | supabase/functions/create-gift-card-checkout/index.ts:91; supabase/migrations/20260811160000_gift_card_occasion_design.sql:34 | textLimitParity | new, agrees |
| profile search floor 2 chars | src/pages/profile/giftCards/RecipientPicker.tsx:32 | supabase/migrations/20260923172405_retire_approval_status_reads.sql:262 (search_profiles_by_name) | textLimitParity (RecipientPicker.test.tsx pinned the client only) | new, agrees |
| dispute reason floor: client detail min 10 composes to >= server 15 | src/components/disputeReasons.ts:75 | supabase/migrations/20260924220318_rename_tab_addresses.sql:1470 (open_dispute_as) | textLimitParity (disputeFiling.test.ts pinned that a floor exists, not its number) | new, agrees |

## AI job builder output vs the post-job form — new guard `src/test/aiJobBuilderBoundsParity.test.ts`

The form assigns the builder's output verbatim (src/pages/post-job/useJobEntry.ts:88).

| rule | client file:line | server file:line | parity test | status |
|---|---|---|---|---|
| title max 32 | src/components/postjob/detailsSection/detailsSectionConstants.ts:23 | supabase/functions/ai-job-builder/sanitize.ts:11 | aiJobBuilderBoundsParity | new, agrees |
| description max | src/components/postjob/detailsSection/detailsSectionConstants.ts:24 (1000) | supabase/functions/ai-job-builder/sanitize.ts:12 (4000) | aiJobBuilderBoundsParity (KNOWN_DRIFT, exact) | new, MISMATCH F1 |
| special requirements max | src/components/postjob/LogisticsSection.tsx:465 (500) | supabase/functions/ai-job-builder/sanitize.ts:13 (1000) | aiJobBuilderBoundsParity (KNOWN_DRIFT) | new, MISMATCH F1 |
| budget ceiling | src/lib/moneyLimits.ts:27 re-exports MAX_JOB_BUDGET_DOLLARS 1000 | supabase/functions/ai-job-builder/sanitize.ts:15 (100000, budget_min and budget_max) | aiJobBuilderBoundsParity (KNOWN_DRIFT) | new, MISMATCH F1 |
| budget floor | src/lib/moneyLimits.ts:27 re-exports MIN_JOB_BUDGET_DOLLARS 10 | supabase/functions/ai-job-builder/sanitize.ts:39 (0) | aiJobBuilderBoundsParity (KNOWN_DRIFT) | new, MISMATCH F1 |
| group helpers ceiling | src/components/postjob/LogisticsSection.tsx:370 (10) | supabase/functions/ai-job-builder/sanitize.ts:16 (20) | aiJobBuilderBoundsParity (KNOWN_DRIFT) | new, MISMATCH F1 |
| group helpers floor | src/components/postjob/LogisticsSection.tsx:369 (2) | supabase/functions/ai-job-builder/sanitize.ts:47 (1) | aiJobBuilderBoundsParity (KNOWN_DRIFT) | new, MISMATCH F1 |
| category list | src/lib/categoryHues.ts | supabase/functions/ai-job-builder/index.ts (tool enum) | src/test/edge/aiJobBuilderCanonicalCategories.test.ts | tested before |

## Amounts and money math

| rule | client file:line | server file:line | parity test | status |
|---|---|---|---|---|
| gift card min $10 | src/pages/profile/GiftCard.tsx:74 | supabase/functions/create-gift-card-checkout/index.ts:19 | src/test/amountBoundsParity.test.ts | new, agrees |
| gift card max $500 | src/pages/profile/GiftCard.tsx:75 | supabase/functions/create-gift-card-checkout/index.ts:20 | amountBoundsParity | new, agrees |
| tip ceiling at the storage layer | supabase/functions/_shared/tipFees.ts:30 (shared with TipDialog) | supabase/migrations/20260831160012_tips_no_client_writes.sql:33 (tips_amount_positive) | amountBoundsParity | new, agrees |
| tip min/max/fee, client vs create-payment | src/components/TipDialog.tsx | supabase/functions/_shared/tipFees.ts | tipFeesOneDefinition.test.ts, TipDialogBounds.test.tsx | tested before |
| job budget min/max, urgent-fee ceiling | src/lib/moneyLimits.ts | jobs_budget_range, jobs_urgent_fee_ceiling, validate_job_budget, create-payment | jobBudgetCapIsOneConstant.test.ts | tested before |
| poster service fee | src/lib/posterFees | supabase/functions/_shared | src/lib/posterFees.parity.test.ts | tested before |
| helper fee | src/lib/helperFees | supabase/functions/_shared | src/lib/helperFees.parity.test.ts | tested before |
| helper take-home shown vs paid | src/lib | supabase/functions/_shared | src/lib/helperTakeHomeDisplay.parity.test.ts | tested before |
| Stripe processing fee | src/lib/stripeFees | supabase/functions/_shared | src/lib/stripeFees.parity.test.ts | tested before |
| instant payout fee and minimum | src/lib/instantPayoutFee | supabase/functions/_shared/instantPayoutFee.ts | src/lib/instantPayoutFee.parity.test.ts | tested before |
| sales tax | src/lib/salesTax | supabase/functions/_shared | src/lib/salesTax.parity.test.ts | tested before |
| product prices and boost minimum | src/lib/productPrices | supabase/functions/_shared/productPrices.ts | src/lib/productPrices.parity.test.ts | tested before |
| Pro tier prices | src/lib/proTiers | supabase/functions/_shared | src/lib/proTiers.parity.test.ts | tested before |
| money figures in copy (service-fee %, etc.) | src/lib | supabase/functions/_shared | src/lib/moneyFigures.parity.test.ts | tested before |
| same fee % for either side of a job | src/lib | supabase/functions/_shared | src/lib/roleFeeParity.test.ts | tested before |
| shown amount == charged amount (whole cents) | src/ | supabase/functions/ | src/test/wholeCentParity.test.ts | tested before |
| dispute split preview == executor | src/lib/disputeSplitPreview | execute-dispute-split | src/lib/disputeSplitPreview.parity.test.ts | tested before |
| 3-D Secure threshold | src/ | supabase/functions/_shared/threeDSecure.ts | src/test/threeDSecureOnLargeCharges.test.ts | tested before |
| R18 money duplications | src/lib | supabase/functions | src/lib/r18Guards.parity.test.ts | tested before |
| recurring series total and weeks 1..52 | src/lib/recurringSchedule | supabase/functions/_shared/recurringSchedule.ts, jobs_recurrence_weeks_range | src/lib/recurringSchedule.parity.test.ts | tested before |

## Time windows

| rule | client file:line | server file:line | parity test | status |
|---|---|---|---|---|
| cancellation fee window and percent | src/lib/cancellationFee, CancellationDialog | supabase/functions/_shared | src/lib/cancellationFee.parity.test.ts, src/components/cancellationDialogParity.test.ts | tested before |
| escrow auto-release timing and its copy | src/lib/escrowTiming | supabase/functions/_shared | src/lib/escrowTiming.parity.test.ts, src/lib/escrowTiming.copyParity.test.ts | tested before |
| early-access delay | src/lib/earlyAccess | public.early_access_delay_minutes | src/lib/earlyAccess.parity.test.ts | tested before |
| day-of "On my way" gate (Central day) | src/components/JobTracking.tsx | helper_mark_on_the_way | src/components/JobTracking.onTheWayGate.test.tsx | tested before |

## Who can do what

| rule | client file:line | server file:line | parity test | status |
|---|---|---|---|---|
| jobs column guards vs the RPCs that write them | src/ | jobs guard triggers, RPCs | src/test/jobsGuardRpcParity.test.ts | tested before |
| "is this person ID-verified" | src/ | profiles columns, RPCs | src/test/identityVerdictParity.test.ts | tested before |
| tier perks sold == perks granted | src/lib/tierPerks | SQL perk gates | src/lib/tierPerks.parity.test.ts, src/test/perkEnforcementParity.test.ts, src/test/advancedAnalyticsTierParity.test.ts, SubscriptionTab.perksParity.test.tsx | tested before |
| tier display names | src/lib/tierPerks | supabase/functions/_shared | src/lib/tierNames.parity.test.ts | tested before |
| banned accounts refused | src/ | SQL ban gates | src/test/banGateCoverage.test.ts | tested before |
| apply/hire refused across a block | src/ | apply/hire RPCs | src/test/applyRefusedAcrossBlock.test.ts, src/test/hireRefusedAcrossBlock.test.ts | tested before |
| contact-info filter | src/lib/messageScanner | public.contact_leak_reason | src/lib/contactFilterParity.test.ts | tested before |
| legal document versions (re-consent) | src/lib/legalVersions | supabase/functions/_shared | src/lib/legalVersions.parity.test.ts | tested before |
| seed-job visibility on every browse surface | src/config/showSeedJobs | browse RPCs | src/config/showSeedJobs.parity.test.ts | tested before |

## Files

| rule | client file:line | server file:line | parity test | status |
|---|---|---|---|---|
| upload size cap <= bucket file_size_limit (every bucket-bound cap) | src/ (class scan) | storage.buckets in migrations | src/test/uploadCapsWithinBucketLimit.test.ts, src/lib/voiceNoteLimitMatchesBucket.test.ts | tested before |
| credential document types | src/components/profile/CredentialsTab.tsx | helper-credentials bucket, SQL | src/test/credentialDocumentExtAgreement.test.ts | tested before |
| upload MIME/type allow-lists vs bucket allowed_mime_types (avatars, portfolio, job-photos, message-attachments, dispute evidence, marketing media) | per-uploader accept/type checks | allowed_mime_types, e.g. supabase/migrations/20260915055517_storage_bucket_limits.sql:66 | none as a class (avatarStorage.test.ts and portfolioStorage.test.ts cover their own lists) | NOT TESTED as a class |

## Enums, ranges and server values the client displays

| rule | client file:line | server file:line | parity test | status |
|---|---|---|---|---|
| message reactions | src/components/messages/useMessageReactions.ts:26 | supabase/migrations/20260811120000_message_pins_reactions_replies.sql:81 | src/test/enumRangeParity.test.ts | new, agrees |
| report target types | src/components/ReportDialog.tsx:55 | supabase/migrations/20260924182505_report_against_application.sql:18 | enumRangeParity | new, agrees |
| admin report status filters | src/components/admin/AdminReports.tsx:69 | supabase/migrations/20260609160000_admin_polish_pass.sql:52 | enumRangeParity | new, agrees |
| dispute status display union | src/components/DisputeTimelineDialog.tsx:46 | supabase/migrations/20260915071502_reapply_dispute_settlement_objects.sql:1502 | enumRangeParity | new, agrees |
| NPS role | src/lib/nps.ts:36 | supabase/migrations/20260520135554_nps_responses.sql:18 | enumRangeParity | new, agrees |
| NPS scale 1..5 inside CHECK 0..10 | src/components/feedback/NpsPrompt.tsx:174 | supabase/migrations/20260520135554_nps_responses.sql:16 | enumRangeParity | new, agrees |
| error log severity | src/lib/errorLogger.ts:145 | supabase/migrations/20260422213631_ab05135e-e657-4d67-8873-fc92ab5eae43.sql:7 | enumRangeParity | new, agrees |
| review stars (ReviewForm via StarRow) | src/components/reviewPanel/StarRow.tsx:58 | supabase/migrations/20260311000404_f8e7eb29-742a-409a-a3a3-a493232415e6.sql:195 | enumRangeParity | new, agrees |
| review stars (CompletionPrompts) | src/components/CompletionPrompts.tsx:271 | same CHECK | enumRangeParity | new, agrees |
| credential tier picker | src/components/postjob/detailsSection/detailsSectionConstants.ts:67 | supabase/migrations/20260612150000_jobs_credential_tier.sql:3 | enumRangeParity | new, agrees |
| push token platform | src/lib/nativePush.ts:106 | supabase/migrations/20260422213631_ab05135e-e657-4d67-8873-fc92ab5eae43.sql:97 | enumRangeParity | new, agrees |
| job status labels | src/lib/statusLabels.ts | jobs status values | src/test/jobStatusExhaustive.test.ts | tested before |
| payment status labels | src/ | jobs_payment_status_check | src/test/paymentStatusExhaustive.test.ts | tested before |
| credential types | src/ | helper_credentials_credential_type_check | src/test/noBondCredentialType.test.ts | tested before |
| notification types (six registries) | src/components/notificationPanel, notificationPreferences | notifications_type_check, create-notification ALLOWED_TYPES, send-notification-email | src/test/notificationTypeRegistries.test.ts | tested before |
| notification templates (client union vs server table) | src/lib/notifications.ts | supabase/functions/_shared/notification-templates.ts | src/test/edge/create-notification.test.ts | tested before |
| every RPC error code has client copy | src/lib/lifecycleErrors.ts and call sites | RAISE codes in the newest function bodies | src/test/rpcErrorCopyCoverage.test.ts | tested before |
| report rate-limit code has client copy | src/lib/reportErrors.ts | reports_rate_limit trigger | src/test/reportIntakeIsRateLimited.test.ts | tested before |
| consequence ladder and its copy | src/lib/reliabilityLadder | SQL ladder | src/lib/reliabilityLadder.parity.test.ts, src/test/consequenceCopyParity.test.ts | tested before |
| fixture rows admitted by every CHECK | e2e and src fixtures | every parsed CHECK | src/test/fixtureSchemaContract.test.ts | tested before |
| saved-search radius > 0 | src/components/SavedSearches.tsx:212 (parseNearbyFilter) | saved_searches_radius_miles_positive | none | NOT TESTED |

## One-sided rules (not pairs; recorded so they are not mistaken for covered)

Measured by grepping every migration for `length(` / `char_length(` on these
columns and the edge functions that write them: no server bound exists.

| rule | client file:line | server | status |
|---|---|---|---|
| job title max 32 / description max 1000 | src/components/postjob/detailsSection/detailsSectionConstants.ts:23-24 | no CHECK on jobs.title / jobs.description | client-only; this is why F1's 4000-char description would post |
| application pitch max 500 | src/components/dashboard/applyConfirmDialog/applyConfirmDialogHelpers.ts:2 | none found | client-only |
| decline note max 200 | src/pages/posts/postedJobs/DeclineApplicantSheet.tsx:15 | none found | client-only |
| report detail min 10 / max 500 | src/components/ReportDialog.tsx:159-160 | none found | client-only |
| create-notification title 200 / message 1000 | none (callers pass generated copy) | supabase/functions/create-notification/index.ts:179 | server-only |

## Findings

**F1 (real mismatch, not changed here).** `ai-job-builder` bounds its output
more loosely than the form it fills. Measured by the guard's own readers on
2026-09-26: description 4000 vs 1000, special requirements 1000 vs 500, budget
ceiling 100000 vs 1000, budget floor 0 vs 10, group helpers 20 vs 10 and 1 vs
2. Client evidence: src/components/postjob/detailsSection/detailsSectionConstants.ts:24,
src/components/postjob/LogisticsSection.tsx:465, :369-370, src/lib/moneyLimits.ts:27.
Server evidence: supabase/functions/ai-job-builder/sanitize.ts:12-16, :39, :47.
`applyAiJob` (src/pages/post-job/useJobEntry.ts:88) assigns them verbatim. The
budget and helper values are refused later by the form and the DB, so the poster
sees an error for a value they never typed; the description has no server bound
at all, so an over-length description can be posted. The server file is the
stale side, so this sweep recorded it in `KNOWN_DRIFT` (exact, both directions)
instead of changing it. The fix is to lower the sanitizer's bounds to the form's,
then delete the entries.

## Still open

1. Upload MIME allow-lists vs bucket `allowed_mime_types`, as one class guard (the same shape as uploadCapsWithinBucketLimit).
2. Saved-search radius vs `saved_searches_radius_miles_positive`.
3. F1 above.
4. Not measured live: every server number here was read from migrations and edge source, not from `pg_get_functiondef`/`pg_constraint` on prod (the Supabase connector failed to connect in this session).
