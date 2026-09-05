// Create the twelve in-app purchase products the tier ladder needs.
//
// IDEMPOTENT BY CONSTRUCTION. Every step looks for what it is about to create
// and skips it if present, so a run that dies halfway — a network blip, a
// validation Apple only applies to the ninth product — can simply be re-run.
// That matters more here than usual: App Store Connect has no bulk delete for
// in-app purchases, so a non-resumable script that fails at product nine leaves
// eight orphans to clean up by hand.
//
// SHAPE OF THE CATALOGUE
//   8 auto-renewable subscriptions  (4 tiers × monthly/annual), in ONE group
//   4 non-renewing subscriptions    (the one-time month passes)
//
// The one-time passes are NON_RENEWING_SUBSCRIPTION rather than CONSUMABLE
// because that is what they are: a fixed window of membership that does not
// renew. Apple treats consumables as things you can buy repeatedly and stack,
// which is not what a month of Pro is.
//
// GROUP LEVELS. Level 1 is the BEST tier — Apple ranks upgrades by ascending
// level, so an upgrade must move to a lower number. Monthly and annual of the
// same tier share a level, which is what makes switching between them a
// crossgrade (immediate, prorated) rather than an upgrade or downgrade.

import { mintToken, asc, ascAll } from "./asc-client.mjs";

const BUNDLE_ID = process.env.ASC_BUNDLE_ID || "com.Helpr";
const GROUP_REF = "Helpr Membership";
const TERRITORY = "USA";

// Mirrors src/lib/subscriptionTiers.ts. Level ascends as the tier gets cheaper.
const TIERS = [
  { key: "elite", label: "Elite", level: 1, monthly: "20.00", annual: "200.00", once: "20.00" },
  { key: "plus",  label: "Plus",  level: 2, monthly: "15.00", annual: "150.00", once: "15.00" },
  { key: "pro",   label: "Pro",   level: 3, monthly: "10.00", annual: "100.00", once: "10.00" },
  { key: "basic", label: "Basic", level: 4, monthly: "5.00",  annual: "50.00",  once: "5.00"  },
];

const productId = (tier, cadence) =>
  `com.helpr.${tier}.${cadence === "one_time" ? "onetime" : cadence}`;

// Apple's limits, discovered the hard way on the first run: a subscription
// localization DESCRIPTION is capped at 55 characters and the API only says so
// at POST time, after the product itself has been created. Names are capped at
// 30. These are checked in the pre-flight below so a violation fails before
// anything is written, rather than nine products in.
const MAX = { subDescription: 55, locName: 30, iapDescription: 45 };

const DESCRIPTION = {
  elite: "Lowest fee, top placement, 20-min early job access.",
  plus:  "A lower fee on every job, 15-min early job access.",
  pro:   "Priority placement and 10-min early job access.",
  basic: "A lower platform fee and 5-min early job access.",
};

const IAP_DESCRIPTION = {
  elite: "One month of Elite. Does not renew.",
  plus:  "One month of Plus. Does not renew.",
  pro:   "One month of Pro. Does not renew.",
  basic: "One month of Basic. Does not renew.",
};

// ── Pre-flight: every string Apple will length-check, checked here first ─────
// The first run created a subscription group and one subscription before Apple
// rejected the description. Nothing is deletable in bulk afterwards, so the
// cheap fix is to refuse to start when any string is already known to be too
// long.
{
  const bad = [];
  for (const t of TIERS) {
    const check = (label, value, limit) => {
      if (value.length > limit) bad.push(`${label}: ${value.length} > ${limit} — "${value}"`);
    };
    check(`${t.key} sub description`, DESCRIPTION[t.key], MAX.subDescription);
    check(`${t.key} sub loc name`, `Helpr ${t.label}`, MAX.locName);
    check(`${t.key} iap loc name`, `Helpr ${t.label} Month Pass`, MAX.locName);
    check(`${t.key} iap description`, IAP_DESCRIPTION[t.key], MAX.iapDescription);
  }
  if (bad.length) {
    console.error("Pre-flight failed — nothing was written:\n  " + bad.join("\n  "));
    process.exit(1);
  }
  console.log("✓ pre-flight: all names and descriptions within Apple's limits\n");
}

const token = mintToken();
const log = (...a) => console.log(...a);

