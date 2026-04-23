# Custom Product Pages (CPPs) — App Store Connect

Helpr is a two-sided marketplace, so a single App Store listing has to talk
to two very different audiences: **posters** (homeowners hiring help) and
**helprs** (workers picking up jobs). Custom Product Pages let us run two
distinct App Store listings — same app binary, different screenshots,
different copy, different deep links — and direct each marketing campaign
to the right one.

Apple now allows up to **70 CPPs per app** (April 2026 limit), so we can
also spin up parish-specific or seasonal pages later.

---

## What's in this repo

| Path | Purpose |
|------|---------|
| `fastlane/metadata/custom_product_pages/poster/` | Poster CPP copy + screenshots |
| `fastlane/metadata/custom_product_pages/helper/` | Helper CPP copy + screenshots |
| `src/lib/cppRouting.ts` | Reads `?ppid=…` / `?cpp=…` from the launch URL and deep-links to the right screen |

The router is wired into `App.tsx` once and runs on first paint.

---

## One-time setup in App Store Connect

1. Sign in → **My Apps → Helpr → Custom Product Pages → +**
2. Create the first page:
   - **Reference name:** `Poster Funnel`
   - **Locale:** English (U.S.)
3. Upload assets from `fastlane/metadata/custom_product_pages/poster/`:
   - **Promotional text** — `promotional_text.txt`
   - **Description** — `description.txt`
   - **Screenshots** — `screenshots/iphone_6_7`, `iphone_6_1`, `ipad_pro_12_9`
4. **Submit for review.** Each CPP needs its own quick Apple review (~24 h).
5. Once approved, copy the page's **Product Page ID (ppid)** from the URL.
   It looks like `e7c6f4b2-1234-…`.
6. Repeat steps 2–5 for `Helper Funnel` using the helper folder.

---

## Wire the IDs into the app

Open `src/lib/cppRouting.ts` and fill in the IDs Apple gave you:

```ts
const PPID_TO_VARIANT: Record<string, CppVariant> = {
  "e7c6f4b2-1234-…": "poster",
  "9a3b1d05-5678-…": "helper",
};
```

Commit and ship. Now any install that came from a CPP link will:

1. Be tagged in `analytics_events` with `source: "cpp"` + the variant
2. Auto-redirect from `/` to the matching funnel:
   - poster → `/post-job`
   - helper → `/signup?intent=helper`

---

## Marketing links

Use these install URLs in your campaigns. Replace `PPID_*` with the IDs
issued by App Store Connect.

```text
Poster (Facebook / Instagram, Erath + New Iberia targeting)
https://apps.apple.com/us/app/helpr/id6754470134?ppid=PPID_POSTER

Helper (local job boards, flyers in cafés / hardware stores)
https://apps.apple.com/us/app/helpr/id6754470134?ppid=PPID_HELPER
```

For website / paid social that lands on louisianahelpr.com first, tack
`?cpp=poster` or `?cpp=helper` onto the URL — the same router picks it up.

---

## Measuring performance

Apple shows per-CPP impressions / downloads / conversion in
**App Store Connect → Analytics → Sources**. We mirror it in our own
analytics so we can correlate install variant → activation → first job
posted / accepted:

- `app_opened_from_deep_link` event with `source = "cpp"` and `variant`
- Tagged on every downstream event for that session via `getActiveCppVariant()`

If conversion on one funnel underperforms (Apple's threshold for "this is
working" is +2.5 % over the default page), iterate on screenshots first —
they move the needle far more than copy.

---

## Adding a new CPP later

1. Add a folder under `fastlane/metadata/custom_product_pages/<slug>/`
2. Create the page in App Store Connect, submit, grab the ppid
3. Add the ppid → variant mapping in `cppRouting.ts`
4. Add a route in `VARIANT_ROUTES`
