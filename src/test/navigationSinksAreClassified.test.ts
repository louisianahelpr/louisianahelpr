// @mutate src/components/job-card/JobCardPhotoStrip.tsx | href={openableDocumentUrl(url) ?? undefined} | href={url}
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { readdirSync } from "./helpers/trackedFiles";

/**
 * CLASS CHECK: every navigation sink in src/ is either safe by construction or
 * classified here with the reason its value cannot carry a `javascript:` URL.
 *
 * Why: users can write URL-shaped values into their own rows with no shape
 * CHECK (measured live 2026-09-23 via information_schema.column_privileges +
 * pg_policies: profiles.avatar_url / portfolio_urls, jobs.photos, …). React 18
 * renders a `javascript:` href (a console warning, nothing more) and the CSP
 * allows 'unsafe-inline', so one such value bound to an `href` is stored XSS on
 * whoever clicks it — 3c81624d0 (admin document link) and the follow-up that
 * added this file (public profile "Recent work", admin People tab, job photo
 * strips) were all that shape.
 *
 * A "navigation sink" is where a string becomes a place the browser GOES:
 *   JSX `href={…}`, `window.open(…)`, `location.href = …`,
 *   `location.assign/replace(…)`, `openExternalUrl(…)`, `<el>.href = …`.
 * `<img src>` / `<video src>` are deliberately NOT sinks: no browser executes a
 * `javascript:` or SVG script from an image/media src.
 *
 * Safe by construction (auto-passes): a string literal; a template literal whose
 * text starts with a fixed scheme or a `/`; an UPPER_CASE constant;
 * `safeDocumentUrl(…)` or `openableDocumentUrl(…)` (safeDocumentUrl's output, a
 * data: image re-served as a blob: of the same bytes, Q295); `undefined`. Anything else must appear in CLASSIFIED
 * below with its reason, and every CLASSIFIED entry must still exist (a stale
 * entry fails too, so the list cannot rot into a blanket pass).
 */
const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}
const norm = (e: string) => e.replace(/\s+/g, " ").trim();

/**
 * Every navigation-sink expression in a source file, read from the TypeScript
 * AST (so comments, strings and regex literals can never be mistaken for code).
 */
