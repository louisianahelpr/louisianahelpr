# Seed coverage — what the mocked Supabase answers

Generated 2026-09-12 from a scan of `src/` (every `.from("…")` / `.rpc("…")`, including the
`(supabase.from as any)("…")` form; test files excluded) against
`e2e/happy-path/seedData.ts` (`SEED_TABLES`, `SEED_RPCS`) and `e2e/happy-path/seedDataHeavy.ts`.

The visual sweep and press-every-control run against `installSupabaseMocks` in
`e2e/happy-path/fixtures.ts`. Any table not listed as seeded answers `[]`; any RPC not listed
answers `null`. So an unseeded row below means **that screen has only ever been checked empty**.

- **Before (origin/main 2263feec8):** 6 tables seeded (profiles, jobs, applications, messages, reviews, notifications); 1 RPC (get_jobs_for_my_applications).
- **After:** 41 tables/views seeded; 28 RPCs answered from seeded rows.
- **Heavy (`seed: "heavy"`, `SWEEP_SEED=heavy`, `SEED=heavy`):** same tables, plus stress rows — 45 applicants on one job, 115 jobs in browse, a 220-message thread, 1000-character bios, a 150-character title, 4000-character messages, multibyte/emoji names, six-figure earnings.

Also fixed in the mock while doing this, because they made seeded data invisible:
- `{ count: "exact", head: true }` (HEAD) now gets a `Content-Range`, so admin counters read the seeded count instead of `null`.
- An ordered or column-filtered `profiles` list read (admin rosters, approval queues) returns the seeded pool, filtered; `.single()` own-profile reads are unchanged.
- `open_jobs_browse` (the browse view) is now seeded, derived from the open, owned seeded jobs.

"Screens" are the source files that issue the read (page, hook or component), which is the most
precise mapping a static scan can make; follow the hook to its page.

## Tables and views

