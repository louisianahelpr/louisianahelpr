// Take every membership in-app purchase product OFF SALE (owner OK 2026-10-21,
// via the lead): memberships are off (roadmap F4/F4a, Q1841) and the iOS app no
// longer offers them, so nothing should be purchasable in any territory.
//
// Off sale = an availability with no territories and availableInNewTerritories
// false, which is what App Store Connect's "Remove from Sale" writes. The
// products are kept (deleting one burns its product id forever).
//
// Dry run unless the workflow's `apply` box is ticked (ASC_APPLY=1). Prints each
// product's state and territory count before and after.
//
// Run: gh workflow run asc-iap.yml -f mode=release-iap-offsale [-f apply=true]

import { mintToken, asc, ascAll } from "./asc-client.mjs";
import { APPLY, findApp } from "./release-lib.mjs";

const token = mintToken();
const app = await findApp(token);

async function territoryCount(path) {
  const r = await asc(path, { token }).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
  if (!r?.data) return { id: null, count: 0, newTerritories: false };
  const terr = await ascAll(`/v1/${r.data.type}/${r.data.id}/availableTerritories?limit=200`, token).catch(() => null);
  return {
    id: r.data.id,
    count: terr ? terr.length : "?",
    newTerritories: r.data.attributes?.availableInNewTerritories,
  };
}

const products = [];
for (const p of await ascAll(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`, token)) {
  products.push({
    productId: p.attributes.productId,
    state: p.attributes.state,
    availabilityPath: `/v2/inAppPurchases/${p.id}/inAppPurchaseAvailability`,
    post: {
      type: "inAppPurchaseAvailabilities",
      relationships: { inAppPurchase: { data: { type: "inAppPurchases", id: p.id } } },
    },
    reread: async () => (await asc(`/v2/inAppPurchases/${p.id}`, { token })).data.attributes.state,
  });
}
for (const g of await ascAll(`/v1/apps/${app.id}/subscriptionGroups?limit=50`, token)) {
  for (const s of await ascAll(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=200`, token)) {
    products.push({
      productId: s.attributes.productId,
      state: s.attributes.state,
      availabilityPath: `/v1/subscriptions/${s.id}/subscriptionAvailability`,
      post: {
        type: "subscriptionAvailabilities",
        relationships: { subscription: { data: { type: "subscriptions", id: s.id } } },
      },
      reread: async () => (await asc(`/v1/subscriptions/${s.id}`, { token })).data.attributes.state,
    });
  }
}

let failed = false;
for (const p of products) {
  const before = await territoryCount(p.availabilityPath);
  console.log(`${p.productId}  state=${p.state}  territories=${before.count}  newTerritories=${before.newTerritories}`);
  if (before.count === 0 && before.newTerritories === false) {
    console.log("   already off sale");
    continue;
  }
  if (!APPLY) {
    console.log("   DRY RUN: would remove from sale in every territory");
    continue;
  }
  try {
    await asc(`/v1/${p.post.type}`, {
      method: "POST",
      token,
      body: {
        data: {
          type: p.post.type,
          attributes: { availableInNewTerritories: false },
          relationships: { ...p.post.relationships, availableTerritories: { data: [] } },
        },
      },
    });
    const after = await territoryCount(p.availabilityPath);
    console.log(`   AFTER state=${await p.reread()}  territories=${after.count}  newTerritories=${after.newTerritories}`);
    if (after.count !== 0) failed = true;
  } catch (e) {
    console.log(`   FAILED: ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
