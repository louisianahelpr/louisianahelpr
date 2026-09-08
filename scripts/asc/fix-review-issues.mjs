// Fix the two App Review rejections that are pure metadata.
//
// Version 1.0 was rejected 2026-04-14 on four guidelines. Two of them are data
// in App Store Connect and can be corrected here; the other two need artefacts
// (screenshots) or a new build.
//
//   1.5  Support URL — points at https://www.louisianahelpr.com, which Apple
//        says is not a support page. The site already serves /support (200), so
//        this is a one-field correction to a page that exists.
//
//   2.3.6 Age Rating — the declaration claims In-App Controls (Parental
//        Controls / Age Assurance) and the app has neither. Apple's own
//        instruction is to set both to "None". Declaring a safety control that
//        does not exist is the kind of inaccuracy worth fixing at the source
//        rather than arguing.
//
// Read-then-write with a report either way: this edits a live App Store
// listing, so it prints what it found before changing anything.

import { mintToken, asc, ascAll } from "./asc-client.mjs";

const token = mintToken();
const SUPPORT_URL = process.env.ASC_SUPPORT_URL || "https://www.louisianahelpr.com/support";
const apply = process.env.ASC_APPLY === "1";

const appId = (await ascAll(`/v1/apps?filter[bundleId]=${encodeURIComponent(process.env.ASC_BUNDLE_ID || "com.Helpr")}`, token))[0].id;
console.log(`app ${appId}   apply=${apply}\n`);

// ── 1.5 Support URL ─────────────────────────────────────────────────────────
// It lives on the VERSION localization, not the app — each version carries its
// own, which is why fixing it in one place and resubmitting an older version
// would not stick.
const versions = await ascAll(`/v1/apps/${appId}/appStoreVersions?limit=10`, token);
for (const v of versions) {
  const st = v.attributes.appStoreState ?? v.attributes.state;
  const locs = await ascAll(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=20`, token);
  for (const l of locs) {
    const { locale, supportUrl, marketingUrl } = l.attributes;
    console.log(`version ${v.attributes.versionString} [${st}] ${locale}`);
    console.log(`   supportUrl:   ${supportUrl}`);
    console.log(`   marketingUrl: ${marketingUrl}`);
    if (supportUrl === SUPPORT_URL) { console.log("   = already correct"); continue; }
    if (!apply) { console.log(`   would set → ${SUPPORT_URL}`); continue; }
    await asc(`/v1/appStoreVersionLocalizations/${l.id}`, {
      method: "PATCH", token,
      body: { data: { type: "appStoreVersionLocalizations", id: l.id,
        attributes: { supportUrl: SUPPORT_URL } } },
    });
    console.log(`   + set → ${SUPPORT_URL}`);
  }
}

// ── 2.3.6 Age Rating ────────────────────────────────────────────────────────
// The declaration hangs off appInfos.
const infos = await ascAll(`/v1/apps/${appId}/appInfos?limit=10`, token);
for (const info of infos) {
  const decl = await asc(`/v1/appInfos/${info.id}/ageRatingDeclaration`, { token })
    .then((r) => r?.data ?? null).catch(() => null);
  if (!decl) { console.log(`\nappInfo ${info.id}: no ageRatingDeclaration`); continue; }
  const a = decl.attributes ?? {};
  console.log(`\nageRatingDeclaration ${decl.id}`);
  // Print only the fields Apple named, plus anything non-null, so the diff is
  // readable rather than 30 lines of nulls.
  console.log("   RAW: " + JSON.stringify(a));
  const target = {};
  if ("parentalControls" in a && a.parentalControls !== false) target.parentalControls = false;
  if ("ageAssurance" in a && a.ageAssurance !== false) target.ageAssurance = false;
  if (!Object.keys(target).length) { console.log("   = parentalControls/ageAssurance already clear (or not present under those names)"); continue; }
  if (!apply) { console.log(`   would PATCH → ${JSON.stringify(target)}`); continue; }
  await asc(`/v1/ageRatingDeclarations/${decl.id}`, {
    method: "PATCH", token,
    body: { data: { type: "ageRatingDeclarations", id: decl.id, attributes: target } },
  });
  console.log(`   + PATCHed → ${JSON.stringify(target)}`);
}

console.log(apply ? "\n--- applied ---" : "\n--- DRY RUN, nothing written (set ASC_APPLY=1) ---");