| Table | Seeded (normal / heavy) | Rows (normal / heavy) | Read by |
|---|---|---|---|
| `admin_audit_log` | **yes (new)** / yes | 8 / 8 | components/admin/AdminAuditLog, components/admin/userDetail/UserAuditLog |
| `admin_user_notes` | **yes (new)** / yes | 4 / 4 | components/admin/AdminUserNotes, components/admin/useAdminUserSummaries |
| `analytics_events` | no — write-only (event capture); no screen reads it | — | _(write-only, 1 call site)_ |
| `applications` | yes (already) / yes | 10 / 55 | components/admin/adminHealth/useHealthData, components/admin/useAdminUserSummaries, components/dashboard/jobDetailDialog/useJobDetailData, components/dashboard/prefetchJobDialog, components/profile/LegalTab, hooks/useActivityBadgeCounts, hooks/useActivityData, hooks/useDashboardData, pages/HomeHistory, pages/activity/activityActions/useApplicantsState, pages/dashboard/useApplyFlow, pages/userProfile/useUserProfileData |
| `broadcast_dismissals` | no — per-viewer dismiss state; seeding it would hide the seeded broadcast | — | components/BroadcastBanner |
| `broadcast_messages` | **yes (new)** / yes | 3 / 3 | components/BroadcastBanner, components/admin/AdminBroadcasts |
| `cron_run_log` | no — admin System Health only; operational telemetry, not user-visible content | — | components/admin/adminHealth/useCronHealth |
| `cron_work_expectations` | no — admin System Health only; operational telemetry | — | components/admin/adminHealth/useCronHealth |
| `disputes` | **yes (new)** / yes | 4 / 4 | components/DisputeTimelineDialog, components/admin/AdminDisputes, components/admin/UnsettledSettlements |
| `email_send_log` | no — admin System Health / user drawer email history; operational telemetry | — | components/admin/adminHealth/useHealthData, components/admin/adminusers/useOpenProfile |
| `email_tracking` | no — admin user drawer email opens; operational telemetry | — | components/admin/adminusers/useOpenProfile |
| `error_logs` | no — admin System Health; seeding errors would make the health screen report a fault that is not there | — | components/admin/adminHealth/useCronHealth |
| `favorite_helpers` | **yes (new)** / yes | 4 / 4 | components/SaveHelperButton |
| `fraud_flags` | **yes (new)** / yes | 6 / 6 | components/admin/AdminFraudDashboard, components/admin/adminHealth/useHealthData |
| `group_job_helpers` | **yes (new)** / yes | 2 / 2 | components/GroupJobHelpers, hooks/useActivityData, hooks/useProfileTabData, pages/HomeHistory |
| `helper_availability` | **yes (new)** / yes | 7 / 7 | components/HelperAvailability, components/HelperAvailabilityDisplay, components/profile/AvailabilityTab, components/profile/ScheduleTab, hooks/useDashboardData |
| `helper_credentials` | **yes (new)** / yes | 6 / 6 | pages/userProfile/useUserProfileData |
| `helper_shadowbans` | no — write-only (admin action); no screen reads it | — | _(write-only, 1 call site)_ |
| `helper_verifications` | **yes (new)** / yes | 2 / 2 | components/admin/UserVerificationHistory |
| `helper_w9_records` | no — write-only (W-9 submit); no screen reads it | — | _(write-only, 1 call site)_ |
| `job_pets` | no — write-only from the post-job form; screens read pets via get_job_pets | — | _(write-only, 1 call site)_ |
| `job_revisions` | **yes (new)** / yes | 2 / 2 | components/activity/HelperRevisionCard |
| `job_tracking` | **yes (new)** / yes | 2 / 2 | components/JobTracking, hooks/useActivityData, pages/activity/activityActions/useLifecycleHandlers |
| `jobs` | yes (already) / yes | 25 / 197 | components/BlockUserDialog, components/CancellationDialog, components/CompletionPrompts, components/HelperPortfolio, components/JobConfirmation, components/JobTracking, components/PaymentTab, components/activity/CompletionChoiceSheet, components/activity/SeriesStrip, components/admin/AdminAnalytics, components/admin/AdminDisputes, components/admin/AdminExport, components/admin/AdminJobs, components/admin/AdminReports, components/admin/adminHealth/useConfigChecks, components/admin/adminHealth/useHealthData, components/admin/adminusers/useOpenProfile, components/admin/useAdminUserSummaries, components/dashboard/jobDetailDialog/useJobDetailData, components/dashboard/prefetchJobDialog, components/profile/HelperScheduleStrip, components/profile/LegalTab, hooks/useActivityData, hooks/useProfileTabData, hooks/useRecentPostedJobs, lib/nps, lib/supabaseResult, pages/Admin, pages/HelprWrapped, pages/HomeHistory, pages/PaymentSuccess, pages/WorkRecord, pages/activity/activityActions/useLifecycleHandlers, pages/activity/activityActions/useOfferHandlers, pages/dashboard/QuickApplyHandler, pages/dashboard/useDashboardSideQueries, pages/messages/messagesData/loadConversations, pages/messages/useMessagesData, pages/postjob/useJobFormEffects, pages/postjob/useJobSubmit, pages/userProfile/useUserProfileData |
| `legal_acceptances` | no — write-only (consent record); no screen reads it | — | _(write-only, 2 call sites)_ |
| `login_history` | **yes (new)** / yes | 5 / 5 | components/admin/useAdminUserSummaries, components/profile/SecurityTab |
| `message_reactions` | **yes (new)** / yes | 7 / 7 | components/messages/useMessageReactions |
| `messages` | yes (already) / yes | 38 / 258 | components/DesktopSidebarNav, components/mobileNav/useNavUnreadCount, pages/messages/messagesData/loadConversations, pages/messages/useMessagesData, pages/userProfile/useUserProfileData |
| `notification_logs` | **yes (new)** / yes | 3 / 3 | components/admin/AdminNotificationLogs |
| `notification_preferences` | **yes (new)** / yes | 2 / 2 | components/NotificationPreferences, components/admin/AdminNotifications |
| `notifications` | yes (already) / yes | 9 / 129 | components/NotificationPanel, components/admin/userDetail/UserAuditLog |
| `nps_responses` | no — read only to decide whether to prompt; a seeded answer would suppress the NPS prompt | — | lib/nps |
| `open_jobs_browse` | **yes (new)** / yes | 4 / 115 | hooks/useDashboardData, hooks/useDashboardJobsCount, pages/DashboardGuest, pages/JobDetail, pages/dashboard/QuickApplyHandler |
| `payout_transfers` | **yes (new)** / yes | 7 / 68 | components/PaymentTab, components/admin/AdminAnalytics, components/admin/AdminPayoutBatches, components/admin/adminHealth/useConfigChecks, components/profile/earningsTab/useEarningsData |
| `pet_profiles` | **yes (new)** / yes | 2 / 2 | components/postjob/PetPicker, pages/PetProfiles |
| `pif_credits` | **yes (new)** / yes | 2 / 3 | pages/GiftCard, pages/dashboard/useDashboardSideQueries, pages/postjob/usePifCredit |
| `platform_settings` | **yes (new)** / yes | 1 / 1 | components/admin/AdminSettings, components/admin/adminHealth/useConfigChecks |
| `profiles` | yes (already) / yes | 10 / 55 | components/GroupJobHelpers, components/StrikeBanner, components/TermsReconsentDialog, components/activity/appliedJobCard/ActiveJobSection, components/admin/AdminAnalytics, components/admin/AdminAuditLog, components/admin/AdminBanReview, components/admin/AdminDisputes, components/admin/AdminExceptionQueue, components/admin/AdminExport, components/admin/AdminFraudDashboard, components/admin/AdminIDVReview, components/admin/AdminJobs, components/admin/AdminPayoutBatches, components/admin/AdminReferrals, components/admin/AdminReports, components/admin/AdminSettings, components/admin/AdminSubscriptions, components/admin/AdminSupport, components/admin/AdminUserNotes, components/admin/AdminUsers, components/admin/AutoRestrictedRail, components/admin/UserVerificationHistory, components/admin/adminHealth/useHealthData, components/admin/adminusers/useOpenProfile, components/admin/userDetail/UserAuditLog, components/profile/AvailabilityTab, components/profile/CredentialsTab, components/profile/LegalTab, hooks/useActivityData, hooks/useCurrentUser, hooks/useDashboardData, hooks/useProfile, hooks/useReferralData, lib/onboardingTourCompletion, lib/validateResult, pages/Admin, pages/CompleteProfile, pages/GiftCard, pages/HelprWrapped, pages/HomeHistory, pages/Signup, pages/WorkRecord, pages/activity/activityActions/useApplicantsState, pages/activity/activityActions/useLifecycleHandlers, pages/activity/activityActions/useOfferHandlers, pages/postjob/useJobFormEffects, pages/postjob/useJobSubmit, pages/userProfile/useUserProfileData |
| `push_tokens` | no — presence check only (NotificationPreferences, Health); a seeded token would claim a device the browser does not have | — | components/NotificationPreferences, components/admin/adminHealth/useHealthData |
| `referral_codes` | **yes (new)** / yes | 2 / 2 | components/admin/AdminReferrals, hooks/useReferralData |
| `referral_credits` | **yes (new)** / yes | 3 / 3 | components/admin/AdminReferrals, hooks/useReferralData |
| `referrals` | **yes (new)** / yes | 3 / 3 | components/admin/AdminReferrals, hooks/useReferralData |
| `reports` | **yes (new)** / yes | 7 / 7 | components/admin/AdminReports, components/admin/AdminSupport, components/admin/useAdminUserSummaries, pages/Admin |
| `reviews` | yes (already) / yes | 7 / 57 | components/CompletionPrompts, components/admin/adminusers/useOpenProfile, components/admin/useAdminUserSummaries, components/profile/HelperStreakBadge, components/profile/LegalTab, components/profile/PublicReviewWall, components/reviewPanel/ReviewForm, components/reviewPanel/ReviewList, hooks/useActivityData, hooks/useProfileTabData, lib/reviewStats, pages/HelprWrapped, pages/WorkRecord, pages/userProfile/useUserProfileData |
| `saved_jobs` | **yes (new)** / yes | 3 / 3 | pages/dashboard/useDashboardSideQueries |
| `saved_searches` | **yes (new)** / yes | 3 / 3 | components/SavedSearches |
| `str_calendar_connections` | **yes (new)** / yes | 2 / 2 | pages/StrSettings |
| `thread_archives` | **yes (new)** / yes | 1 / 1 | lib/archivedConversations |
| `thread_pins` | **yes (new)** / yes | 2 / 2 | lib/pinnedConversations |
| `tips` | **yes (new)** / yes | 4 / 34 | components/admin/AdminAnalytics, hooks/useActivityData, hooks/useProfileTabData |
| `user_bans` | **yes (new)** / yes | 3 / 3 | components/admin/adminusers/useAdminUserActions, components/admin/adminusers/useOpenProfile, pages/AccountBanned |
| `user_blocks` | **yes (new)** / yes | 1 / 1 | hooks/useDashboardData, lib/userBlocks |
| `user_roles` | no — special-cased in fixtures.ts (empty unless a spec adds `mockTable("user_roles", [{ role: "admin" }])`); seeding it would turn every seeded session into an admin | — | components/admin/AdminAnalytics, components/admin/AdminExport, components/admin/AdminSettings, components/admin/adminHealth/useHealthData, hooks/useCurrentUser, pages/activity/activityActions/useLifecycleHandlers, pages/activity/activityActions/useOfferHandlers |
| `user_violations` | **yes (new)** / yes | 7 / 7 | components/admin/AdminBanReview, components/admin/AutoRestrictedRail, components/admin/adminusers/useOpenProfile, components/admin/useAdminUserSummaries, components/admin/userDetail/UserAuditLog, hooks/useActivityData, hooks/useProfileTabData |
| `verification_exceptions` | **yes (new)** / yes | 3 / 3 | components/admin/AdminExceptionQueue |

