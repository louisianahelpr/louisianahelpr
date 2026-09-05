// Stop offering the subscriptions in territories they have no price for.
//
// THE DIFFERENCE BETWEEN THE TWO PRODUCT TYPES, found by diffing a
// READY_TO_SUBMIT one-time pass against a MISSING_METADATA subscription:
//
//   A non-renewing IAP is priced by a SCHEDULE with a baseTerritory. Apple
//   derives every other territory's price from that base, so declaring
//   availableInNewTerritories: true is harmless — a new storefront inherits a
//   price automatically.
//
//   A subscription is priced by explicit per-territory subscriptionPrices. Only
//   USA was created. Declaring availableInNewTerritories: true therefore says
//   "sell this in storefronts I have given you no price for", and Apple calls
//   that incomplete — which is what MISSING_METADATA meant all along.
//
// The fix is to stop claiming those territories. That is also the honest
// product answer rather than a workaround: Helpr is a Louisiana marketplace,
// its Stripe prices are USD, and its one availability territory is USA. An
// earlier comment in create.mjs argued the opposite — that Louisiana-only is a
// product decision and not a storefront one — which reads well and is wrong
// here, because the storefront claim has to be backed by a price and there
// isn't one.

import { mintToken, asc, ascAll } from "./asc-client.mjs";

const token = mintToken();
const appId = (await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(process.env.ASC_BUNDLE_ID || "com.Helpr")}`, token))[0].id;
const TERRITORY = "USA";

for (const g of await ascAll(`/v1/apps/${appId}/subscriptionGroups?limit=10`, token)) {
  for (const sub of await ascAll(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=200`, token)) {
    const pid = sub.attributes.productId;
    if (sub.attributes.state === "READY_TO_SUBMIT") { console.log(`= ${pid} already ready`); continue; }

    const avail = await asc(`/v1/subscriptions/${sub.id}/subscriptionAvailability`, { token })
      .then((r) => r?.data ?? null).catch(() => null);

    if (avail?.attributes?.availableInNewTerritories === false) {
      console.log(`= ${pid} already USA-only`);
    } else if (avail) {
      // PATCH first; availability may be create-only, in which case fall back
      // to a fresh POST. Trying both is cheaper than reading Apple's docs wrong
      // a fifth time.
      await asc(`/v1/subscriptionAvailabilities/${avail.id}`, {
        method: "PATCH", token,
        body: { data: { type: "subscriptionAvailabilities", id: avail.id,
          attributes: { availableInNewTerritories: false } } },
      }).catch(async (e) => {
        console.log(`    ! PATCH failed (${e.status}), recreating`);
        await asc("/v1/subscriptionAvailabilities", {
          method: "POST", token,
          body: { data: { type: "subscriptionAvailabilities",
            attributes: { availableInNewTerritories: false },
            relationships: {
              subscription: { data: { type: "subscriptions", id: sub.id } },
              availableTerritories: { data: [{ type: "territories", id: TERRITORY }] },
            } } },
        });
      });
      console.log(`~ ${pid} availableInNewTerritories -> false`);
    }

    const after = await asc(`/v1/subscriptions/${sub.id}`, { token });
    console.log(`  ${pid} state=${after?.data?.attributes?.state}`);
  }
}
console.log("\n--- done ---");
