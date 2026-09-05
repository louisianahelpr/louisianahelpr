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

## Current state (2026-09-05)

All 12 products exist with name, description, price, availability, a `COMPLETE`
1242×2208 review screenshot, and a localized subscription group.

- **4 non-renewing month passes — `READY_TO_SUBMIT`.**
- **8 auto-renewable subscriptions — `MISSING_METADATA`.**

## What is known about the remaining 8

Apple does not expose which field is absent. Ruled out by direct measurement,
so nobody repeats them:

1. **Descriptions** — within the 55-char cap; localization exists, `en-US`.
2. **Prices** — one per subscription, USA, `planType: UPFRONT`.
3. **Availability** — exists, USA, and `availableInNewTerritories` was flipped
   to `false` so no unpriced storefront is claimed. No change.
4. **Review screenshot** — `COMPLETE`, 1242×2208 (a real render of the
   Membership screen). No change.
5. **Group localization** — `en-US`, "Helpr Membership". Adding it did not move
   the subscriptions, though it was genuinely missing.
6. **Stale state** — disproven. A no-op `PATCH` to every subscription left the
   state unchanged, so they are incomplete rather than merely un-recomputed.

The same pieces on a non-renewing IAP produce `READY_TO_SUBMIT`, so the
requirement is specific to auto-renewable subscriptions.

**Next step is 30 seconds in the UI, not another guess:** open any subscription
in App Store Connect. The missing field is shown in red. Once it is known,
`create.mjs` can set it for all eight in one run.