## RPCs

| RPC | Answered from seed | Called by |
|---|---|---|
| `accept_application` | no — mutation, not a screen read (mock answers `null`) | pages/activity/activityActions/useOfferHandlers |
| `accept_group_application` | no — mutation, not a screen read (mock answers `null`) | pages/activity/activityActions/useOfferHandlers |
| `admin_delete_review` | no — mutation, not a screen read (mock answers `null`) | components/admin/AdminReports |
| `admin_reverse_violation` | no — mutation, not a screen read (mock answers `null`) | components/admin/userDetail/UserAuditLog |
| `admin_support_queue` | **yes (new)** | components/admin/AdminSupport |
| `apply_low_rating_flag` | no — mutation, not a screen read (mock answers `null`) | components/CompletionPrompts |
| `apply_message_violation_consequence` | no — mutation, not a screen read (mock answers `null`) | pages/messages/logViolation |
| `are_users_blocked` | **yes (new)** | lib/userBlocks |
| `block_user_and_settle` | no — mutation, not a screen read (mock answers `null`) | lib/userBlocks |
| `clear_available_now` | no — mutation, not a screen read (mock answers `null`) | components/profile/AvailabilityTab |
| `clear_thread_mute` | no — mutation, not a screen read (mock answers `null`) | lib/threadMutes |
| `decline_job_offer` | no — mutation, not a screen read (mock answers `null`) | pages/activity/activityActions/useOfferHandlers |
| `get_category_price_stats` | **yes (new)** | hooks/useCategoryPriceStats |
| `get_fill_rate_stats` | **yes (new)** | components/admin/adminHealth/useFillRate |
| `get_helper_analytics` | **yes (new)** | hooks/useHelperAnalytics |
| `get_helper_earnings_export` | **yes (new)** | components/EarningsExport |
| `get_helper_tiers` | **yes (new)** | components/admin/AdminHelperTiers |
| `get_job_pets` | **yes (new)** | components/activity/JobPetCareSheet |
| `get_jobs_for_my_applications` | yes (already) | hooks/useActivityData |
| `get_muted_threads` | **yes (new)** | lib/threadMutes |
| `get_my_pending_direct_offers` | **yes (new)** | hooks/useActivityBadgeCounts, hooks/useActivityData |
| `get_my_reply_latency` | **yes (new)** | pages/userProfile/useUserProfileData |
| `get_my_saved_helpers` | **yes (new)** | components/profile/savedHelpersTab/useSavedHelpers, pages/postjob/OfferToSavedHelpr |
| `get_open_jobs_for_map` | **yes (new)** | components/BrowseMap |
| `get_parish_activity` | **yes (new)** | hooks/useHelprActivity |
| `get_parish_for_zip` | no — returns a parish name for a ZIP typed into a form; `null` = unknown ZIP, the form's own fallback | lib/parishLookup |
| `get_payout_batch_job_ids` | **yes (new)** | components/admin/AdminPayoutBatches |
| `get_payout_batches` | **yes (new)** | components/admin/AdminPayoutBatches |
| `get_pending_credentials` | **yes (new)** | components/admin/AdminCredentialQueue |
| `get_public_platform_settings` | **yes (new)** | hooks/useDashboardData, hooks/useOnboardingFee, lib/minSupportedBuild, lib/supabaseResult, pages/postjob/useJobFormEffects |
| `get_public_profile_reviews` | **yes (new)** | components/profile/PublicReviewWall, pages/userProfile/useUserProfileData |
| `get_public_profile_stats` | **yes (new)** | lib/reviewStats, pages/userProfile/useUserProfileData |
| `get_ranked_open_jobs` | **yes (new)** | _(no client caller)_ |
| `get_safe_profiles` | **yes (new)** | components/profile/PublicReviewWall, components/reviewPanel/ReviewList, hooks/useActivityData, hooks/useDashboardData, hooks/useProfileTabData, pages/DashboardGuest, pages/activity/activityActions/useApplicantsState, pages/messages/messagesData/loadConversations, pages/postjob/useJobFormEffects, pages/userProfile/useUserProfileData |
| `get_user_credential_tier` | **yes (new)** | hooks/useViewerCredentialTier, pages/userProfile/useUserProfileData |
| `get_user_last_active` | **yes (new)** | pages/messages/messagesData/loadConversations, pages/userProfile/useUserProfileData |
| `get_user_repeat_hire_percent` | **yes (new)** | pages/userProfile/useUserProfileData |
| `helper_abort_job` | no — mutation, not a screen read (mock answers `null`) | components/activity/appliedJobCard/ActiveJobSection |
| `helper_cancel_booking` | no — mutation, not a screen read (mock answers `null`) | components/activity/appliedJobCard/ConfirmedSection |
| `helper_mark_on_the_way` | no — mutation, not a screen read (mock answers `null`) | components/JobTracking |
| `instant_book_claim` | no — mutation, not a screen read (mock answers `null`) | pages/dashboard/useApplyFlow |
| `mark_helper_arrival` | no — mutation, not a screen read (mock answers `null`) | components/JobTracking |
| `poster_cancel_job` | no — mutation, not a screen read (mock answers `null`) | components/CancellationDialog |
| `process_referral` | no — mutation, not a screen read (mock answers `null`) | pages/Signup |
| `record_profile_view` | no — mutation, not a screen read (mock answers `null`) | pages/userProfile/useUserProfileData |
| `reject_other_applications_on_accept` | no — mutation, not a screen read (mock answers `null`) | pages/activity/activityActions/useOfferHandlers |
| `report_helper_no_show` | no — mutation, not a screen read (mock answers `null`) | pages/activity/activityActions/useLifecycleHandlers |
| `respond_to_review` | no — mutation, not a screen read (mock answers `null`) | pages/UserProfile |
| `review_credential` | no — mutation, not a screen read (mock answers `null`) | components/admin/AdminCredentialQueue |
| `rpc_check_application_rate` | **yes (new)** | lib/applyRateLimit |
| `rpc_decide_dispute` | no — mutation, not a screen read (mock answers `null`) | components/admin/AdminDisputes |
| `rpc_open_dispute` | no — mutation, not a screen read (mock answers `null`) | components/DisputeDialog |
| `rpc_record_application_attempt` | no — mutation, not a screen read (mock answers `null`) | lib/applyRateLimit |
| `rpc_withdraw_dispute` | no — mutation, not a screen read (mock answers `null`) | components/activity/appliedJobCard/DisputedSection, components/activity/postedJobCard/PostedJobActions |
| `search_profiles_by_name` | **yes (new)** | pages/payItForward/RecipientPicker |
| `set_available_now` | no — mutation, not a screen read (mock answers `null`) | components/profile/AvailabilityTab |
| `set_thread_snooze` | no — mutation, not a screen read (mock answers `null`) | lib/threadMutes |
| `toggle_thread_mute` | no — mutation, not a screen read (mock answers `null`) | lib/threadMutes |