function navigationSinks(source: string, fileName = "f.tsx"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const push = (e: ts.Node | undefined) => e && out.push(norm(e.getText(sf)));
  const calleeText = (e: ts.Expression) => norm(e.getText(sf)).replace(/\?\./g, ".");
  const visit = (node: ts.Node) => {
    // <a href={…}>
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "href" && node.initializer && ts.isJsxExpression(node.initializer)) {
      push(node.initializer.expression);
    }
    // window.open(…), location.assign/replace(…), openExternalUrl(…)
    if (ts.isCallExpression(node)) {
      const callee = calleeText(node.expression);
      if (/(^|\.)window\.open$/.test(callee)) push(node.arguments[0]);
      else if (/(^|\.)location\.(assign|replace)$/.test(callee)) push(node.arguments[0]);
      else if (callee === "openExternalUrl") push(node.arguments[0]);
    }
    // x.href = … / location.href = … / window.location = …
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      (node.left.name.text === "href" || (node.left.name.text === "location" && calleeText(node.left.expression) === "window"))
    ) {
      push(node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** True when the expression's scheme is fixed by the author, not by data. */
function safeByConstruction(expr: string): boolean {
  if (/^(["'])[^"']*\1$/.test(expr)) return !/^["']\s*(javascript|vbscript|data):/i.test(expr);
  if (/^`(\/(?!\/)|https:\/\/|mailto:|tel:|sms:|helpr:)/i.test(expr)) return true;
  if (/^[A-Z][A-Z0-9_]*$/.test(expr)) return true;
  // Exactly `safeDocumentUrl(x)` or `safeDocumentUrl(x) ?? undefined` — not
  // `safeDocumentUrl(x) ?? raw`, which would hand the raw value back.
  if (/^(safe|openable)DocumentUrl\([^()]*\)( \?\? undefined)?$/.test(expr)) return true;
  if (expr === "undefined") return true;
  return false;
}

/**
 * `file::expression` → why this value cannot carry a script scheme. Keep the
 * reason specific (where the value comes from); "trusted" is not a reason.
 */
const STRIPE_EDGE_URL = "a Stripe/checkout URL returned by our own edge function (server-built, not a user-writable column)";
const STORAGE_SIGNED = "supabase.storage createSignedUrl() output: always https on this project's own origin";
const PROOF_SIGNED = "useProofPhotoUrls(): a signed proof-photos URL, or the stored value only when it matches ^https?:// (signProofPhotoUrls), else null";
const OBJECT_URL = "URL.createObjectURL() of a Blob the app built itself (blob: on our own origin)";
const MAPS = "mapsSearchUrl(): a fixed https://maps.apple.com / maps:// / geo: prefix + encodeURIComponent(address)";

const CLASSIFIED: Record<string, string> = {
  // 25 Days sponsor page (owner 2026-11-09).
  // Shops paperwork queue (lead train 11-10): the permit document link, gated by isStorageObjectPath in permitDocumentUrl.
  "components/admin/ShopsPaperworkCard.tsx::await permitDocumentUrl(path)": STORAGE_SIGNED,
  "pages/admin/sponsors/AdminSponsorsPage.tsx::url": `${OBJECT_URL}: the CSV export, and the logo file the admin-only sponsor-25days function sent back (logoDownloadUrl)`,
  "components/sponsor/ClaimSection.tsx::href": "a data:text/calendar URL of an .ics file the page builds itself (buildIcs + encodeURIComponent)",
  "components/sponsor/Sections.tsx::href": "ExternalButton's prop: every caller passes C.links.* (our content file constants) or filledUrl() output (^https?:// only)",
  "components/sponsor/Sections.tsx::group": "filledUrl(C.links.facebookGroup): our content file value, only when it matches ^https?:// with no placeholder",
  "components/sponsor/Sections.tsx::C.links.facebookPage": "a constant https:// URL in src/content/sponsorPage.ts",
  "components/sponsor/Sections.tsx::C.links.website": "a constant https:// URL in src/content/sponsorPage.ts",
  "components/sponsor/Sections.tsx::site": "filledUrl(sponsor website): a sponsor-entered value shown only after an admin confirms the sponsor, and only when it matches ^https?:// (no javascript:/data:); rel noopener noreferrer nofollow",
  // --- stored values, sanitized upstream of the sink ---
  "components/AttachmentLink.tsx::signed": "getAttachmentSignedUrl(): isStorageObjectPath-gated createSignedUrl output, else null",
  "components/MessageAttachment.tsx::url": "thumbUrl / getMessageAttachmentSignedUrl(): isStorageObjectPath-gated createSignedUrl output, else null",
  "components/DisputeTimelineDialog.tsx::src ?? undefined": `${PROOF_SIGNED}; input is partitionEvidenceUrls().trusted`,
  "components/admin/adminDisputes/DisputeCard.tsx::src ?? undefined": `${PROOF_SIGNED}; input is partitionEvidenceUrls().trusted`,
  "components/admin/adminReports/WantedReportPanel.tsx::photoPublicUrl(p)": "photoPublicUrl(): our storage client's own https public URL for a stored path",
  "components/ProofPhotoImg.tsx::src": `${PROOF_SIGNED}; every caller passes useProofPhotoUrls() output`,
  "components/PhotoProof.tsx::beforeSrcs[i] ?? undefined": PROOF_SIGNED,
  "components/PhotoProof.tsx::afterSrcs[i] ?? undefined": PROOF_SIGNED,
  // The read-only gallery, split out of PhotoProof.tsx on 2026-10-23: the same signed proof links.
  "components/PhotoProofDialog.tsx::beforeSrcs[i] ?? undefined": PROOF_SIGNED,
  "components/PhotoProofDialog.tsx::afterSrcs[i] ?? undefined": PROOF_SIGNED,
  "pages/jobs/HelperRevisionCard.tsx::url": PROOF_SIGNED,
  "components/admin/AdminCredentialQueue.tsx::signedUrl": "SignedOpenLink state: safeDocumentUrl(path) or createSignedUrl output, nothing else is ever set",
  "components/admin/AdminCredentialQueue.tsx::safe": "const safe = openableDocumentUrl(path) above (safeDocumentUrl output, or a blob: of its data: image)",
  "components/admin/AdminCredentialQueue.tsx::url": "SignedOpenLink's open() for openSignedDocument (Q295): only ever called with \"\" (the blank tab opened inside the click)",
  "components/admin/settings/RentalsOwnershipCard.tsx::url": "the ownership-proof button's open() for openSignedDocument (Q295): only ever called with \"\" (the blank tab opened inside the click)",
  "components/admin/AdminSupport.tsx::url": "ViewScreenshotButton's open() for openSignedDocument (Q295): only ever called with \"\" (the blank tab opened inside the click)",
  "components/admin/userDetail/DocumentsTab.tsx::url": "SignedPortfolioTile's open() for openSignedDocument (Q295): only ever called with \"\" (the blank tab opened inside the click)",
  "lib/rentals/rentReceipt.ts::url": OBJECT_URL + " (the rent receipt text, revoked after 1 s)",
  "lib/openSignedDocument.ts::url": STORAGE_SIGNED + " (Q295: deps.sign() is SignedOpenLink's createSignedUrl behind isStorageObjectPath; null closes the tab)",
  "components/profile/CredentialsTab.tsx::safe": "const safe = openableDocumentUrl(path) above (safeDocumentUrl output, or a blob: of its data: image)",
  "components/profile/CredentialsTab.tsx::signed.signedUrl": STORAGE_SIGNED,
  "components/admin/StalledMissedReturn.tsx::urls[i]!": `${PROOF_SIGNED} (the missed-return report's photos; a null URL renders text, not a link)`,
  "components/messages/MessageBubble.tsx::url": "isSafeHttpsUrl(url) (new URL(url).protocol === 'https:') returns inert text first",
  // --- app-built URLs, no stored value in the scheme position ---
  "components/job-card/JobCardMetaRow.tsx::mapHref": MAPS,
  // Q2425: a fixed https://maps.apple.com/?ll=<number>,<number>&q=<encodeURIComponent(name)> for an admin-curated public spot.
  "components/declutter/OrderTalkPhotoParts.tsx::url.data": STORAGE_SIGNED + " (F389: handoverPhotoUrl(path) on the order-chat photo, isStorageObjectPath-gated createSignedUrl on declutter-handover, else null and no link)",
  "components/declutter/DeclutterProblemSides.tsx::u": STORAGE_SIGNED + " (handoverPhotoUrl(): isStorageObjectPath-gated createSignedUrl on declutter-handover, else null and no link)",
  "components/declutter/DeclutterMeetup.tsx::meetupMapUrl(m)": "meetupMapUrl(): a fixed https://maps.apple.com prefix + Number() coordinates + encodeURIComponent(spot name)",
  "components/declutter/DeclutterRefundReturn.tsx::meetupMapUrl({ spot_lat: r.return_lat, spot_lng: r.return_lng, spot_name: r.return_address })": "meetupMapUrl(): a fixed https://maps.apple.com prefix + Number() coordinates + encodeURIComponent(return address) (returns, Q2486)",
  "pages/jobs/appliedJobCard/DirectionsButton.tsx::href": MAPS,
  "pages/jobs/jobPage/JobPage.tsx::mapsSearchUrl(job.location)": MAPS,
  // Declutter share-fb (Train D): window.open / openExternalUrl of the Facebook sharer for a listing.
  "components/declutter/DeclutterShareCard.tsx::url": "facebookShareUrl(): a fixed https://www.facebook.com/sharer/sharer.php?u= prefix + encodeURIComponent(`${getPublicOrigin()}/declutter/item/${id}`)",
  "components/declutter/DeclutterPickupDayCard.tsx::s.map": "meetupMapUrl() (fixed https://maps.apple.com prefix, Number() coordinates, encodeURIComponent(name)) or mapsSearchUrl() (src/lib/mapsLink.ts, encodeURIComponent(address))",
  "components/declutter/DeclutterPickupDayCard.tsx::route.href": "routeMapsUrl() (src/lib/declutter/route.ts): a fixed https://www.google.com/maps/dir/?api=1 prefix + encodeURIComponent(address) per stop",
  "components/declutter/DeliveryRoute.tsx::maps.href": "routeMapsUrl() (src/lib/declutter/route.ts): a fixed https://www.google.com/maps/dir/?api=1 prefix + encodeURIComponent(address) per stop",
  "components/ReferralSection.tsx::href": "`sms:?&body=${encodeURIComponent(...)}` built on the line above",
  "components/admin/AdminIDVReview.tsx::stripeSessionUrl(r.idv_session_id)": "fixed https://dashboard.stripe.com/... prefix + session id",
  "components/dashboard/filterSheet/jobFilterSections.tsx::signupHref": "signupUrlFor(): \"/signup\" or `/signup?redirect=${encodeURIComponent(safeInternalRedirect(...))}`",
  "components/postjob/MaterialsPanel.tsx::amazonAffiliateUrl(item.searchUrl)": "src/lib/materialsGuide.ts static https://www.amazon.com/... literals with the Associates tag set (amazonAffiliateUrl keeps any non-amazon.com URL unchanged)",
  "pages/profile/strSettings/AddCalendarForm.tsx::helpUrl": "PLATFORM_HELP static literal map (pages/profile/strSettings/types)",
  "pages/info/legal/PrivacySection.tsx::`#${DATA_EXPORT_ANCHOR}`": "in-page #anchor built from a constant",
  "hooks/usePageMeta.ts::meta.canonical": "<link rel=canonical> href set from page-level static meta, not a navigation",
  "lib/calendarExport.ts::objectUrl": OBJECT_URL,
  "lib/nativeShare.ts::objectUrl": OBJECT_URL,
  "lib/chunkReload.ts::url.toString()": "new URL(window.location.href) with a _v param: the current page, reloaded",
  "pages/admin/preview/DeclutterPreviewPage.tsx::window.location.href": "window.open of the page's own address (the 375-wide phone window of the same preview)",
  "pages/admin/preview/JobPreviewPage.tsx::window.location.href": "window.open of the page's own address (the 375-wide phone window of the same preview)",
  "lib/nativeReturnBounce.ts::target": "`${NATIVE_RETURN_SCHEME}://${url.pathname}${url.search}`: fixed app scheme",
  "lib/openExternalUrl.ts::url": "the helper itself; every caller is classified below",
  // Q2259 shipping (testers only): the seller's label is the EasyPost postage_label.label_url the label worker stored
  // (declutter_ship_order_view returns it to the seller only once the label is ready); the buyer's Track is a fixed
  // ups.com / tools.usps.com address with the tracking code URL-encoded (shipOrder.ts trackingUrl).
  "components/declutter/ShipOrderPanel.tsx::l.label_url as string": "the EasyPost label URL the ship-label worker stored, served to the seller by declutter_ship_order_view (20261102023246)",
  "components/declutter/ShipOrderPanel.tsx::trackingUrl(t.data.service, code)": "a fixed ups.com or tools.usps.com tracking address with the code encodeURIComponent-ed (lib/declutter/shipOrder.ts trackingUrl)",
  "components/declutter/ReturnLabelPanel.tsx::url": "the EasyPost return-label URL the return-label worker stored (declutter_ship_return_label_bought), served only to the order's buyer by declutter_my_return_label (20261103212046)",
  // --- openExternalUrl callers: edge-function-returned Stripe URLs ---
  "components/AwardGateDialog.tsx::data.url": STRIPE_EDGE_URL,
  // Q2352: the one-time setup fee page (pay-onboarding-fee) for a refused first Declutter listing.
  "lib/declutter/setupFee.ts::data.url": STRIPE_EDGE_URL,
  // Owner 2026-10-25: "Finish payout setup" (the hired prompt and the job card) opens stripe-connect's onboard link.
  "hooks/useStartPayoutSetup.ts::data.url": STRIPE_EDGE_URL,
  "components/declutter/DeliveryRaisePanel.tsx::res.url": STRIPE_EDGE_URL, // Q1929: declutter-checkout raise_pay's Stripe page
  // Q2453: startDeliveryTip() returns declutter-checkout delivery_tip's Stripe page url (server-built).
  "components/declutter/DeliveryTipPanel.tsx::url": STRIPE_EDGE_URL,
  "components/identity/IdentityCheckSheet.tsx::data.url": STRIPE_EDGE_URL,
  "components/CompletionPrompts.tsx::data.url": STRIPE_EDGE_URL,
  "components/JobBoostDialog.tsx::data.url": STRIPE_EDGE_URL,
  "components/PayoutSetupForm.tsx::data.url": STRIPE_EDGE_URL,
  "components/TipDialog.tsx::data.url": STRIPE_EDGE_URL,
  "components/profile/BackgroundCheckCard.tsx::data.url": STRIPE_EDGE_URL,
  "components/profile/SubscriptionTab.tsx::data.url": STRIPE_EDGE_URL,
  // Shops M1: requestOrder() returns shop-checkout's Checkout session url (server-built).
  "components/shops/ShopOrderSheet.tsx::url": STRIPE_EDGE_URL,
  // Shops digital downloads (20261108185110): Buy opens shop-checkout buy_digital's Stripe page (server-built); in the
  // iPhone app it opens the fixed louisianahelpr.com shop page (digitalBuyUrl: a constant origin, the shop and item ids
  // encodeURIComponent-ed). The download links are shop-digital's signed shop-digital storage URLs (10 minutes).
  "components/shops/ShopDigitalBuy.tsx::url": STRIPE_EDGE_URL,
  "components/shops/ShopDigitalBuy.tsx::digitalBuyUrl(shopId, item.id)": "the fixed https://www.louisianahelpr.com/shops/<id>?buy=<id> page (lib/shops/digitalFiles.ts digitalBuyUrl, both ids encodeURIComponent-ed): the App Store US-storefront link-out to pay on the website",
  "components/shops/ShopDigitalFiles.tsx::url": "a signed URL into the private shop-digital bucket, minted by shop-digital (download) for the file's own seller (supabase createSignedUrl, 600 s)",
  "components/shops/ShopDigitalOrder.tsx::url": "a signed URL into the private shop-digital bucket, minted by shop-digital (download) only after shop_digital_download_path allowed this buyer (supabase createSignedUrl, 600 s)",
  // Custom orders (20261106205852): the buyer orders the shop's price; the same shop-checkout Stripe page.
  "components/shops/ShopCustomOrderForm.tsx::url": STRIPE_EDGE_URL,
  // Custom orders (50% deposit): payOrderRest() returns shop-checkout's pay-the-rest Checkout session url (server-built).
  "components/shops/ShopOrderCard.tsx::url": STRIPE_EDGE_URL,
  "pages/profile/GiftCard.tsx::data.url": STRIPE_EDGE_URL,
  "pages/posts/postedJobs/RecurringVisitPayments.tsx::url": STRIPE_EDGE_URL,
  // startCardSave() returns declutter-card's Checkout (setup) session url (server-built).
  "components/declutter/DeclutterOfferPanel.tsx::url": STRIPE_EDGE_URL,
  "components/declutter/DeclutterTradeViews.tsx::res.url": STRIPE_EDGE_URL,
  "pages/post-job/useJobSubmit.ts::paymentUrl": STRIPE_EDGE_URL,
  "lib/escrowCheckout.ts::url": STRIPE_EDGE_URL + " (create-payment action escrow, the quote screens' booking)",
  // --- memberProfilePath(id): always the fixed template `/user/${userId}` (src/lib/profileLink/memberProfilePath.ts), a same-origin path ---
  "pages/posts/postedJobs/ApplicantsPanel.tsx::memberProfilePath(app.helper_id)": "memberProfilePath(): fixed `/user/` prefix + the applicant's uuid, same-origin path",
  "pages/posts/postedJobs/applicantsPanel/ApplicantAvatarLink.tsx::memberProfilePath(helperId)": "memberProfilePath(): fixed `/user/` prefix + the applicant's uuid, same-origin path",
  "pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx::memberProfilePath(app.helper_id)": "memberProfilePath(): fixed `/user/` prefix + the applicant's uuid, same-origin path",
  // --- not a navigation: a <link rel="preload" as="image"> the boot script adds to <head> (B96/B100) ---
  "boot/declutterPrefetch.ts::p.href": "firstCardPhotoPreloads(): the build-time VITE_SUPABASE_URL + /storage/v1/render/image/public/<bucket>/ + a stored path without '?' (an image preload, never navigated)",
  "boot/declutterItemPrefetch.ts::p.href": "firstGalleryPhoto(): the build-time VITE_SUPABASE_URL + /storage/v1/render/image/public/<bucket>/ + a stored path matching ^[A-Za-z0-9/_.-]+$ (an image preload, never navigated)",
};

function unclassifiedSinks(files: { rel: string; source: string }[]) {
  const unclassified: string[] = [];
  const seen = new Set<string>();
  for (const { rel, source } of files) {
    for (const expr of navigationSinks(source, rel)) {
      const key = `${rel}::${expr}`;
      seen.add(key);
      if (safeByConstruction(expr) || key in CLASSIFIED) continue;
      unclassified.push(key);
    }
  }
  return { unclassified, seen };
}

function srcFiles() {
  return walk(SRC).map((f) => ({ rel: f.slice(SRC.length + 1), source: readFileSync(f, "utf8") }));
}

describe("every navigation sink in src/ is safe by construction or classified", () => {
  const { unclassified, seen } = unclassifiedSinks(srcFiles());

  it("finds the sinks (the scan is not silently empty)", () => {
    expect(seen.size).toBeGreaterThanOrEqual(40);
  });

  it("no unclassified href / window.open / location / openExternalUrl value", () => {
    expect(unclassified).toEqual([]);
  });

  it("is RED on the shapes that shipped (raw user column in an href)", () => {
    const asShipped = [
      // HelperWorkPhotos (public profile) and JobCardPhotoStrip, before the fix
      `{urls.map((url, i) => (<a key={url} href={url} target="_blank">`,
      // DocumentsTab / DetailHeader, before the fix
      `<a\n  href={viewProfile.avatar_url}\n  target="_blank"\n>`,
      `<a href={row.external_url} target="_blank">`,
      `window.open(path, "_blank", "noopener");`,
      `window.location.href = profile.website;`,
    ];
    for (const s of asShipped) {
      const { unclassified: u } = unclassifiedSinks([{ rel: "fixture.tsx", source: s }]);
      expect(u, s).toHaveLength(1);
    }
    for (const s of [
      `<a href={safeDocumentUrl(url) ?? undefined}>`,
      `<a href={\`/user/\${id}\`}>`,
      `<a href="https://x.example">`,
      `<a href={APP_STORE_URL}>`,
      // a comment mentioning a sink is not a sink
      `// window.location.href = data.url`,
    ]) {
      expect(unclassifiedSinks([{ rel: "fixture.tsx", source: s }]).unclassified, s).toEqual([]);
    }
    // A template literal that lets DATA pick the scheme is not safe.
    expect(safeByConstruction("`${row.url}`")).toBe(false);
    expect(safeByConstruction('"javascript:alert(1)"')).toBe(false);
    expect(safeByConstruction("safeDocumentUrl(url) ?? url")).toBe(false);
    expect(safeByConstruction("openableDocumentUrl(url) ?? url")).toBe(false);
  });

  it("every CLASSIFIED entry still exists (no stale blanket passes)", () => {
    expect(Object.keys(CLASSIFIED).filter((k) => !seen.has(k))).toEqual([]);
  });
});
