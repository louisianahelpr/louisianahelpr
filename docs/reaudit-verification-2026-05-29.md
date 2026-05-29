# Re-audit verification — 2026-05-29

Follow-up to `sim-audit-findings-2026-05-29.md`. After the fixes from
PR #368 (S1–S4 UI) and the triage of S5/S7 landed on `main`, this pass
re-checks every finding on the **actual rendered app**, not just the
source.

Because Louisiana Helpr is a Capacitor app, the iOS shell ships the
**identical** React/`dist` bundle as the web build — so a finding verified
in the browser render of a component is verified for the iOS app too. Only
native-bridge behavior (safe area, keyboard, push, OAuth) needs a device,
and none of that changed in this cycle.

## How it was verified

- **Web sweep** — Playwright + Chromium against the dev server at three
  widths (mobile 390, tablet 768, desktop 1440), authed + guest surfaces:
  dashboard, my-posts, my-jobs, messages, profile, post-job, landing,
  login, signup, browse. All 30 screenshots captured clean.
- **Populated cards** — seeded two `open` jobs into the mocked
  `jobs` query so `PostedJobCard` renders its full action row (the empty
  mock dataset otherwise only shows the "Nothing posted yet" state).
- **Notification panel** — clicked the header bell on `/dashboard` and
  confirmed the sheet opens.
- **iOS simulator** — cold-launched the freshly-built app on the
  iPhone 17 Pro sim (iOS 26.1) and confirmed the guest dashboard renders
  (verifies the #366 cold-launch fix).

## Findings — status this pass

| ID | Prior status | Verified now |
| --- | --- | --- |
| **S1** Action row clipped "Cancel" → "Cance" | Fixed (PR #368) | ✅ Confirmed — action row is now a 2×2 grid (Boost / Edit, Share / Cancel); "Cancel" renders in full at 390 px. |
| **S2** "Finish your profile 0%" stat bug | Fixed (PR #368) | ✅ Confirmed — profile shows a real completion ("70%" on the seeded profile), not 0%. |
| **S3** City / member-since over-truncated | Fixed (PR #368) | ✅ Confirmed — "New Orleans, LA" and "New member" render fully; name card wraps cleanly. |
| **S4** Card title single-line truncation | Fixed (PR #368) | ✅ Confirmed — a long title clamps to two lines with ellipsis, currency chip stays aligned. |
| **S5** Notification bell "does nothing" | Not a bug (missed tap) | ✅ Confirmed — header bell opens the `NotificationPanel` sheet. |
| **S6** Post-job templates (positive) | — | ✅ Still present — template grid + AI builder render on `/post-job`. |
| **S7** Bottom-nav highlight on non-tab routes | Not a bug | ✅ Confirmed — highlight correctly tracks the active section / stack. |
| **#366** Cold-launch guest dashboard | Fixed | ✅ Confirmed on the iOS simulator. |

## New findings

**None.** No new visual or layout regressions across any surface or width.

One non-issue worth recording so it isn't re-flagged: the landing page's
"Three steps. Zero surprises." cards appear blank in a Playwright
*full-page* screenshot. That is a capture artifact — the cards use the
`.observe-fade-up` scroll-reveal (`opacity: 0` until an IntersectionObserver
adds `.is-visible`), which never fires when the page is captured without
real scrolling. Real users scrolling the page see the cards, and there is a
`prefers-reduced-motion` fallback that shows them immediately.

## Conclusion

Everything from the original sim audit is merged and verified on the
rendered app. No further fixes warranted.
