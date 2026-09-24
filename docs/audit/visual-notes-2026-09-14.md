# Visual notes — 2026-09-14

55 entries (VN-1 … VN-55). Logged from owner screenshots/descriptions; locations read from code, causes marked unverified. Fixes land per the tracker below; each Confirmed tick has a before/after screenshot in visual-notes-2026-09-14/ and an ok review in its reviews.jsonl.


## Tracker

Ticked only with proof — `npm run visual-notes:check` fails otherwise. **Fixed** = `[x] <commit on main>`. **Confirmed** = `[x] <screenshot>` saved in `docs/audit/visual-notes-2026-09-14/` with an "ok" review of that screenshot in `reviews.jsonl` there, recorded after the fix commit. Owner questions (size "question") are closed by an answer, not a fix.

| VN | Issue | Size | Fixed | Confirmed |
|---|---|---|---|---|
| VN-1 | "ID verified" pill shows on the job-detail poster card | small | [x] 3d0d7a301 | [x] vn-1-after-vn1-detail-375.webp |
| VN-2 | Message button shows in the job popup after applying | small | [x] 3d0d7a301 | [x] vn-2-after-applied-detail-1440.webp |
| VN-3 | Earnings & Payouts page changes layout while it loads, and still looks messy (NEEDS DESIGN | large | [x] 98635843e | [x] vn-3-after-earn-375-final.webp |
| VN-4 | Share sheet shows a generic compass icon instead of the H logo | small–medium | [x] 8b3fbdb25 | [x] vn-4-after-linkpresentation-share-preview.webp |
| VN-5 | Browse search bar stretches across the whole list column | small | [x] e24bb4c3a | [x] vn-5-after-browse-search-1440.webp |
| VN-6 | Recent searches dropdown pushes the job list down instead of floating over it | small | [x] e24bb4c3a | [x] vn-6-after-browse-recents-1440.webp |
| VN-7 | Refine Your Search panel does not need its own X | small | [x] e24bb4c3a | [x] vn-7-after-browse-filters-tall-1920.webp |
| VN-8 | Too much empty space below Saved Searches in the filter panel | small | [x] e24bb4c3a | [x] vn-8-after-browse-filters-tall-1920.webp |
| VN-9 | Map pin preview card — extra white top band, ringed X, box doesn't fit the card | medium | [x] 6f67b8daf | [x] vn9-1440-light-preview.jpg |
| VN-10 | Clicking the job card on the map preview does nothing | small–medium | [x] ed9fdccf1 | [x] vn10-1440-fallback-detail.jpg |
| VN-11 | Map "Recenter" button uses the "my location" crosshair icon (NEEDS DECISION) | small | [x] 6f67b8daf | [x] vn11-375-granted.jpg |
| VN-12 | Remove availability from the public profile | small | [x] f0ace886a | [x] vn-12-after-public-profile-1440.webp |
| VN-13 | Public profile shows both "ID verified" and "Verification in progress" | small | [x] f0ace886a | [x] vn-13-after-public-profile-1440.webp |
| VN-14 | Are profile badges earned from the right numbers? (OWNER QUESTION — code read only) | medium | [x] 0864118ad | [x] vn-14-after-vn14-hallie-375.webp |
| VN-15 | Reviews on the public profile need a design discussion (same review shows twice) | large | [x] 56e452c7b | [x] vn-15-after-vn15-reviews-375.webp |
| VN-16 | "You've worked together N times" becomes a 5th stat tile; order tiles most → least importa | small–medium | [x] 50f18c09a | [x] vn-16-after-vn16-profile-375.webp |
| VN-17 | Profile badges are too big | small | [x] f0ace886a | [x] vn-17-after-public-profile-1440.webp |
| VN-18 | "Can't Finish" wording is wrong once the Helpr has confirmed (before work starts) | small | [x] f336fcf99 | [x] vn-18-after-jobs-confirmed-1440.webp |
| VN-19 | "Report a Problem" should sit beside Message, not under it | small | [x] bd5ecd567 | [x] vn-19-after-jobs-working-1440.webp |
| VN-20 | "Location confirmed" should not show on the tracker — show it on the map instead | medium | [x] 67d4eb138 | [x] vn-20-after-vn20-map-1440-dresser.webp |
| VN-21 | Job and post cards stack buttons in several rows — put them all on one row (NEEDS DESIGN D | large | [x] e208e155d | [x] vn-21-after-jobs-375-ontheway.webp |
| VN-22 | When a posted job is expanded, show the Helpr's profile under the description, not in the  | medium | [x] 8d2889021 | [x] vn-22-after-vn22-posts-1440-expanded.webp |
| VN-23 | Disputed jobs should still show the tracker | small–medium | [x] 4b3d69aa4 | [x] vn-23-after-vn23-disputed-1440.webp |
| VN-24 | Contact Support has a large empty band above the title — use the same shell as the other p | small–medium | [x] 0a60030d8 | [x] vn-24-after-vn24-support-1440.webp |
| VN-25 | Message composer should fill the bottom of the chat, not sit in a narrow centered strip | small | [x] 2ae979419 | [x] vn-25-after-chat3-1440.webp |
| VN-26 | "Tap a card to open it" tip strip isn't centered | small | [x] d49bc6d67 | [x] vn-26-after-myposts-done-1440.webp |
| VN-27 | Remove the grey background box from the location on job cards | small | [x] d49bc6d67 | [x] vn-27-after-myposts-done-1440.webp |
| VN-28 | Remove "report" from a job once it's done | small | [x] 4faf35fc9 | [x] vn-28-after-jobs-working-1440.webp |
| VN-29 | Keep a done job expanded until BOTH tip and review are done, then collapse | small–medium | [x] a36c47ee3 | [x] vn-29-after-vn29-done-1440.webp |
| VN-30 | Review quick-tag chips run off the edge and can't be scrolled | small | [x] d49bc6d67 | [x] vn-30-after-vn30-review-375.webp |
| VN-31 | Posts/Jobs search opens full width, and the chevron beside it is useless | small | [x] 571f6fcd2 | [x] vn-31-after-myjobs-search-1440.webp |
| VN-32 | My Jobs page jumps ~10 times before it settles | medium–large | [x] bb1b319ee | [x] vn-32-after-frame-02-381ms.webp |
| VN-33 | Helpr 2000+ miles away can still tap "I've Arrived" and move forward | medium–large | [x] c6ce514b1 | [x] vn-33-after-fix-after-375.webp |
| VN-34 | Rename "Request My Payout" on the Done step, and don't allow it until photos are uploaded | small | [x] e6a330db6 | [x] vn-34-after-jobs-working-1440.webp |
| VN-35 | Messages list header — move the chevron to the right of the hamburger; search opens too wi | small | [x] 107f092b2 | [x] vn-35-after-messages-search-1440.webp |
| VN-36 | "No reviews yet" star illustration looks crammed / disorganised | small | [x] 7bf9db6ba | [x] vn-36-after-profile-reviews-1440.webp |
| VN-37 | Content doesn't fill the page — small gap left and right on My Reviews and other Profile t | small–medium | [x] 485569f19 | [x] vn-37-after-vn37-myposts-1440.webp |
| VN-38 | Remove "Parish · Vermilion" from Edit Profile | small | [x] bdc3f53d1 | [x] vn-38-after-edit-profile-1440-zip.webp |
| VN-39 | Do skills & services and recent work show anywhere on the public profile? (OWNER QUESTION  | question | [ ] | [ ] |
| VN-40 | Edit Profile save bar — "Cancel" / "Up to Date" buttons | small | [x] 8b78763b4 | [x] vn-40-after-vn40-after-save-1440.webp |
| VN-41 | Schedule page — small calendar floating in a huge card, and Upcoming jobs cards full of de | large | [x] ad3ba91ea | [x] vn-41-after-sched-jobs-1440.webp |
| VN-42 | Saved Helprs should be one column, not a grid | small | [x] f70abb054 | [x] vn-42-after-saved-helpers-1440.webp |
| VN-43 | Remove the card design picker from gift cards | small | [x] c57c568be | [x] vn-43-after-gift-card-1440-occasion.webp |
| VN-44 | Plus tier (and Once / Annual) don't look enticing (OWNER QUESTION + PRICING DECISION) | medium | [x] a4bd85fe0 | [x] vn-44-after-vn44-plus-375.webp |
| VN-45 | Referrals says $15 earned / $15 to cash out, but 0 referrals and the rank tracker shows no | small–medium | [x] ec61d2ec0 | [x] vn-45-after-referrals-breakdown-1440.webp |
| VN-46 | Notifications settings page doesn't scroll | small–medium | [x] 27a7a4a09 | [x] vn-46-notifications-1440-bottom.png |
| VN-47 | Legal tab — remove "Download your data", and "contact support" is listed twice | small | [x] 34f87f288 | [x] vn-47-after-datarights-signedin-375.webp |
| VN-48 | Post a Job form labels aren't in Title Case | small | [x] e363d18d6 | [x] vn-48-after-postjob-1440-photo.webp |
| VN-49 | "Require before & after photos" box is too spread out / badly positioned | small | [x] 05d3332f6 | [x] vn-49-after-postjob-1440-photo.webp |
| VN-50 | How does a flexible-schedule job work on the tracker? (OWNER QUESTION — code read only) | medium | [ ] | [ ] |
| VN-51 | Repeating job should say "Start Date", not "Date needed" | small | [x] e363d18d6 | [x] vn-51-after-postjob-recurring-375.webp |
| VN-52 | Where is the Group job option? (OWNER QUESTION — code read only) | question | [ ] | [ ] |
| VN-53 | Pet care job — "Which pet is this for?" doesn't show the pets I've saved | small | [x] 937bc9093 | [x] vn-53-after-vn53-picker-roundtrip-1440.webp |
| VN-54 | Business name should show only after admin approves | small | [x] 211c00c3c | [x] vn-54-after-profile-business-name-pending-vs-verified-375.webp |
| VN-55 | Offered/hired Helpr must see the full address as text, not only on the map | small | [x] b1724cc69 | [x] vn-55-after-vn55-address-375.webp |

## Owner decisions (pop-ups, 2026-09-14)

- **VN-11** — make it a real "my location" button (keep the icon; center the map on the user).
- **VN-18** — once they're On the Way (or arrived) there is NO back-out. The back-out shows only after they've confirmed and before On the Way, labelled **"Cancel Job"**.
- **VN-21** — one row, primary action in the dark green (btn primary), other buttons beside it.
- **VN-33** — **both required**: nearby by GPS AND poster confirms. No fallback.
- **VN-34** — label **"Mark Job Complete"**; locked until photos are uploaded.
- **VN-44** — Plus gets **Featured badge, Priority Support, and more free boosts** (moved down from Elite / above Pro's 1). Once & Annual: owner meant the SAME perks list must show when Once or Annual is selected (display fix, not a pricing change).
- **VN-47** — move "Download your data" to the **Privacy page**; remove from Legal tab.
- **VN-50** — flexible = **any time that day** (keep current behaviour; no agreed-time step).
- **VN-52** — **fix Group jobs and turn them on** (split payment + per-Helpr tracking + review model, then flip GROUP_JOBS_ENABLED).

## By area / component

**Browse (Home /home, map, filters)** — VN-5 search width · VN-6 recents overlay · VN-7 filter X · VN-8 filter bottom gap · VN-9 map pin card · VN-10 map card click does nothing · VN-11 recenter icon
**Job detail dialog / sharing** — VN-1 ID verified pill · VN-2 Message after applying · VN-4 share icon compass
**Job cards + tracker (Jobs /jobs, Posts /posts; JobStepCard, JobTracking, PostedJobCard, AppliedJobCard)** — VN-18 Can't Finish wording · VN-19 Report a Problem beside Message · VN-20 Location confirmed → map · VN-21 all buttons one row, inside tracker box · VN-22 Helpr profile under description · VN-23 disputes keep tracker · VN-26 tip strip centering · VN-27 grey location chip · VN-28 no report once done · VN-29 keep expanded until tip+review · VN-31 search width + chevron · VN-32 page jumps on load · VN-33 arrival gate (GPS AND poster) · VN-34 rename payout button + photo gate
**Public profile (/user/:id)** — VN-12 remove availability · VN-13 drop "Verification in progress" · VN-14 badge rules (question) · VN-15 reviews shown twice · VN-16 worked-together 5th tile · VN-17 smaller badges · VN-39 skills/recent work (question)
**Own Profile tabs (/profile?tab=…)** — VN-3 Earnings load/layout · VN-36 empty reviews stars · VN-37 side gaps · VN-38 parish line in Edit Profile · VN-40 save bar · VN-41 Schedule dead space · VN-42 Saved Helprs one column · VN-44 Membership Plus/Once/Annual (question) · VN-45 Referrals credits vs count · VN-46 Notifications won't scroll · VN-47 Legal download + duplicate support (also Rules, Privacy)
**Messages** — VN-25 composer width · VN-35 header button order + search width
**Support / Help (PublicHeaderPage shell)** — VN-24 big top gap (Support + Help Center)
**Review popup** — VN-30 tag chips can't scroll
**Gift cards** — VN-43 remove design picker
**Post a Job (/post-job)** — VN-48 Title Case labels · VN-49 photo-proof box spacing · VN-50 flexible schedule (question) · VN-51 "Start Date" for recurring · VN-52 Group option (question) · VN-53 pet picker empty

**Same fix, several places:** search too wide VN-5 / VN-31 / VN-35 · "fill the space" VN-25 / VN-37 / VN-41 / VN-42 · layout shift on load VN-3 / VN-32 · reverses an earlier owner ruling VN-6 / VN-7 / VN-16 / VN-19 / VN-22

## By size

**Small** — VN-1, 2, 5, 6, 7, 8, 12, 13, 17, 18, 19, 25, 26, 27, 28, 30, 31, 34, 35, 36, 38, 40, 42, 43, 47, 48, 49, 51, 53
**Small–medium** — VN-4, 10, 11, 16, 23, 24, 29, 37, 45, 46
**Medium** — VN-9, 14, 20, 22, 44, 50
**Medium–large** — VN-32, 33
**Large / design discussion first** — VN-3, 15, 21, 41 (+ VN-52 if Group is re-enabled)

**Owner decisions:** all answered — see the section above.
**Money / trust — review before changing:** VN-14, VN-28, VN-33, VN-34, VN-44, VN-45

---

### VN-1: "ID verified" pill shows on the job-detail poster card
- Screen / route: Job detail dialog — /home?job=<id> (poster card "Posted by Hallie H.")
- Viewport / theme: 1440, light
- What the owner sees: "id verified does not need to show here. only in their profile"
- Where it lives: src/components/dashboard/JobPosterCard.tsx:223 (`{posterIdVerified && <IdVerifiedPill />}`), rendered by src/components/dashboard/JobDetailDialog.tsx:817
- Likely cause: JobPosterCard's trust row includes the IdVerifiedPill when `posterIdVerified`; also counts toward `showTrustRow` at :81, so removing it may drop the whole row/divider when no tier or repeat jobs (unverified)
- Shared with: IdVerifiedPill is also used on the profile (src/pages/user/RecognitionRow.tsx) — that one stays
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-2: Message button shows in the job popup after applying
- Screen / route: Job detail dialog, "Applied" state — /home?job=<id>
- Viewport / theme: not specified (all)
- What the owner sees: "once someone has applied to a job, that pop up that says applied, does not need a message button. they can [not] message the poster unless they have been offered/ accepted"
- Where it lives: src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx:108-123 (Message / "Ask a question" IconActionButton)
- Likely cause: gate deliberately includes `viewerAppPosition != null` (any applicant) at :112 per the comment at :95-100; owner wants only poster / offered_to_helper_id / helper_id (unverified)
- Shared with: JobDetailFooter only renders in JobDetailDialog; backend poster-first messaging rule may also allow applicants — check it matches
- Size: small
- Screenshot: none

### VN-3: Earnings & Payouts page changes layout while it loads, and still looks messy (NEEDS DESIGN DISCUSSION)
- Screen / route: Profile → Earnings & Payouts — /profile?tab=earnings (/earnings redirects here)
- Viewport / theme: not specified
- What the owner sees: "earnings and payout page loaded one way, then completed loading and popped out another way. we need to discuss how to design that better. its still messy looking"
- Where it lives: src/components/profile/EarningsTab.tsx (703 lines); wallet skeleton → WalletCard at :567-590; MonthlyGoalCard gated on `!loading` at :467; view switcher src/components/profile/earningsTab/EarningsViewSwitcher.tsx
- Likely cause: two separate loading flags (`loading` for jobs, `stripeLoading` for Stripe) finish at different times; the wallet skeleton may not match the final card's size, the goal card appears from nothing when `loading` ends, and the Stripe connect block / wallet card swap depending on `stripeData.connected` — so sections show up and move one after another (unverified)
- Shared with: Profile tab page (document-scroll); the Stripe connect block also shows on the job apply popup ("Set Up Payouts")
- Size: large (redesign; owner wants to talk it through before any change)
- Screenshot: none

### VN-4: Share sheet shows a generic compass icon instead of the H logo
- Screen / route: Job detail dialog → Share button (corner) — /home?job=<id>; shared link is /jobs/<id>?ref=share
- Viewport / theme: 1440, light (Chrome on macOS, system share sheet)
- What the owner sees: "the compass when you go to share the job post, should be the h logo"
- Where it lives: src/components/jobs/ShareJobButton.tsx:165-185 (handleShare → shareNative with title/text/url); the preview for /jobs/:id is served by api/share.ts (vercel.json:23 rewrite) using scripts/generated/og-shell.js; icons in index.html:69-73 (favicon / apple-touch-icon) and og:image block
- Likely cause: the macOS share sheet draws the link's icon from the page it fetches for the shared URL; the compass is the OS placeholder when it can't get an icon from /jobs/<id> — either the api/share.ts HTML doesn't carry the apple-touch-icon/favicon links, or the fetch is blocked/redirected (index.html:15-26 notes robots.txt previously caused exactly this placeholder) (unverified)
- Shared with: every share surface via shareNative (ReferralSection, profile share); the /user/:id and signup share previews go through the same api/share.ts
- Size: small–medium (need to check what the shared URL returns to Apple's fetcher)
- Screenshot: pasted in chat (not saved)

### VN-5: Browse search bar stretches across the whole list column
- Screen / route: Home / browse jobs — /home (list column beside the map)
- Viewport / theme: 1440 (screenshot ~1920 wide), light
- What the owner sees: "the search bar should not take up the whole column"
- Where it lives: src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx:147-149 (`flex-1 min-w-0` wrapper and input container) and input `w-full` at :184; placed by src/components/dashboard/BrowseTasksToolbar.tsx
- Likely cause: the wrapper and field are `flex-1` / `w-full` with no max-width, so on desktop the field fills the full ~800px column (unverified)
- Shared with: BrowseSearchBar only on the browse toolbar (phone 375 opens it from the search icon in BrowseTasksActions — check width change doesn't affect that)
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-6: Recent searches dropdown pushes the job list down instead of floating over it
- Screen / route: Home / browse jobs — /home, search field focused with empty query
- Viewport / theme: 1440, light
- What the owner sees: "recents should expand like over the other stuff not push it down"
- Where it lives: src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx:224-270 (Recent listbox, `mt-1.5 ... bg-card` in normal flow)
- Likely cause: deliberate — the comment at :137-145 says it was moved OUT of absolute positioning into document flow after an earlier owner note "should push down, not overlap". The owner now wants the opposite (overlay); if made absolute again it must sit above the chip row/feed with a proper layer and shadow (unverified)
- Shared with: BrowseSearchBar only
- Size: small (but reverses an earlier owner decision — confirm)
- Screenshot: pasted in chat (not saved)

### VN-7: Refine Your Search panel does not need its own X
- Screen / route: Home / browse — /home → Filters (sliders) button → "Refine Your Search" dropdown panel
- Viewport / theme: 1440, light (desktop dropdown form)
- What the owner sees: "no x needed in the refine search tab. you tap the filter button again or out the box to close it"
- Where it lives: src/components/dashboard/FilterSheet.tsx:426-439 (close button in the panel header, desktop Popover branch); header row :423
- Likely cause: the X was added on purpose — comment at :419-422 says it came from an earlier owner note ("the x in search also doesn't close it"); owner now says the filter button / click-outside is enough. Check the phone bottom Sheet (:463+) separately — the ask was about this dropdown (unverified)
- Shared with: FilterSheet only (phone uses the Sheet branch of the same file)
- Size: small (reverses an earlier owner decision — confirm)
- Screenshot: pasted in chat (not saved)

### VN-8: Too much empty space below Saved Searches in the filter panel
- Screen / route: Home / browse — /home → Filters → "Refine Your Search", bottom of panel
- Viewport / theme: 1440, light
- What the owner sees: "there is also too much space below saved searches"
- Where it lives: src/components/dashboard/FilterSheet.tsx:223-226 (footer `px-5 pb-2` holding Saved Searches from src/components/dashboard/BrowseTasksToolbar.tsx:233-258); panel wrapper `flex-1 min-h-0` at :417 and PanelScroller :444
- Likely cause: the panel column is `flex-1` inside a Popover with a set height, so the scroller keeps extra height after the last row, plus bottom padding; the (hidden) Clear All slot adds nothing when 0 filters, so the gap is likely the panel height, not padding (unverified)
- Shared with: FilterSheet desktop dropdown; anchoredPanel.tsx screenPanelContentProps sizes other anchored panels too
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-9: Map pin preview card — extra white top band, ringed X, box doesn't fit the card
- Screen / route: Home / browse — /home, map view, tap a pin (preview card at bottom of map)
- Viewport / theme: 1440, light
- What the owner sees: "the cards on the map should not look like this. remove that extra white gap at the top. and the circle around the x and make the box fit the context better. there is actually no x even needed here. they can click out"
- Where it lives: src/components/BrowseMap.tsx:999-1066 — `<aside data-testid="browse-map-preview">` sheet; header lane with grab handle + close button at :1028-1060 (h-11 row); inner `<JobCard bare>` at :1066; width `max-w-[26rem]` wrapper at :960
- Likely cause: the preview wraps the feed's JobCard in a second bordered "sheet" and adds a 44px header row (grab handle + circled X) above it, so there's a card-inside-a-box with a blank band on top. Owner wants: no header row, no X (click outside closes — closePreview already exists :524-533), the box sized to the card itself. Keyboard close (Escape / focus return at :537-540) must keep working without the button (unverified)
- Shared with: JobCard `bare` is the feed card; the header lane and outer box are BrowseMap-only. Caret (:969-997) positions against this box
- Size: medium
- Screenshot: pasted in chat (not saved)

### VN-10: Clicking the job card on the map preview does nothing
- Screen / route: Home / browse — /home, map view → tap pin → tap the preview card (e.g. "Move-out clean for a one-bedroom", Baton Rouge, $145)
- Viewport / theme: 1440, light
- What the owner sees: "when you click on the job on the map, it should open the more details and apply stuff, right now it does nothing"
- Where it lives: src/components/BrowseMap.tsx:1066-1070 (`<JobCard onSelect/onApply={() => onJobAction?.(id)}>`) → src/components/dashboard/BrowseTasksFeed.tsx:498-501 (`filters.filteredJobs.find(...)`; `if (job) setDetailJob(job)`)
- Likely cause: the handler only opens the detail dialog if the pin's job is in the LIST's `filteredJobs`. In the screenshot the header says "3 jobs" but the list shows only the New Iberia job, and the Baton Rouge job from the map isn't in it — so `find` returns undefined and the click silently does nothing. The map's own job set (visibleJobs / mapFilter) and the feed list disagree (unverified)
- Shared with: BrowseMap preview only; separately, the map pins and feed count ("3 jobs") vs rendered list may be a separate bug worth checking
- Size: small–medium
- Screenshot: pasted in chat (same as VN-9, not saved)

### VN-11: Map "Recenter" button uses the "my location" crosshair icon (NEEDS DECISION)
- Screen / route: Home / browse — /home, map view, round button bottom-right of the map
- Viewport / theme: 1440, light
- What the owner sees: "the recenter map button looks like the button that would normally show your location on the map so idk what to do with this button but the icon doesn't use what it's used for globally"
- Where it lives: src/components/browseMap/MapLayers.tsx:117-145 (`RecenterControl`, lucide `Crosshair`, aria-label "Recenter map"); handler src/components/BrowseMap.tsx:701-706 (`setRegionAnimated(laRegion)` — zooms back out to all of Louisiana, NOT to the user)
- Likely cause: the crosshair is the universal "go to my location" symbol (and this app uses the near-identical LocateFixed for "use current location" in src/components/postjob/CurrentLocationPill.tsx:292), but this button resets to the whole-state view. Either change the icon to a "fit all / reset view" glyph, or make the button actually center on the user's location (owner undecided) (unverified)
- Shared with: LocateFixed in CurrentLocationPill (post a job) — that one stays as "my location"
- Size: small (icon swap) / medium (if it becomes a real "my location" button)
- Screenshot: pasted in chat (VN-9 screenshot, not saved)

### VN-12: Remove availability from the public profile
- Screen / route: Public profile — /user/:id (someone else's profile)
- Viewport / theme: not specified
- What the owner sees: "remove their availability from the profile" — owner confirmed via pop-up: public profile section only
- Where it lives: src/pages/user/UserProfile.tsx:773-774 (`<HelperAvailabilityDisplay helperId={userId!} />`), component src/components/HelperAvailabilityDisplay.tsx
- Likely cause: section rendered unconditionally in the profile body; removal is a straight cut (unverified)
- Shared with: own Profile keeps its Availability tab (src/components/profile/AvailabilityTab.tsx, row at useProfileLandingDerived.tsx:156) — the hours still drive "Jobs During My Hours" filter, so only the public display goes
- Size: small
- Screenshot: none

### VN-13: Public profile shows both "ID verified" and "Verification in progress"
- Screen / route: Public profile — /user/:id, recognition/badge row
- Viewport / theme: not specified
- What the owner sees: "not sure why it says id verified and verification in progress. its either done or its not, nothing is in progress here?"
- Where it lives: src/pages/user/RecognitionRow.tsx:440-450 (ID verified pill) and :457-470 (amber "Verification in progress" chip, shown when `hasSubmittedCredentials`); data from src/pages/user/useUserProfileData.ts:870-874 (`has_pending_credentials`) and :898-910 (helper_credentials count query)
- Likely cause: two different things share the word "verification" — "ID verified" is Stripe identity; "in progress" means a CREDENTIAL (license/insurance) is pending review. Shown side by side they read as a contradiction. OWNER DECISION: delete the "Verification in progress" chip from the profile entirely (the pending-credential query at useUserProfileData.ts:898-910 and `has_pending_credentials` then have no reader — report, don't remove, per dead-code rule). Possibly also the pending flag stays true for a credential that's already been handled (check helper_credentials status for that user) (unverified)
- Shared with: RecognitionRow only (profile); DashboardStatusBanners.tsx:61 and IDVPromptDialog.tsx:199 use "Verification in progress" for a different (account) meaning — not part of this note
- Size: small
- Screenshot: none

### VN-14: Are profile badges earned from the right numbers? (OWNER QUESTION — code read only)
- Screen / route: Public profile — /user/:id, badge row (First Job, Rising Star, Trusted Helpr, Neighborhood Pro, Community Pillar, Elite Helpr, Licensed Pro, Master Helpr)
- Viewport / theme: n/a
- What the owner asks: "in order to get the badges is it correctly tracked"
- Where it lives: rules src/lib/careerLadder.ts:17-100 (`CAREER_MILESTONES`, `getEarnedMilestones`); inputs src/pages/user/UserProfile.tsx:536-542; stats src/pages/user/useUserProfileData.ts:537-547 from RPC in supabase/migrations/20260901002325_public_profile_stats_for_strangers.sql:224-225
- Likely problems found reading code (unverified live — must check `pg_get_functiondef` on prod before believing):
  1. Job counts include jobs they POSTED. `completedJobs` uses `completed_jobs_total` (= every completed job they were on, posted or worked, :225), not `completed_jobs_as_helper` (:224). So someone who only posts 5 jobs gets "Rising Star · 5 jobs completed" / "First Job · Completed your first job". The client fallback (:524) does the same (posted + worked).
  2. "Community Pillar" says "3+ repeat posters" but the rule checks `repeatHirePercent >= 20` (a percentage, not a count) — description and rule disagree (careerLadder.ts:53-57).
  3. "Licensed Pro" needs `credentialTier >= 2`; credentialTier falls back to 0 on any RPC error (useUserProfileData.ts:865-868), so an error silently hides a badge someone earned.
  4. Ratings: avgRating must be checked for WHICH reviews (as helper vs as poster) the RPC averages — "Trusted Helpr · 4.5+ rating" should use helper-side reviews only.
  5. Badges are computed on each view, never stored — no history, and one lower rating can take a badge away.
- Shared with: own Profile landing badges (useProfileLandingDerived.tsx) and `computeBadges` / `computeHelperTier` use the same stats — check they agree
- Size: medium (logic + possibly RPC change; not visual)
- Screenshot: none

### VN-15: Reviews on the public profile need a design discussion (same review shows twice)
- Screen / route: Public profile — /user/:id after tapping the "5.0 · 1 review" tile (e.g. Hallie H., /user/437de07d-…)
- Viewport / theme: 1440, light
- What the owner sees: "these reviews need to be discussed for better design"
- Where it lives: src/pages/user/UserProfile.tsx:673 (`RatingBreakdown`), :704-718 (`PublicReviewWall` — compact card with CLEANING chip), :722+ (`ReviewsSection` — full card with "For: Cleaning", date, ⋯ menu), src/pages/user/ReviewsSection.tsx
- Likely cause: expanding reviews mounts TWO lists of the same reviews — the "recent reviews" wall and the full filterable list — so with 1 review the identical quote appears twice in two different card styles, one after the other (unverified). The `[SWEEP]` prefix in the text is test seed data, not a UI bug
- Shared with: RatingBreakdown / PublicReviewWall / ReviewsSection are profile-only; an earlier owner note (2026-08-25, "opens 3 blank tabs") trimmed the empty case — the populated case still stacks them
- Size: large (design discussion — owner wants to talk it through first)
- Screenshot: pasted in chat (not saved). Also visible: VN-13 chips, VN-12 Availability, and "Trusted Helpr" earned with 16 jobs but only 1 review — backs up VN-14 (a single 5.0 passes the 4.5+ rule)

### VN-16: "You've worked together N times" becomes a 5th stat tile; order tiles most → least important
- Screen / route: Public profile — /user/:id, stats row under the header (5.0 · 1 review / 4 Jobs posted / 16 Jobs completed / 55% Cancelled)
- Viewport / theme: 1440, light (check 375 — 5 tiles must wrap cleanly)
- What the owner sees: "you've worked together however many times can be a 5th box next to review, jobs posted, completed etc. order in most important to least"
- Where it lives: tiles src/pages/user/AtAGlanceCard.tsx:200-250 (`cells.push` rating → posted → worked → cancelled) rendered from src/pages/user/UserProfile.tsx:564; the line to move is src/pages/user/ProfileHeaderCard.tsx:370-385 (`mutualJobsCount`)
- Likely cause: the card is hard-capped at four tiles by an earlier owner ruling (comment at AtAGlanceCard.tsx:236-250, 2026-09-11: "exactly four… nothing else") — this note changes that ruling to five. Order not specified; a sensible proposal to confirm: Rating · Worked together · Jobs completed · Jobs posted · Cancelled (unverified)
- Shared with: AtAGlanceCard profile-only; "worked together" only shows to a viewer who has shared jobs, so the tile must hide when 0 (as today)
- Size: small–medium
- Screenshot: pasted in chat (VN-15 screenshot, not saved)

### VN-17: Profile badges are too big
- Screen / route: Public profile — /user/:id, VERIFIED and AS A HELPR badge rows (ID verified, Trusted Helpr, Rising Star, First Job)
- Viewport / theme: 1440, light
- What the owner sees: "the badges also need to be smaller"
- Where it lives: src/pages/user/ProfileBadge.tsx:44-49 (`PROFILE_BADGE_PILL` px-2.5 py-1.5 text-ds-12; `ICON_CLASS` w-3.5), used by every chip in src/pages/user/RecognitionRow.tsx
- Likely cause: one shared pill size for all badges; in the screenshot the AS A HELPR chips render taller with larger icons than the VERIFIED ones, so milestone icons may not be getting ICON_CLASS applied (unverified). Keep the 44px tap target (the `after:h-11` overlay) when shrinking the visible pill
- Shared with: ProfileBadge / RecognitionRow (public profile; check own Profile landing if it reuses them)
- Size: small
- Screenshot: pasted in chat (VN-15 screenshot, not saved)

### VN-18: "Can't Finish" wording is wrong once the Helpr has confirmed (before work starts)
- Screen / route: Jobs (Activity → jobs I'm working) — hired job card in the confirmed / scheduled / on-the-way / arrived steps
- Viewport / theme: not specified
- What the owner sees: "i don't like the wording can't finish when they have confirmed"
- Where it lives: src/pages/jobs/appliedJobCard/ActiveJobSection.tsx:246-253 (exit chip label "Can't Finish", aria "Can't finish this job?…"); confirm dialog :336 ("Can't Finish This Job?") and :342 ("I Can't Finish"); after-state copy :279-280 ("You've told the poster you can't finish…")
- Likely cause: the exit is only offered BEFORE work starts (scheduled → arrived, per comment :104-115), but the copy talks about "finishing" a job that hasn't begun. Wording to be picked with the owner — e.g. "Can't Make It" / "Cancel My Spot" (unverified)
- Shared with: step contract src/pages/jobs/appliedJobCard/steps/stepContract.ts:22-24 and WorkingStep.tsx:9 comments refer to it; all copy lives in ActiveJobSection
- Size: small (copy only; wording needs owner pick)
- Screenshot: none

### VN-19: "Report a Problem" should sit beside Message, not under it
- Screen / route: My Jobs — /jobs, Needs You tab, hired job card in the Working step (e.g. "Touch up hallway and stairwell", Perry P., $154)
- Viewport / theme: 1440, light
- What the owner sees: "report a problem should not be under the message tab but on the side of message"
- Where it lives: src/pages/jobs/appliedJobCard/ActiveJobSection.tsx:255-275 (`escape: <DisputeLink label="Report a Problem">`, underlined link); placed by src/pages/jobs/appliedJobCard/steps/WorkingStep.tsx:41 (`actions={[messageChip]}` with the escape link rendered below the row)
- Likely cause: deliberate — comment at :256-259 says it's a quiet link "below the row, never in it: a dispute freezes escrow and is not a peer of Message". Owner now wants it in the action row next to Message, the same way "Can't Finish" sits beside Directions/Message in the earlier steps (visible in the card above). Needs a chip styled like the Can't Finish danger chip (unverified)
- Shared with: stepContract.ts:22-24 (exitChip / escape slots); every helper step that shows `escape` (Working and later); poster-side DisputeLink uses are separate
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-20: "Location confirmed" should not show on the tracker — show it on the map instead
- Screen / route: Job tracker (step rail) on active job cards — /jobs and the poster's view of the same job; the tracking map inside the same component
- Viewport / theme: not specified
- What the owner sees: "Location confirmed does not need to show on the tracker, it should be on the map"
- Where it lives: caption under the Arrived step — src/components/JobTracking.tsx:1329 (`arrivalCaption = arrivalStateLabel(...)`) rendered ~:1780-1796; label text src/lib/arrivalGate.ts:66-72 ("Poster confirmed" / "Location confirmed"); map at src/components/JobTracking.tsx:1901 (`<TrackingMap>`, src/components/TrackingMap.tsx)
- Likely cause: arrival verification is drawn as a caption in the step rail; owner wants it moved to the map (e.g. a marker/label at the job pin). Related: the status line under the rail ("Arrival GPS-verified · last ping at the job", "Location shared · at the job", JobTracking.tsx:377-402) says the same kind of thing — confirm whether that line moves to the map too (unverified)
- Shared with: JobTracking is used by both the Helpr card (appliedJobCard) and the poster's posted-job card; "Poster confirmed" caption uses the same slot
- Size: medium
- Screenshot: none (previous /jobs screenshot shows the status line, not the caption)

### VN-21: Job and post cards stack buttons in several rows — put them all on one row (NEEDS DESIGN DISCUSSION)
- Screen / route: My Jobs (/jobs) and Posts cards — every step card (e.g. Working: big "Request My Payout" bar, "Add Photo" bar, then a "Message" row, then "Report a Problem" link; Confirmed: "I'm On My Way" bar, then Directions · Message · Can't Finish row; Revision: "I'll Fix It" + Message)
- Viewport / theme: 1440, light (must also work at 375)
- What the owner sees: "i don't think i like the multiple rows of buttons for jobs and posts. can all the buttons be on 1 row like i'll fix it, message etc"
- Where it lives: shared shell src/components/job-card/JobStepCard.tsx:32-112 — slots `ask` → `notice` → `primary` (full width) → `actions` (chip row) → `escape` stacked vertically; used by ~15 files incl. src/pages/jobs/appliedJobCard/steps/*.tsx (WorkingStep, OnSiteStep, EnRouteStep, RevisionStep…) and the poster-side cards; "I'll Fix It" in RevisionStep.tsx / HelperRevisionCard.tsx
- Likely cause: the shell's documented contract is one full-width primary + a separate chip row + a separate escape line, each its own row by design (enforced by singlePrimaryCta.test.tsx, JobStepCard.tsx:39). One row means changing that contract for every step: primary + chips side by side, which at 375 needs a rule for 3–4 buttons (unverified)
- Owner follow-up: "also all buttons should be with the live tracker box" — read as: every button (the one row) sits INSIDE the white tracker box, like "I'm On My Way" / "Request My Payout" do now, instead of Directions · Message · Can't Finish and the Add Photo / Message boxes hanging below it (confirm)
- Owner follow-up (poster side): "confirm they're working, no show, message etc — all of these buttons need to be on 1 line not multiple" — src/pages/posts/postedJobCard/steps/InProgressStep.tsx:160 ("Confirm They're Working" full-width primary) and :170 ("No-Show" chip) + Message chip. Confirms the one-row rule applies to Posts cards as well as Jobs cards
- Shared with: every JobStepCard user (helper and poster steps); also ties in VN-18 (Can't Finish chip) and VN-19 (Report a Problem into the row)
- Size: large (shared shell, all steps, both sides; design talk first)
- Screenshot: /jobs screenshot from VN-19 (not saved)

### VN-22: When a posted job is expanded, show the Helpr's profile under the description, not in the small name line / tracker header
- Screen / route: Posts — posted job card with a hired Helpr, expanded
- Viewport / theme: not specified
- What the owner sees: "the profile for who's working the job should be shown when the job is expanded under the job description, not in that little area"
- Where it lives: tiny inline name row src/pages/posts/PostedJobCard.tsx:157-171 (4px-dot avatar + name link, hidden when expanded with the tracker); when expanded the Helpr's name/avatar moves into the tracker header (JobTracking via :525 `helperName`); description block :367-372
- Likely cause: an earlier owner ruling put the Helpr "in the tracker" (comment :146-155), so expanded cards show them only as a small identity in the tracker header. Owner now wants a proper profile block (avatar, name, rating, link) right under the description when expanded (unverified)
- Owner follow-up (with /posts screenshot): "the person working the job should show when it's expanded, not like that" — i.e. REMOVE the small "H Hallie H." line from the collapsed card (PostedJobCard.tsx:157-171); the Helpr only appears, as a proper profile block, once expanded
- Shared with: helper-side AppliedJobCard shows the POSTER the same small way ("P Perry P." row) — confirm whether that side should match; JobTracking header used by both
- Size: medium
- Screenshot: none

### VN-23: Disputed jobs should still show the tracker
- Screen / route: My Jobs (/jobs) — Helpr's card for a disputed job (check Posts side too)
- Viewport / theme: not specified
- What the owner sees: "disputes should still show the tracker"
- Where it lives: src/pages/jobs/appliedJobCard/DisputedSection.tsx:106-115 — dispute banner is put in the JobStepCard `header` slot where the tracker normally goes ("A disputed job has left the step rail"); mounted from src/pages/jobs/AppliedJobCard.tsx:493
- Likely cause: helper side swaps the tracker OUT for the dispute banner on disputed jobs. Poster side (PostedJobCard.tsx:105-117 `showsTracker`) already includes `disputed`, so the two sides disagree. Fix direction: tracker stays as the header, dispute banner goes below it (unverified)
- Shared with: JobTracking (both sides); DisputedSection helper-only
- Size: small–medium
- Screenshot: none

### VN-24: Contact Support has a large empty band above the title — use the same shell as the other pages
- Screen / route: /support (e.g. from Report a Problem: ?topic=report&subject=Dispute on …), signed in
- Viewport / theme: 1440, light
- What the owner sees: "remove the large space above contact support, it should follow the same shell as the others"
- Where it lives: src/pages/info/Support.tsx:281 (`<PublicHeaderPage title="Contact Support" bottomPaddingClassName="pb-8">`); shell src/components/marketing/PublicHeaderPage.tsx (PublicLayout + PageHeader)
- Likely cause: Support is built on the MARKETING/public page shell (PublicLayout) even for signed-in users, so it gets the public layout's top offset instead of the signed-in page spacing (AppPage / PageHeader, 24px title rule) that Posts/Jobs/Messages use (unverified)
- Owner follow-up (2026-09-14, /help screenshot): Help Center has the SAME large empty band above its title — "remove that large spacing". Confirms the fix belongs in the shared shell (all PublicHeaderPage pages when signed in), not just Support
- Shared with: PublicHeaderPage is used by 4 pages in src/pages (legal/marketing-style pages) — fixing only Support vs changing the shell affects those
- Size: small–medium
- Screenshot: pasted in chat (not saved)

### VN-25: Message composer should fill the bottom of the chat, not sit in a narrow centered strip
- Screen / route: Messages — /messages?chat=<n> (open conversation, e.g. Perry P. · "Fix a leaking kitchen faucet", DISPUTED)
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "the bottom message part needs to fill the bottom area"
- Where it lives: src/components/messages/ChatView.tsx:338 (`w-full max-w-[780px] mx-auto` column holding the timeline + composer); composer src/components/RichMessageInput.tsx inside src/components/messages/chatView/ChatPaneShell.tsx:69/110
- Likely cause: the whole chat column is capped at 780px and centered, so on desktop the composer (+ mic, send) and the off-platform warning banner float in the middle of a ~1570px pane with wide blank sides; the pane header (name, DISPUTED, ⋯) is NOT capped, so header and composer don't line up (unverified). Owner wants the composer full-width across the bottom — confirm whether the message bubbles/banner should widen too
- Shared with: ChatView only (all conversations); phone 375 unaffected by the 780 cap
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-26: "Tap a card to open it" tip strip isn't centered
- Screen / route: Posts — /posts, Needs You tab, tip strip above the cards (also check Jobs if it shows there)
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "tap a card needs to be centered better"
- Where it lives: src/pages/posts/PostedJobsTab.tsx:118-150 (strip: `flex items-start gap-2 … px-3 py-2`, pin icon `mt-0.5`, text `flex-1` left-aligned, dismiss button `-m-2.5`)
- Likely cause: content is `items-start` + left-aligned text across a ~1540px strip, and the X's negative margin/padding offsets it, so the icon, one line of text and the X don't sit on the same vertical centre and the text hugs the left (unverified). Confirm whether owner means vertical centring in the strip or centring the text horizontally
- Shared with: tip strip is local to PostedJobsTab
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-27: Remove the grey background box from the location on job cards
- Screen / route: Posts — /posts (every card's meta row: "Lafayette", "Baton Rouge"…); same row on Jobs cards
- Viewport / theme: 1440, light
- What the owner sees: "remove the grey background from the location"
- Where it lives: src/components/job-card/JobCardMetaRow.tsx:302 (location button: `rounded-ds-sm border border-[hsl(var(--olivewood)/0.22)] bg-[hsl(var(--olivewood)/0.06)]` + hover/active fills)
- Likely cause: the location is styled as a tappable chip (press-and-hold for directions) with its own tinted fill and border, so it reads as a grey box next to plain date/time text (unverified). Remove the resting fill/border; keep the 44px hit area (`py-2 -my-2`) and the press feedback
- Shared with: JobCardMetaRow — PostedJobCard, AppliedJobCard (Jobs), dashboard JobCard (browse feed), ScheduleTab; check each still wants the chip look removed
- Size: small
- Screenshot: /posts screenshot from VN-26 (not saved)

### VN-28: Remove "report" from a job once it's done
- Screen / route: Posts and Jobs cards for completed jobs (Done tab)
- Viewport / theme: not specified
- What the owner sees: "they can't report a job once it's done" — owner confirmed via pop-up: RULE, remove the option (not a missing-option bug)
- Where it lives: src/components/jobs/DisputeLink.tsx:11-17, 49+ (`shouldShowDisputeLink` — shows on `completed` for up to 7 days, both sides); Helpr card src/pages/jobs/AppliedJobCard.tsx:559-563 and :571-576 (issue #113: link kept even after reviewing); poster card src/pages/posts/postedJobCard/steps/CompletedStep.tsx:42 (`canDispute`)
- Likely cause: a deliberate 7-day post-completion dispute window (issue #113). Owner rule: no report/dispute once done. NOTE for whoever fixes: this removes the only in-app path to contest a finished job (payout already released) — the backend dispute RPC may still accept it; say where users go instead (Support) (unverified)
- Shared with: DisputeLink used on both card types; revision_requested case on poster side is separate (not "done")
- Size: small (UI) — flag money/dispute rules before changing
- Screenshot: none

### VN-29: Keep a done job expanded until BOTH tip and review are done, then collapse
- Screen / route: Posts — /posts Done tab (poster's completed job cards); check Jobs Done tab for the review-only equivalent
- Viewport / theme: not specified
- What the owner sees: "if they have a tip or review still needing to be done on a done job, leave it expanded until tip and review are both done, when they're done then collapse"
- Where it lives: tip/review state src/pages/posts/PostedJobCard.tsx:630-670 (`completedJobMeta[job.id]` tipped / reviewed; collapsed summary strips "Tipped & Reviewed" / "— review still open"); expand state `isExpanded` in PostedJobCard / JobCardShell; Helpr side AppliedJobCard.tsx `isFullyDone` (~:567-585)
- Likely cause: expansion is purely user-toggled; nothing opens a completed card by default when tip or review is outstanding, and nothing collapses it once both are done (unverified). Needs: default expanded when !(tipped && reviewed); auto-collapse when the second one lands
- Shared with: JobCardShell (shared expand/collapse for both card types)
- Size: small–medium
- Screenshot: none

### VN-30: Review quick-tag chips run off the edge and can't be scrolled
- Screen / route: "Rate Hallie H." review popup — from /posts?filter=done (Review on a completed job)
- Viewport / theme: 1440, light (desktop mouse; check 375 touch too)
- What the owner sees: "can['t] scroll these options" — chips "Great communicator · On time · Quality work · Very profession…" cut off at the right; the rest ("Highly recommend", "Friendly & helpful") are unreachable
- Where it lives: src/components/reviewPanel/ReviewForm.tsx:281-289 (chip row `flex gap-2 overflow-x-auto scrollbar-none` + right-edge fade mask); options src/components/reviewPanel/types.ts:73-85
- Likely cause: horizontal scroll strip with the scrollbar hidden — on desktop a mouse wheel scrolls vertically, so there's no visible way to reach the hidden chips; the fade + clipped chip reads as broken. Fix direction: wrap the chips onto 2 rows (6 short options) instead of a hidden-scroll strip (unverified)
- Shared with: ReviewForm (poster reviewing Helpr and Helpr reviewing poster); CompletionPrompts.tsx:80 has its own copy of the same six options
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-31: Posts/Jobs search opens full width, and the chevron beside it is useless
- Screen / route: Posts — /posts?filter=done after tapping the search icon (same header on Jobs /jobs)
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "search does not need to open that large. also the chevron on the right is useless here"
- Where it lives: src/components/job-card/ActivityHeader.tsx:163-200 (open search: `relative flex-1 min-w-0` wrapper, input `w-full`, replaces the status tabs); chevron button :222-231 (`setTabsOpen`, aria "Hide status filters" / "Filter by status", ChevronDown rotated)
- Likely cause: when search opens it swaps out the tab row and the field grows `flex-1` across the whole ~1500px header; the chevron is the "show status tabs" toggle that only makes sense when search hides the tabs — on desktop there's room for both, so it reads as a dead up-arrow in a box (unverified). Direction: cap the field width and keep the tabs visible so the chevron can go
- Shared with: ActivityHeader serves both Posts and Jobs; same width issue as VN-5 (browse search bar)
- Size: small
- Screenshot: pasted in chat (not saved). Also visible: "Report Job" still on done jobs (VN-28), four buttons in one row (VN-21), grey location chip (VN-27)

### VN-32: My Jobs page jumps ~10 times before it settles
- Screen / route: Jobs — /jobs (Needs You tab, hired cards with trackers, photo asks, payout button)
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "this page jumps about 10 times before it settles"
- Where it lives: page src/components/job-card/JobListPage.tsx (route skeleton App.tsx:185 `ActivityRouteSkeleton` → in-page skeletons :423-444, :576, :638 `ApplicationCardSkeleton`); cards src/pages/jobs/AppliedJobCard.tsx; per-card tracker src/components/JobTracking.tsx:527-570 (`tracking` state seeded from `initialTracking`, updated after mount); photo ask appliedJobCard/steps/HelperPhotoAsk.tsx; header ActivityHeader.tsx
- Likely cause: several separate loads finish one after another and each changes height — route skeleton → page skeleton → card list (skeleton heights don't match real tracker cards) → each card's tracker/status line fills in → photo-ask and payout blocks appear → tab counts in the header update and may reorder/regroup the Needs You list; every step reflows the page (unverified — needs a recorded layout-shift trace to count the real steps)
- Shared with: Posts (/posts) uses the same Activity page and JobTracking; same class of problem as VN-3 (Earnings)
- Size: medium–large
- Screenshot: pasted in chat (settled state only, not saved)

### VN-33: Helpr 2000+ miles away can still tap "I've Arrived" and move forward
- Screen / route: Jobs — /jobs, hired job in On the Way → Arrived (card above "Touch up hallway and stairwell"; toast bottom-right, "Try My Location Again" button)
- Viewport / theme: 1440, light
- What the owner sees: "it showed in the map I'm over 2000 miles away, which I am, so it shouldn't let me move forward until my location is actually showing near the site AND the poster says I've arrived"
- Where it lives: arrival tap + toast src/components/JobTracking.tsx:1005-1013 ("Marked arrived, but you're about Nft from the job site…" / "…couldn't get your location…"); rule src/lib/arrivalGate.ts:1-64 (`arrivalState`: claimed / verified (server 500ft, `mark_helper_arrival` RPC) / confirmed (poster tap); `arrivalEstablished` = verified OR confirmed); lifecycle src/components/job-card/activityActions/useLifecycleHandlers.ts
- Likely cause: by design the tap always writes `helper_arrived_at` ("claimed") even when far away or with no GPS fix — the tracker then moves to Arrived and only wrap-up/payout is gated, and it's gated on GPS **OR** poster vouch. Owner's new rule: (1) don't advance to Arrived at all unless the helper is actually near the site, and (2) require GPS **AND** the poster's "Confirm They Arrived". Changes `arrivalEstablished` from OR to AND and blocks the claimed write — money/trust gate, needs review (note the documented recourse path for helpers with no GPS fix goes away) (unverified live)
- Shared with: payout CTA (completeJob), tracker Done step, Arrived caption (VN-20), poster's Confirm They Arrived button; server RPC mark_helper_arrival
- Size: medium–large (gate logic + RPC; not visual)
- Screenshot: pasted in chat (not saved)

### VN-34: Rename "Request My Payout" on the Done step, and don't allow it until photos are uploaded
- Screen / route: Jobs — /jobs, Helpr card in Working step (e.g. "Touch up hallway and stairwell"): big bar under the tracker
- Viewport / theme: 1440, light
- What the owner sees: "change request my payout for a done job to something else, like job completed or something idk. also don't let them click it's completed until photos are uploaded"
- Where it lives: label src/components/JobTracking.tsx:73 (steps array `{ key: "done", action: "Request My Payout" }`) — rendered at ~:2080-2130 with `disabledReason`; photo gate `needsProof` :2089-2092 (hasRequiredProof on proof_before/after_urls, `require_photo_proof` default true), wired from src/pages/jobs/appliedJobCard/HelperTrackerPanel.tsx:142-152. A second payout button exists: src/pages/jobs/appliedJobCard/steps/PayoutPrimary.tsx:32 ("I'm Done — Request Payout", renders nothing until photos)
- Likely cause: (1) wording names the money, not the event — owner wants e.g. "Job Completed" / "Mark Job Done" (pick with owner). (2) Photo gate: in the screenshot the bar is already greyed with "Before & after photos are required" above it, so it is probably already disabled until photos exist — verify it can't be clicked; if a poster turned photos off (`require_photo_proof=false`) the gate lifts, which owner may not want. Also two differently-worded payout CTAs for the same action (tracker vs PayoutPrimary) should become one (unverified)
- Shared with: JobTracking steps array (label used for both tracker CTA and step), PayoutPrimary (OnSiteStep / WorkingStep); ties VN-21 (one row) and VN-33 (arrival gate also blocks this button)
- Size: small (copy) + verify gate
- Screenshot: /jobs screenshot from VN-33 (not saved)

### VN-35: Messages list header — move the chevron to the right of the hamburger; search opens too wide
- Screen / route: Messages list — /messages (header row: search icon · filter chevron · ☰ options)
- Viewport / theme: not specified (1440 context)
- What the owner sees: "on messages, move the chevron to the right of the hamburger. search shouldn't open that large for messages either"
- Where it lives: src/components/messages/ConversationList.tsx — search icon button ~:685-689, filter chevron (`tabsOpen`, "Filter conversations") ~:708-722, ☰ `Menu` dropdown "Conversation list options" ~:735-745; open search field :589-595 (`relative flex-1` wrapper)
- Likely cause: button order in JSX is search → chevron → menu; owner wants search → menu → chevron. Open search is `flex-1` so it stretches across the full header (same pattern as VN-5 browse search and VN-31 Posts/Jobs search) (unverified)
- Shared with: ConversationList only; cap-width fix should match VN-5 / VN-31 so all three searches behave the same
- Size: small
- Screenshot: none

### VN-36: "No reviews yet" star illustration looks crammed / disorganised
- Screen / route: Profile → My Reviews — /profile?tab=reviews (empty state)
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "organize the stars better"
- Where it lives: src/components/profile/ReviewsTab.tsx:168-175 (`<EmptyState illustration={<EmptyStateIllustration variant="reviews" />}>`); sizing src/components/empty-state/EmptyStateIllustration.tsx:33-36 (`reviews` → `w-28 h-auto`, so five stars share 112px); SVG src/components/empty-state/illustrations/EmptyReviews.tsx
- Likely cause: five outline stars drawn edge-to-edge (overlapping outlines, no gap) in a 112px strip, so they read as one tangled shape rather than a clean row of five (unverified — check the SVG's star spacing/viewBox)
- Shared with: EmptyStateIllustration `reviews` variant — also any other empty reviews state that uses it (public profile ReviewsSection "No reviews yet" if it shares)
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-37: Content doesn't fill the page — small gap left and right on My Reviews and other Profile tab pages
- Screen / route: Profile tab pages — /profile?tab=reviews (and "other pages" — likely every /profile?tab=… page)
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "reviews and other pages still have that small gap to the left and right of content. content should fill that space"
- Where it lives: src/pages/profile/Profile.tsx:683 (`page-measure w-[calc(100%+1.5rem)] … px-3 -mx-3` scroll wrapper) around src/pages/profile/ProfileTabPanels.tsx:360 (reviews panel); page-measure src/index.css:1815; header width ladder src/components/PageHeader.tsx:64-108
- Likely cause: the scroll wrapper is widened by 1.5rem then padded back with `px-3 -mx-3` (to keep card shadows from clipping), so the white card stops ~12px short of the faint page panel on each side — visible in the screenshot as a lighter band either side of the card (panel ~x36→1636, card ~x48→1623) (unverified; measure `.app-shell-frame` vs card edges per CLAUDE.md)
- Shared with: every Profile tab page using that wrapper; same "fill the space" rule as the rail/fit rules — check Activity/Messages too
- Size: small–medium
- Screenshot: My Reviews screenshot from VN-36 (not saved)
- **TRIED AND REVERTED, 2026-09-14 — do not attempt the same fix again.** Read
  before touching this. The scroll wrapper was bled an extra 12px per side at
  `xl` so the cards would move from x=48 to x=36. It was wrong. Measured on
  prod at 1440 (`.app-shell-frame` 0→1192) BEFORE any change:
  `/home` panel 48→1144 · `/posts` 48→1144 · `/messages` 48→1144 ·
  `/profile?tab=reviews` card 48→1144 — pixel-identical. The Profile tab pages
  are NOT inset relative to anything; they already sit flush with every
  PageScaffold sibling, and bleeding here moved Profile alone and split the
  shared fixed-shell family (`src/components/AppPage.tsx` carries the same
  wrapper string byte-for-byte). The "panel ~x36" in the note above is the
  wrapper's own border box, which paints nothing — there was never an edge
  there to fill to; the numbers matched while the conclusion did not.
- **What VN-37 actually is:** the container gutter `px-5 lg:px-8 xl:px-12`
  (48px at xl), shared by Profile.tsx, PageScaffold.tsx and AppPage.tsx.
  Narrowing it is one line in that string in all three — an app-wide look
  decision for the owner, not a per-screen fix. Queued in docs/OPEN.md.
  Guarded by `src/components/profile/profileTabScroll.test.ts` (Profile and
  AppPage must carry the identical wrapper) and by the parity assertion in
  `e2e/prod-audit/profile-tab-scroll-fill.spec.ts`.

### VN-38: Remove "Parish · Vermilion" from Edit Profile
- Screen / route: Profile → Edit Profile (ZIP field)
- Viewport / theme: not specified
- What the owner sees: "remove parish vermilion from edit profile"
- Where it lives: src/components/profile/ProfileEditForm.tsx:236-240 (`{resolvedParish && … "Parish · {resolvedParish}"}` line under the ZIP field); data :102-113 (`useParishForZip`)
- Likely cause: an inline confirmation showing which parish the ZIP resolves to; owner doesn't want it shown. Remove the display only — the parish is still saved from the ZIP and used by browse/matching (unverified)
- Shared with: ProfileEditForm only; useParishForZip also used by other forms (post a job) — leave those
- Size: small
- Screenshot: none

### VN-39: Do skills & services and recent work show anywhere on the public profile? (OWNER QUESTION — code read only)
- Screen / route: Public profile — /user/:id
- What the owner asks: "do their skills and services and recent work ever show anywhere on their profile???"
- Answer from code (unverified live): YES, but only when filled in, and easy to miss.
  - Skills & services: one comma-joined text line inside the header card, under the badge row — src/pages/user/ProfileHeaderCard.tsx:161-164, :345-360 (hidden when `profile.skills` is empty)
  - Recent Work: photo section near the bottom, after Availability — src/pages/user/UserProfile.tsx:776-778 → src/components/profile/HelperWorkPhotos.tsx:26 (returns nothing when `portfolio_urls` is empty)
  - A second "Portfolio" section (job photos) only for Pro+ subscribers — UserProfile.tsx:780-781 (`HelperPortfolio`)
  - Data: `get_safe_profiles` RPC does return `skills` and `portfolio_urls` (migration 20260907062224:52)
- Hallie H.'s profile (VN-15 screenshot) shows neither — either her skills/photos are empty, or they're rendering below the fold; check her row
- Owner likely wants these more prominent (e.g. skills as chips, Recent Work higher up) — confirm
- **Owner answer (2026-09-15 pop-up): fine as is.** No change; question closed.
- Size: n/a (question) / medium if redesigned
- Screenshot: none

### VN-40: Edit Profile save bar — "Cancel" / "Up to Date" buttons
- Screen / route: Profile → Edit Profile, bottom save bar
- Viewport / theme: not specified
- What the owner sees: "i don't like that bottom cancel or up to date in edit profile"
- Where it lives: src/components/profile/profileEditForm/SaveBar.tsx:69 (primary label cycles "Saving…" / "Saved" / "Up to Date" (idle, disabled) / "Save Changes") and its Cancel button in the same bar; used by src/components/profile/ProfileEditForm.tsx
- Likely cause: the bar stays on screen when nothing has changed, showing a dead "Up to Date" button plus a Cancel that has nothing to cancel. Direction to confirm: hide the bar until there are unsaved changes, then show Save (and Discard) (unverified)
- Shared with: SaveBar — check other settings forms that import it
- Size: small
- Screenshot: none

### VN-41: Schedule page — small calendar floating in a huge card, and Upcoming jobs cards full of dead space (NEEDS DESIGN DISCUSSION)
- Screen / route: Profile → Schedule — /profile?tab=schedule
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "the calendar needs to be positioned better or something, same for the stuff under upcoming jobs, it's a lot of dead space"
- Where it lives: src/components/profile/ScheduleTab.tsx — calendar card ~:451-520 (month header, `grid grid-cols-7`, legend :600-615, capped narrow column ~280px centered in a ~1575px card); Upcoming jobs list ~:660-740, each card uses JobCardMetaRow plus a separate bottom row just for "Add to calendar" (:262-298, `ml-auto`)
- Likely cause: calendar is a fixed narrow column centered inside a full-width card, leaving ~650px blank each side; legend wraps under it. Job cards are full width with title/meta on the left, price far right, and a whole extra row only for "Add to calendar" at far right → big empty middle. Directions to discuss at 1440: calendar and Upcoming jobs side by side (calendar left, list right); or bigger calendar cells; move Add to calendar into the meta row (unverified)
- Shared with: ScheduleTab only; JobCardMetaRow (VN-27 grey location chip); same "fill the space" theme as VN-37
- Size: large (layout redesign; discuss first)
- Screenshot: pasted in chat (not saved)

### VN-42: Saved Helprs should be one column, not a grid
- Screen / route: Profile → Saved Helprs — /profile?tab=saved_helpers
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "should be 1 column" (2 cards sit side by side in the left half, right half empty)
- Where it lives: src/components/profile/SavedHelpersTab.tsx:387 (`grid gap-3 md:grid-cols-2 xl:grid-cols-3 items-start`); card src/components/profile/savedHelpersTab/SavedHelperCard.tsx
- Likely cause: responsive grid goes to 2 columns at md and 3 at xl, so with 2 saved Helprs they fill two-thirds of the width and leave a dead third; owner wants a single full-width list like the other Profile tabs (unverified)
- Shared with: SavedHelpersTab only; full-width cards will stretch "Offer a Job" — check that button's width once it's one column
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-43: Remove the card design picker from gift cards
- Screen / route: Gift cards — /gift-card (send a gift card form)
- Viewport / theme: not specified
- What the owner sees: "remove card design option on gift cards"
- Where it lives: src/pages/profile/GiftCard.tsx:539-~580 (Card design radio group, `gift-design-label`, `setDesignId`); state :105-111 (`designId`, `design` from `occasion.designs`); designs src/pages/profile/giftCards/giftCardDesigns.ts; occasion picker :450-484 resets design; preview :533 (`design={design}`)
- Likely cause: each occasion offers several designs and the form shows a picker. Remove the picker only — keep sending a design: default to the occasion's first design (`occasion.designs[0]`), because `design_id` is still sent to checkout (:303) and used by supabase/functions/create-gift-card-checkout and stripe-webhook checkoutSessionCompleted (email/card render) (unverified)
- Shared with: gift card checkout + webhook read design_id — don't drop the field; occasion picker stays unless owner says otherwise
- Size: small
- Screenshot: none

### VN-44: Plus tier (and Once / Annual) don't look enticing (OWNER QUESTION + PRICING DECISION)
- Screen / route: Profile → Membership — /profile?tab=subscription (Once · Monthly · Annual toggle, Free/Basic/Pro/Plus/Elite cards)
- Viewport / theme: 1440, light
- What the owner asks: "are there any other features for plus? doesn't look very enticing? same for once and annual"
- Answer from code (unverified vs live Stripe):
  - Plus ($15/mo, $150/yr) adds only TWO things over Pro: 9% fee (vs 10%) and 15-min early access (vs 10). src/lib/subscriptionTiers.ts:64-70 says this on purpose: Plus "ships thin-but-honest"; giving it any of Elite's perks (Featured Crown Badge, Priority Support, unlimited boosts, Reliability Shield) is left as an OWNER pricing call. featureBullets :246-251
  - Once: same perks as monthly, but a 30-day pass that doesn't renew (ONE_TIME_PASS_DAYS :126-138, stripe-webhook stamps expiry). Plus's Once price is $15 — same as a month of Monthly (:58-60), so there's no reason to pick one over the other beyond auto-renew
  - Annual: same perks, ~2 months free ($150/yr = $12.50/mo) + "rate guaranteed for the year" box (SubscriptionTab.tsx:327-351). An earlier owner ruling removed the "Save 17%" badge (:330-333), so the saving isn't called out anymore
- Decisions needed from owner: (1) which perks move to Plus (or cut Plus); (2) give Once / Annual a reason to exist (Once priced as a premium, Annual shows its saving again); cards list perks, not what each billing cycle gets
- Where it lives: src/lib/subscriptionTiers.ts (tier config, perk matrix :146+, Plus :234-251); src/components/profile/SubscriptionTab.tsx (toggle :255-264, getPrice :213-217, Annual/Once info boxes :317-360)
- Shared with: Stripe Price ids (live), proTiers.parity.test.ts, stripe-webhook — perk changes must update the perk matrix that gates features, not just the bullets
- Size: medium (pricing/copy; money — decide first)
- Screenshot: pasted in chat (not saved)

### VN-45: Referrals says $15 earned / $15 to cash out, but 0 referrals and the rank tracker shows nothing
- Screen / route: Profile → Referrals — /profile?tab=referral
- Viewport / theme: 1440, light
- What the owner sees: "it says 15 to cash out but the tracker doesn't show any referrals given?"
- Where it lives: tiles src/components/ReferralSection.tsx:140-141 (Total earned / To cash out = sum of ALL `referral_credits` rows) and :257 (Referrals = `referralCount`); rank ladder src/components/profile/ReferralExtras.tsx:47 (progress from `referralCount` only) but "$15 earned" header from `totalCredits` (:309); data src/hooks/useReferralData.ts:31-33 (`referral_credits` by user_id vs `referrals` count where `referrer_id = user`)
- Likely cause: two different sources for one fact. Money comes from every credit row for the user — including the $5 you get as the person REFERRED, or credits written by tests/seeds/admin — while "Referrals" and the ladder count only people YOU referred. So $15 of credits with 0 referrals shows "Rank 1: 1 more to reach Friend 1 · 0%" next to "$15 earned". Also 3×$5 with no referrer row suggests test data on this account — check `referral_credits` rows for this user on prod (unverified live)
- Shared with: ReferralSection + ReferralExtras; cash-out edge function reads the same credits table (money — verify before changing)
- Size: small–medium (data consistency; money)
- Screenshot: pasted in chat (not saved)

### VN-46: Notifications settings page doesn't scroll
- Screen / route: Profile → Notifications — /profile?tab=notifications
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "this page doesn't scroll" — list cuts off at the bottom (a "Send a Test…" row and a button are half visible under Promotions)
- Where it lives: panel src/pages/profile/ProfileTabPanels.tsx:342-350 (`<NotificationPreferences />`); scroll container src/pages/profile/Profile.tsx:683 (`page-measure … h-full overflow-y-auto`); page shell vs DOCUMENT_SCROLL_ROUTES in src/hooks/useAppShellViewport.ts (Profile tab pages are document-scroll per CLAUDE.md)
- Likely cause: Profile is locked to the fixed viewport (AppShell 100dvh) and the tab content relies on Profile.tsx:683's inner `overflow-y-auto h-full`; if `h-full` has no bounded parent height on this tab (or the app-shell class stays on <html> for ?tab=… routes), the content overflows under the frame with no scrollbar — so the page can't scroll to the last rows. Other short tabs (Reviews) don't show it because they fit (unverified — check with the wheel + scrollHeight on the container)
- Stronger lead: src/components/NotificationPreferences.tsx:541 still has a leftover inner scroller (`flex-1 min-h-0 overflow-y-auto overscroll-contain`, comment :536-540 "rows scroll between pinned header/footer") inside a card that was changed to scroll with the page (:416-425, `overflow-hidden`). A half-removed inner-scroll design — the inner region + `overscroll-contain` can swallow the wheel so the page never scrolls
- Shared with: every long Profile tab (Membership, Referrals scrolled in screenshots, so compare what differs); NotificationPreferences component
- Size: small–medium
- Screenshot: pasted in chat (not saved)

### VN-47: Legal tab — remove "Download your data", and "contact support" is listed twice
- Screen / route: Profile → Legal — /profile?tab=legal (bottom of page)
- Viewport / theme: 1440, light
- What the owner sees: "remove download your data, and contact support listed twice"
- Where it lives: src/components/profile/LegalTab.tsx:38-~180 — "Download your data" card (:146, JSON export) and the GDPR/CCPA line with a second "contact support" link (:181); first "Questions? Contact support" row comes from src/pages/info/legal/LegalChrome.tsx:104
- Likely cause: the data-export card was merged into Legal from the old /data-rights page (comment :41-50), bringing its own "contact support" sentence under a legal page that already ends with "Questions? Contact support". WARNING before removing the export: the comment says the Privacy Policy promises this export in writing, /data-rights redirects here, and the App Store privacy listing points at it — removing it breaks those promises (GDPR Art. 20 / CCPA). Owner should decide where it moves (e.g. Account settings) rather than delete it; the duplicate support link can simply go (unverified)
- Owner follow-up: "same for rules and privacy" — the Rules and Privacy pages have the same duplicate "contact support" (and whatever else repeats at the bottom); fix all three together
- Shared with: LegalChrome (public legal pages), /data-rights redirect in App.tsx, Privacy Policy copy
- Size: small (but compliance check first)
- Screenshot: pasted in chat (not saved)

### VN-48: Post a Job form labels aren't in Title Case
- Screen / route: Post a Job — /post-job (Job Details → Details step; check later steps too)
- Viewport / theme: 1440, light
- What the owner sees: "check for title case"
- Where it lives (seen in screenshot): "Job title" src/components/postjob/detailsSection/TitleField.tsx:44; "Require before & after photos" src/components/postjob/detailsSection/PhotoProofToggle.tsx:41; "Photos (optional, up to 5)" src/components/postjob/detailsSection/PhotoUpload.tsx; also "Description", "Category" (fine), placeholder/helper lines are sentences (fine)
- Likely cause: field labels and toggle titles written in sentence case while headings/buttons elsewhere use Title Case → should read "Job Title", "Require Before & After Photos", "Photos (Optional, Up to 5)". Sweep every step of the post-job flow (Details, Schedule, Budget, Review) for the same (unverified)
- Shared with: postjob/detailsSection/* and other postjob steps; if a title-case lint/check already exists for buttons, extend it to form labels (per "every report becomes a check")
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-49: "Require before & after photos" box is too spread out / badly positioned
- Screen / route: Post a Job — /post-job, Details step (box between Description and Photos)
- Viewport / theme: 1440 (1920 screenshot), light
- What the owner sees: "position require before and after better, it's too spaced out"
- Where it lives: src/components/postjob/detailsSection/PhotoProofToggle.tsx:29-55 (full-width `rounded-ds-md border p-4 space-y-2` box; header row `flex justify-between` with label far left and Switch far right :34-49; description paragraph under it :50-54)
- Likely cause: the box spans the whole ~1530px form, so the title sits at the far left, the switch at the far right, and the one-line explanation trails across the middle — lots of air, and it looks detached from the Photos section it controls. Directions: switch beside the label (not justify-between), tighter padding, or move it into / right above the Photos block it relates to (unverified)
- Shared with: PhotoProofToggle only (Details step); title-case of its label is VN-48
- Size: small
- Screenshot: pasted in chat (not saved)

### VN-50: How does a flexible-schedule job work on the tracker? (OWNER QUESTION — code read only)
- Screen / route: Job tracker on Jobs/Posts cards for a job posted with "Flexible" schedule
- What the owner asks: "how is flexible schedule done on the tracker??"
- Answer from code (unverified live): it ISN'T handled specially. The tracker never reads `is_flexible_schedule` — src/components/JobTracking.tsx has no reference to it. It only uses `date_needed` + `start_time`:
  - Flexible jobs save `start_time = null` (src/pages/post-job/jobSubmitHelpers.ts:163-165) but still carry a date
  - "I'm On My Way" lock (JobTracking.tsx:1995-1999): with no start time it unlocks at midnight of `date_needed` in the job's timezone — so the Helpr can't start early even though the poster said "flexible", and nothing says when on that day
  - Day-of confirmation step (deriveCurrentStatusIdx ~:220-235) measures its 24h grace from the date alone
  - No step for the poster and Helpr to agree on an actual time; cards just show "Flexible time" (JobCardMetaRow flexibleLabel)
  - Correction after reading the toggle: postjob/LogisticsSection.tsx:424-428 defines Flexible as "Helpr can start earlier or later on the scheduled day" — so the midnight-of-the-day unlock matches that promise; what's missing is only an agreed time and any flexible-aware wording on the tracker (reminders/day-of confirm still assume a set time)
- Decision needed: what "flexible" should mean on the tracker — e.g. Helpr proposes a time when accepting / poster confirms it, then the lock and reminders use that agreed time; or flexible = any day up to the date
- Where it lives: JobTracking.tsx (lock + steps), postjob/LogisticsSection.tsx (flexible toggle), jobSubmitHelpers.ts
- Size: medium (logic + small UI)
- Screenshot: none

### VN-51: Repeating job should say "Start Date", not "Date needed"
- Screen / route: Post a Job — /post-job, Logistics step, Job type = Recurring
- Viewport / theme: not specified
- What the owner sees: "if it's a repeating job, it should say start date instead of date needed"
- Where it lives: src/components/postjob/LogisticsSection.tsx:384 (`<Label htmlFor="date">Date needed *`) — same field feeds the recurrence schedule as `startDate={dateNeeded}` (:354)
- Likely cause: label is fixed; switch to "Start Date" when `isRecurring` (and Title Case per VN-48: "Date Needed" otherwise). Check the Review/Checkout step and job cards for the same wording on recurring jobs (unverified)
- Shared with: CheckoutStep.tsx summary line (:327), job cards' date for recurring series
- Size: small
- Screenshot: none

### VN-52: Where is the Group job option? (OWNER QUESTION — code read only)
- Screen / route: Post a Job — /post-job, Logistics step, "Job type" control (One-Time / Recurring)
- What the owner asks: "also where is the group option?"
- Answer from code: it's switched OFF. `GROUP_JOBS_ENABLED = false` in src/lib/groupJobs.ts:79, so LogisticsSection.tsx:328-377 only offers One-Time and Recurring; old drafts with Group are coerced to One-Time (comment :329-333, jobSubmitHelpers). A test pins it off: src/pages/post-job/groupJobsGate.test.ts:36. Withdrawn 2026-09-01 on purpose (groupJobs.ts comment above :79): prod never had a real group job, and the live control would have hit five known breakages (per-member lifecycle on group_job_helpers, payment split, review model…). Re-enabling needs those fixed; the test fails if the flag flips without the schema change
- Decision needed: turn Group back on (needs the split-payment/commitment work finished and the gate test changed) or leave it hidden
- Size: n/a (question) / large if re-enabled (money split)
- Screenshot: none

### VN-53: Pet care job — "Which pet is this for?" doesn't show the pets I've saved
- Screen / route: Post a Job — /post-job, Logistics step, category Pet Care (pet picker); pets saved at /profile?tab=pets
- Viewport / theme: not specified
- What the owner sees: "for pet care jobs, the option to choose the dogs from the pet page does not show the dogs I have saved"
- Where it lives: src/components/postjob/PetPicker.tsx:49-61 (query `["pet_profiles_for_post", user.id]`, `staleTime` 5 min, `.from("pet_profiles").select(...).order("name")` — no owner filter); pets page src/pages/profile/PetProfiles.tsx:59-66 (`["pet_profiles", userId]`, `.eq("owner_id", userId)`) and its invalidations :100, :116; mounted from src/components/postjob/LogisticsSection.tsx:436-437
- Likely causes (unverified live):
  1. Cache: the picker uses a DIFFERENT query key than the pets page, and adding/deleting a pet only invalidates `["pet_profiles", …]`. If the picker loaded (empty) in the last 5 minutes — e.g. owner opened Post a Job, tapped "Add a pet", saved dogs, came back — it keeps showing the stale empty list
  2. RLS: the picker has no `owner_id` filter and relies on the `pet_profiles` SELECT policy; if that policy only allows owner via a different id (profile id vs auth uid) or is scoped for the job's Helpr (JobPetCareSheet), the picker's unfiltered read can return nothing — check `pg_policies` for pet_profiles
- Fix direction: share one query key/hook with the pets page (and filter by owner_id), invalidate on save
- Shared with: JobPetCareSheet (Helpr view of the job's pets) reads the same table
- Size: small
- Screenshot: none

### VN-54: Business name should show only after admin approves
- Screen / route: Public profile /user/:id header (business name line), CredentialBadge wherever it renders
- Viewport / theme: n/a
- What the owner sees: "if they do have a business it should show their business name only after admin approves"
- Where it lives: server gate supabase/migrations/20260907062224_public_profile_identity_verdict_matches_the_hire_gate.sql:90-96 (`get_safe_profiles` emits business_name only when license OR insurance is `verified`); client src/pages/user/ProfileHeaderCard.tsx:158-244; src/components/CredentialBadge.tsx:65 (same rule); admin approval src/components/admin/AdminCredentialQueue.tsx:270-276
- Likely cause: code already appears to do this (name tied to an admin-verified license/insurance, not a separate business approval). Needs a LIVE check (`pg_get_functiondef('get_safe_profiles')`) plus a profile with a pending credential and a business name. Open question: owner may mean a separate "business approved" step rather than license/insurance approval (unverified live)
- Shared with: get_safe_profiles consumers (Messages, applicants, profile)
- Size: small (verify) / medium (if a separate business approval is wanted)
- Screenshot: none

### VN-55: Offered/hired Helpr must see the full address as text, not only on the map
- Screen / route: Jobs — /jobs, Helpr card once offered or hired (Scheduled / Needs You)
- Viewport / theme: not specified
- What the owner sees: "they need to be able to actually see the full address when the offer is sent to the helpr. not just in the map"
- Where it lives: card meta row prints city only (src/components/job-card/JobCardMetaRow.tsx getCity); the full `location` already reaches the offered/hired Helpr via get_jobs_for_my_applications → user_may_see_job_address (verified live 2026-09-14)
- Fix: src/pages/jobs/appliedJobCard/JobAddressLine.tsx rendered in AppliedJobCard for offered/confirmed/active/disputed; prints nothing for a masked city-only location
- Size: small