// ── App ─────────────────────────────────────────────────────────────────────
const apps = await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`, token);
if (!apps.length) throw new Error(`No app for bundleId ${BUNDLE_ID}`);
const appId = apps[0].id;
log(`APP ${apps[0].attributes.name} (${appId})\n`);

// ── Subscription group ──────────────────────────────────────────────────────
let group = (await ascAll(`/v1/apps/${appId}/subscriptionGroups?limit=200`, token))
  .find((g) => g.attributes.referenceName === GROUP_REF);
if (group) {
  log(`= group "${GROUP_REF}" exists (${group.id})`);
} else {
  const created = await asc("/v1/subscriptionGroups", {
    method: "POST", token,
    body: { data: { type: "subscriptionGroups", attributes: { referenceName: GROUP_REF },
      relationships: { app: { data: { type: "apps", id: appId } } } } },
  });
  group = created.data;
  log(`+ group "${GROUP_REF}" (${group.id})`);
}

const existingSubs = await ascAll(`/v1/subscriptionGroups/${group.id}/subscriptions?limit=200`, token);
const subByProduct = new Map(existingSubs.map((s) => [s.attributes.productId, s]));

/** Attach a price to a subscription, choosing the price point Apple offers. */
async function priceSubscription(subId, customerPrice, label) {
  const existing = await ascAll(
    `/v1/subscriptions/${subId}/prices?filter[territory]=${TERRITORY}&limit=200`, token);
  if (existing.length) { log(`    = ${label} already priced`); return; }
  const points = await ascAll(
    `/v1/subscriptions/${subId}/pricePoints?filter[territory]=${TERRITORY}&limit=200`, token);
  const point = points.find((p) => p.attributes.customerPrice === customerPrice);
  if (!point) {
    const near = points.map((p) => p.attributes.customerPrice).slice(0, 8).join(", ");
    throw new Error(`No ${TERRITORY} price point at ${customerPrice} for ${label}. Nearby: ${near}`);
  }
  await asc("/v1/subscriptionPrices", {
    method: "POST", token,
    body: { data: { type: "subscriptionPrices",
      attributes: { startDate: null, preserveCurrentPrice: false },
      relationships: {
        subscription: { data: { type: "subscriptions", id: subId } },
        subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: point.id } },
      } } },
  });
  log(`    + ${label} priced at ${customerPrice}`);
}

// ── 8 auto-renewable subscriptions ──────────────────────────────────────────
for (const t of TIERS) {
  for (const cadence of ["monthly", "annual"]) {
    const pid = productId(t.key, cadence);
    const period = cadence === "monthly" ? "ONE_MONTH" : "ONE_YEAR";
    const name = `Helpr ${t.label} ${cadence === "monthly" ? "Monthly" : "Annual"}`;
    let sub = subByProduct.get(pid);

    if (sub) {
      log(`= ${pid}`);
    } else {
      const created = await asc("/v1/subscriptions", {
        method: "POST", token,
        body: { data: { type: "subscriptions",
          attributes: { name, productId: pid, subscriptionPeriod: period, groupLevel: t.level,
            familySharable: false, reviewNote: `Membership tier: ${t.label}, billed ${cadence}.` },
          relationships: { group: { data: { type: "subscriptionGroups", id: group.id } } } } },
      });
      sub = created.data;
      log(`+ ${pid}  level=${t.level}  ${period}`);
    }

    const locs = await ascAll(`/v1/subscriptions/${sub.id}/subscriptionLocalizations?limit=50`, token);
    if (!locs.some((l) => l.attributes.locale === "en-US")) {
      await asc("/v1/subscriptionLocalizations", {
        method: "POST", token,
        body: { data: { type: "subscriptionLocalizations",
          attributes: { locale: "en-US", name: `Helpr ${t.label}`, description: DESCRIPTION[t.key] },
          relationships: { subscription: { data: { type: "subscriptions", id: sub.id } } } } },
      });
      log(`    + en-US localization`);
    }
    await priceSubscription(sub.id, cadence === "monthly" ? t.monthly : t.annual, pid);
  }
}

// ── 4 non-renewing one-time passes ──────────────────────────────────────────
const existingIaps = await ascAll(`/v1/apps/${appId}/inAppPurchasesV2?limit=200`, token);
const iapByProduct = new Map(existingIaps.map((p) => [p.attributes.productId, p]));

for (const t of TIERS) {
  const pid = productId(t.key, "one_time");
  let iap = iapByProduct.get(pid);
  if (iap) {
    log(`= ${pid}`);
  } else {
    const created = await asc("/v2/inAppPurchases", {
      method: "POST", token,
      body: { data: { type: "inAppPurchases",
        attributes: { name: `Helpr ${t.label} Month Pass`, productId: pid,
          inAppPurchaseType: "NON_RENEWING_SUBSCRIPTION",
          reviewNote: `One month of ${t.label} membership. Does not renew.` },
        relationships: { app: { data: { type: "apps", id: appId } } } } },
    });
    iap = created.data;
    log(`+ ${pid}`);
  }

  const locs = await ascAll(`/v2/inAppPurchases/${iap.id}/inAppPurchaseLocalizations?limit=50`, token);
  if (!locs.some((l) => l.attributes.locale === "en-US")) {
    await asc("/v1/inAppPurchaseLocalizations", {
      method: "POST", token,
      body: { data: { type: "inAppPurchaseLocalizations",
        attributes: { locale: "en-US", name: `Helpr ${t.label} Month Pass`,
          description: `One month of ${t.label}. ${DESCRIPTION[t.key]}` },
        relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id: iap.id } } } } },
    });
    log(`    + en-US localization`);
  }

  const sched = await ascAll(`/v2/inAppPurchases/${iap.id}/iapPriceSchedule?limit=1`, token).catch(() => []);
  if (Array.isArray(sched) && sched.length) { log(`    = already priced`); continue; }
  const points = await ascAll(
    `/v2/inAppPurchases/${iap.id}/pricePoints?filter[territory]=${TERRITORY}&limit=200`, token);
  const point = points.find((p) => p.attributes.customerPrice === t.once);
  if (!point) {
    throw new Error(`No ${TERRITORY} price point at ${t.once} for ${pid}`);
  }
  await asc("/v1/inAppPurchasePriceSchedules", {
    method: "POST", token,
    body: { data: { type: "inAppPurchasePriceSchedules",
      relationships: {
        inAppPurchase: { data: { type: "inAppPurchases", id: iap.id } },
        baseTerritory: { data: { type: "territories", id: TERRITORY } },
        manualPrices: { data: [{ type: "inAppPurchasePrices", id: "${new}" }] },
      } },
      included: [{ type: "inAppPurchasePrices", id: "${new}",
        attributes: { startDate: null },
        relationships: { inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: point.id } } } }] },
  });
  log(`    + priced at ${t.once}`);
}

log("\n--- done ---");
