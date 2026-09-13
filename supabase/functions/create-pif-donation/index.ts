// LEGACY ALIAS (2026-09-12) — drop once the minimum supported app version no
// longer uses it. Tracked in docs/OPEN.md, "Gift card legacy aliases".
//
// The feature is the Helpr gift card and this function is
// `create-gift-card-checkout`. App Store v1.0.x (and any web bundle cached from
// before the rename) still invokes it under this old name, so this directory
// stays deployed as a thin forwarder: importing the real module registers the
// same `serve()` handler, with the same auth, rate limit and behaviour. No
// logic lives here.
//
// Exempt from src/test/giftCardNaming.test.ts by explicit path.
import "../create-gift-card-checkout/index.ts";
