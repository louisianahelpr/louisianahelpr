# App Store Connect IAP tooling

Runs from `.github/workflows/asc-iap.yml` (`gh workflow run asc-iap.yml -f mode=…`),
never locally: the `.p8` signing key exists only as a repository secret, and
GitHub secrets cannot be read back.

| mode | writes? | what it does |
|---|---|---|
| `probe` | no | Full state of every product: localization, price, availability, review screenshot, group localization |
| `create` | yes | Creates/completes the 12 products. Idempotent — skips what exists |
| `screenshots` | yes | Uploads the review screenshot; replaces any in state `FAILED` |
| `inspect` | no | Dumps one subscription and one IAP in full, for diffing |
| `fix-availability` | yes | Sets `availableInNewTerritories: false` on subscriptions |

The review screenshot is `assets/review-screenshot.png`, regenerated with:

```
PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=happy-path -g "App Store review"
cp e2e-artifacts/iap-review-screenshot.png scripts/asc/assets/review-screenshot.png
```

## Current state (2026-09-06) — RESOLVED

All 12 products are COMPLETE. Nothing is missing.

- **4 non-renewing month passes** — `READY_TO_SUBMIT`.
- **8 auto-renewable subscriptions** — API reports `MISSING_METADATA`; the App
  Store Connect UI reports **"Prepare for Submission"** with no field flagged.

## `MISSING_METADATA` here does NOT mean a missing field

That is the whole trap, and it cost seven hypotheses. The API state is
misleading for a FIRST subscription group. App Store Connect states it plainly
on the group page:

> Your first subscription group must be submitted with a new app version.

So the eight subscriptions cannot advance past this state on their own, no
matter how complete they are — they are waiting on an **app version
submission**, not on data. The four non-renewing passes reached
`READY_TO_SUBMIT` precisely because that constraint does not apply to them: a
non-renewing IAP submits independently of an app version.

Verified in the UI on 2026-09-06: every one of the eight shows an amber
"Prepare for Submission" dot, no red, no warning, and the group's own
localization is present.

### What actually remains

Nothing in this tooling. Include the subscription group in the next app version
submission (the group page has an **Add for Review** button, and the version
submission carries it). Sandbox testing of IAP becomes possible once that lands.

### Ruled out along the way

Kept because each was a real gap that got fixed, and because the list is what
proves the state is not a data problem:

1. **Descriptions** — capped at 55 chars, enforced only at POST. Fixed.
2. **Price points** — must be matched NUMERICALLY (`"20.0"` != `"20.00"`). Fixed.
3. **Availability before pricing** — subscriptions 409 on price with no
   availability, and the error blames the price point. Fixed.
4. **Image dimensions** — `IMAGE_INCORRECT_DIMENSIONS`; every upload PATCH
   returned 200 while all twelve assets sat in `FAILED`. Now 1242x2208. Fixed.
5. **Group localization** — genuinely missing, now `en-US`. Fixed.
6. **Stale state** — disproven: a no-op PATCH to all eight changed nothing.
7. **Unpriced territories** — disproven: restricting to USA-only changed nothing.
8. **Wrong locale** — disproven: app `primaryLocale` is `en-US` and every
   localization matches.

