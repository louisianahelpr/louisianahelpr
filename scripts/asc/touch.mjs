// Nudge each auto-renewable subscription so Apple recomputes its state.
//
// HYPOTHESIS, and it is testable rather than another guess at a missing field.
// The four non-renewing passes flipped to READY_TO_SUBMIT the instant a write
// landed on them (their availability). The eight subscriptions have every
// required field — localization, price, availability, a COMPLETE review
// screenshot, and a localized group — and have not been WRITTEN TO since
// before the screenshots were uploaded. If `state` is derived at write time
// rather than continuously, they are complete but stale, and any modification
// should settle it.
//
// The write is a no-op in content: reviewNote is PATCHed to the value it
// already holds. That matters — this must not change what the products mean,
// only cause Apple to re-evaluate them.
//
// If the state does not move, the hypothesis is wrong and the answer is a field
// the API does not expose, which the App Store Connect UI names directly.

import { mintToken, asc, ascAll } from "./asc-client.mjs";

const token = mintToken();
const apps = await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(process.env.ASC_BUNDLE_ID || "com.Helpr")}`, token);
const groups = await ascAll(`/v1/apps/${apps[0].id}/subscriptionGroups?limit=10`, token);

for (const g of groups) {
  for (const sub of await ascAll(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=200`, token)) {
    const { productId, state, reviewNote } = sub.attributes;
    if (state === "READY_TO_SUBMIT") { console.log(`= ${productId} already ${state}`); continue; }
    const after = await asc(`/v1/subscriptions/${sub.id}`, {
      method: "PATCH", token,
      body: { data: { type: "subscriptions", id: sub.id,
        attributes: { reviewNote: reviewNote ?? `Membership tier ${productId}.` } } },
    });
    console.log(`~ ${productId}  ${state} -> ${after?.data?.attributes?.state ?? "?"}`);
  }
}
console.log("\n--- done ---");
