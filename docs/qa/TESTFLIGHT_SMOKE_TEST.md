# TestFlight smoke-test checklist

Walk every flow below on a real iOS device through the latest TestFlight build before promoting. Items marked ⚠️ are flows where regressions historically caused dead-ends; don't skip them even when in a hurry.

## Pre-flight (30 seconds)
- [ ] Latest build installed (Settings → Apps → Helpr → Version matches expected)
- [ ] Device language is English, dark mode off (catch the highest-contrast issues first; toggle to dark + Spanish only if base passes)
- [ ] Logged out of any prior session

## 1. First-run onboarding
- [ ] Cold launch hits guest dashboard, NOT the auth wall
- [ ] "Sign up" CTA on guest dashboard navigates to /signup
- [ ] Signup form: step 1 → 2 → 3 all advance, can go Back without losing data
- [ ] Email verification link from inbox lands back on /account-pending
- [ ] Approval simulation (admin approves) → dashboard loads with greeting

## 2. Profile completeness flow ⚠️
- [ ] Dashboard shows the gold "Finish your profile" banner when <60% complete
- [ ] Tap routes to Edit Profile
- [ ] Adding photo + bio + portfolio → banner disappears after a refresh
- [ ] Profile landing shows the new completion meter at 100% (and hides it)

## 3. Apply flow ⚠️
- [ ] Tap a job card → JobDetailDialog opens with the new payout pill
- [ ] "Apply now · earn $X" button shows correct payout math
- [ ] Queue-position strip shows when other applicants exist
- [ ] Submit application → toast brand-styled + parchment-colored
- [ ] Application appears in My Jobs tab

## 4. Direct offer (helper side) ⚠️
- [ ] Receive a direct offer from a poster → AppliedJobsTab shows gold "You were picked" eyebrow
- [ ] Accept → status moves to Awarded; chat header shows "Awarded" chip
- [ ] Decline → offer disappears, no double-fire

## 5. Post a job
- [ ] PostJob category picker → 5-up chip grid, brand color rings active selection
- [ ] Photo grid → dashed bark Add tile, sienna remove pill
- [ ] Review & Pay button shows the inline italic price
- [ ] Stripe Checkout opens (verify Apple Pay button appears on supported device)
- [ ] Return to /payment-success after successful payment
- [ ] Job appears in My Posts immediately

## 6. Boost flow
- [ ] Free poster: $3 boost card + "Free with Elite · See plans" link
- [ ] Elite poster: "Included with Elite" + "Free boost." + tap completes WITHOUT redirecting to Stripe
- [ ] After boost, "Boosted until [time]" chip appears on the job card
- [ ] Boost button disabled while active

## 7. Chat
- [ ] Tap a job's chat → header shows real avatar + job status chip
- [ ] Send a message → bubble is bark-gradient on my side
- [ ] Receive a message → bubble is parchment with hairline
- [ ] Read receipt: unread = check, read = recipient avatar/initials
- [ ] Quick replies show poster-specific chips when I posted, helper-specific when I applied

## 8. Job completion ceremony
- [ ] Helper marks complete → confetti fires (first 3 jobs only)
- [ ] Poster "Approve & release payment" → bark CTA + halo
- [ ] Payment toast confirms release
- [ ] 5-star review → "Send a tip?" prompt appears before close
- [ ] Tip flow: quick-pick gold pills + Send Tip bark CTA

## 9. Subscription
- [ ] Subscribed user sees "Your plan" hero with tier icon + Renews date
- [ ] Annual billing tab shows "Lock in pricing" gold-warm pill
- [ ] Manage Subscription → cancel survey appears with 4 reasons + email hook
- [ ] After survey, Stripe portal opens externally

## 10. Instant Payout (Pro/Elite)
- [ ] Free helper: paywall sheet shows + "See plans" routes to Subscription tab
- [ ] Subscribed helper: Cash out → breakdown card → confirm → redirects to debit
- [ ] Toast confirms payout en route

## 11. Notifications panel ⚠️
- [ ] Bell icon opens sheet — X button is tappable (safe-area test)
- [ ] Empty state shows frosted bell + "Nothing new yet."
- [ ] Real notification list: unread sienna pip, italic display titles
- [ ] Tapping a notification routes correctly

## 12. Settings + sub
- [ ] Notifications tab → "Daily match digest" toggle appears
- [ ] Toggle on → settings persist after sheet reopen
- [ ] Push master toggle → all rows below fade to 60% opacity

## 13. Referral
- [ ] Profile → Referral → Share button uses native iOS share sheet
- [ ] Copy code falls back if native share dismissed
- [ ] Code is uppercase + 6 chars

## 14. Saved Helpers
- [ ] Empty state has "After your next job..." nudge + "See your past helpers" link
- [ ] With a helper saved: "Offer a job" bark CTA, "Profile" outline, sienna heart to remove
- [ ] Tap Offer a job → routes to /post-job?offerTo with prefilled offerTo param

## 15. Map view
- [ ] Pins/Heat toggle works
- [ ] Heat view shows clustered density circles (bark→gold→sienna by count)
- [ ] Tap a heat bucket → popup "X jobs here"

## 16. Map / Maps integration
- [ ] Job detail "Where" tile → opens Apple Maps with address
- [ ] Job detail "Date" tile → opens Calendar

## 17. Cancellation
- [ ] Cancel a posted job → "Cancel \"\<title\>\"" italic title
- [ ] Tier fee breakdown matches policy table
- [ ] Sienna Cancel CTA (not destructive red)
- [ ] Job moves to Cancelled in My Posts

## 18. Dispute
- [ ] Request revision first → revision card appears
- [ ] Past revision deadline → "File a formal dispute" link visible
- [ ] Dispute dialog: sienna eyebrow, italic title, gold "fine print" callout
- [ ] Photo evidence upload works (5MB cap)
- [ ] Submission notifies admins (verify via Slack alert)

## 19. Edge cases ⚠️
- [ ] Open the app, lose connectivity, retry → no crashes, error states sensible
- [ ] Force-quit during Stripe redirect → return to app, see job intact in My Posts
- [ ] Pull-to-refresh on Dashboard, Activity, Messages → all show frosted spinner

## 20. Push notifications
- [ ] Receive a "🧹 Match for you" push on lock screen
- [ ] Tap → opens to the specific job's QuickApply
- [ ] Daily digest mode: turn on, post a non-urgent job from another account, verify NO immediate push
- [ ] Urgent job: push fires regardless of digest setting

---

## Out-of-scope for this build but flag for follow-up
- Helpr Pass wallet (signing certs needed)
- Saved-Helper availability push (cron not yet scheduled in Supabase)
- Live map heatmap is bucket-based, not true leaflet.heat — fine for v1, revisit if accuracy matters

## After all flows pass
Promote to App Store review.