## What the normal seed now contains

- **Jobs (25):** one per `job_status` (all 8) and every `jobs_payment_status_check` value (all 10:
  unpaid, escrow, payout_pending, released, refunded, cancelled, abandoned, failed, chargeback,
  cancelling); a group job with a roster, an urgent job, a pet-care job with pets, jobs the HELPER
  account posted (never role-based), a revision request, three disputes plus one withdrawn.
- **Messages:** the original 4 plus a 34-message thread on the in-progress fence job, with a
  reply-to, 7 reactions, pins for both accounts and one archived thread.
- **Money:** payouts in five different months (paid, pending, failed, reversed), tips in every
  `payment_status` and both `source` values, a sent and an available gift credit.
- **Reviews both ways**, including a poster response and a 2-star review the helper account wrote.
- **Helpr profile:** weekly availability, five credentials in five states, two pets, saved Helprs
  (with private notes), saved searches, saved jobs, referral codes/referrals/credits, STR calendar
  connections (one with a sync error), notification preferences, login history, a block.
- **Accounts:** approved with Stripe + IDV; pending; denied with reason; permanently banned;
  temp banned; IDV unverified with no Stripe; final warning with payouts disabled; the admin.
- **Admin:** 7 reports across every reported_type and 6 statuses, 7 violations, 6 fraud flags
  (4 open), 3 bans (2 active), 8 audit-log entries, 4 admin notes, 3 verification exceptions,
  platform settings, notification logs, verification history, broadcasts (active, scheduled, expired).

Guarded by `src/test/fixtureSchemaContract.test.ts` (every literal seeded row graded against the
migrations' CHECK constraints and the generated column list) and `src/test/seedDataHeavy.test.ts`
(status coverage, thread size, both review directions, account states, orphan job ids, RPCs derived
from rows, heavy additive + stress minimums + DB ceilings).
