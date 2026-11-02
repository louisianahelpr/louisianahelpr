# Find Work custom product page: screenshots

No fastlane lane uploads this folder. `deliver` (the `metadata` and `release`
lanes) uploads only `fastlane/screenshots/`. Custom product pages are set up in
App Store Connect (App Store > Custom Product Pages), and their screenshots are
added there by hand. Keep the files here so the page can be rebuilt.

## Sizes (portrait, exact pixels; App Store Connect picks the device from the size)

| Device             | Folder        | Pixel size  |
|--------------------|---------------|-------------|
| iPhone 6.9"        | `iphone_6_9/` | 1320 x 2868 |
| iPhone 6.7"        | `iphone_6_7/` | 1290 x 2796 |
| iPad 12.9" / 13"   | `ipad_13/`    | 2048 x 2732 |

At most 10 per device.

## Frame order

1. **Jobs near you** - the Jobs browse list
2. **See your take-home** - a job page with the take-home line and Apply
3. **Apply** - the apply sheet
4. **Chat** - Messages with the person who posted the job
5. **Get paid when it's done** - the job's payment line after approval

## Rules

- Real screens from the app with sample content. Never real member data.
- No star ratings, review counts, earnings or fee figures presented as real.
- Never the word "escrow". Payment is "held safely until you approve the work".
- Only features that are on for everyone (no Shops, Rentals, Quotes or memberships).
