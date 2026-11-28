/**
 * Every module-level Map/Set that outlives a React tree is classified, and
 * every one holding one account's data that is NOT keyed by the account is
 * cleared by sign-out.
 *
 * Q724: `proofPhotoStorage.ts` kept signed proof-photo URLs (bearer links to
 * another person's photos) in a module Map that survived sign-out, so the next
 * account on the device was handed them from RAM. `queryClient.clear()` never
 * reached it. The inventory is every `new Map()` / `new Set()` constructed
 * empty at module scope in non-test `src/`; the classification below must
 * match it exactly, in both directions.
 *
 * @mutate src/lib/authSignOut.ts | resetProofPhotoSignCache(); | void 0;
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

type Kind =
  | { kind: "cleared-on-sign-out"; reset: string }
  | { kind: "keyed-by-user-id" }
  | { kind: "not-user-data"; why: string };

const CLASSIFIED: Record<string, Kind> = {
  "src/components/payments/EmbeddedCheckoutSheet.tsx:stripeByKey": { kind: "not-user-data", why: "one Stripe.js loader per PUBLIC publishable key (test or live mode, phase W 11-27); the same for every member, holds no session, card or account data" },
  "src/components/ui/stickyActionHeight.ts:heights": { kind: "not-user-data", why: "the painted height of each mounted phone StickyActionBar, by a throwaway key per bar (deep audit 11-22 #13), so a toast clears the tallest; pixel sizes, emptied as each bar unmounts, nothing about the account" },
  "src/components/mobileNav/useShopTalksInBadge.ts:reads": { kind: "keyed-by-user-id" },
  "src/components/mobileNav/useShopTalksInBadge.ts:frontSubs": { kind: "not-user-data", why: "subscriber callbacks for 'the app came back to the front' (shared shop chat badge read, 11-15): a counter of visibility changes, nothing about the account" },
  "src/components/header/desktopTitleSlot.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks for the desktop top bar's title-slot DOM node (page settle, 11-15): which element hosts the title row, nothing about the account" },
  "src/lib/guestIdCheckAnswer.ts:guestIdCheckListeners": { kind: "not-user-data", why: "subscriber callbacks for the guest's answer to the site-wide identity_check switch (Q2788, 11-15): one boolean for every visitor, nothing about an account" },
  "src/components/landing/landingMode.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the landing's Jobs | Declutter choice (F012, 2026-11-10): which tab is picked, nothing about the account" },
  "src/content/giftGuideCatalog.ts:liveSubscribed": { kind: "not-user-data", why: "which public gift-guide data sets the catalog has subscribed to live updates for (guide slugs, 11-23 live guide data); the same for every visitor" },
  "src/lib/liveGuideData.ts:entries": { kind: "not-user-data", why: "the newest validated copy of each public gift-guide data file from www (picks, prices, deals; 11-23 live guide data); the same for every visitor" },
  "src/lib/liveGuideData.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks told when a newer public gift-guide data copy is swapped in (11-23 live guide data); nothing about the signed-in member" },
  "src/content/giftGuideCatalog.ts:drawn": { kind: "not-user-data", why: "each drawn public gift guide's redraw with its current pick chunk, by guide slug, so a newer live dupes copy re-stamps them (11-23 live guide data); the same for every visitor" },
  "src/content/giftGuideCatalog.ts:loaded": { kind: "not-user-data", why: "the public gift-guide pick chunks (static JSON shipped with the app), by guide slug; the same for every visitor" },
  "src/content/giftGuideCatalog.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks that redraw a gift guide when its public pick chunk loads; nothing about the account" },
  "src/content/giftGuideCatalog.ts:sectionWordsMemo": { kind: "not-user-data", why: "a merged gift guide's searchable section titles and keywords, by slug, from the static guide list; the same for every visitor" },
  "src/content/giftGuideCatalog.ts:holdsMemo": { kind: "not-user-data", why: "whether a public gift guide holds any picks, by slug, worked out from the static chunks; the same for every visitor" },
  "src/pages/info/giftGuides/GiftGuideHints.tsx:listeners": { kind: "not-user-data", why: "subscriber callbacks for the heart note shown on screen (owner 2026-11-20 hints): which tip is up, nothing about the account" },
  "src/pages/info/giftGuides/GiftHint.tsx:listeners": { kind: "not-user-data", why: "subscriber callbacks that redraw a how-to tip when it is dismissed (owner 2026-11-20): tip ids, nothing about the account" },
  "src/pages/info/giftGuides/GiftHint.tsx:dismissedNow": { kind: "not-user-data", why: "the how-to tip ids dismissed this visit when storage refuses the write (owner 2026-11-20): per browser, the same for anyone at it" },
  "src/pages/info/giftGuides/saveForPeople.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks that open the one save-for-someone picker on a page when a heart is tapped (owner 2026-11-21); which gift the picker is for, nothing about the account" },
  "src/pages/info/giftGuides/wishListItems.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks that redraw a wish list when the public deals or Small Business file loads; nothing about the account" },
  "src/pages/info/giftGuides/GiftGuidesSidebar.tsx:subs": { kind: "not-user-data", why: "subscriber callbacks that redraw the gift guides menu when its public item counts arrive (owner 2026-11-22, Number on the right): page counts, nothing about the account" },
  "src/pages/info/giftGuides/wishListSync.ts:problemListeners": { kind: "not-user-data", why: "subscriber callbacks for the last sync refusal's words; the list itself is cleared on sign-out by useWishListSync (security review #2)" },
  "src/lib/giftPlannerDevice.ts:resets": { kind: "not-user-data", why: "the gift planner store's in-memory reset callbacks (security review of #4791); clearPlannerDevice, called by sign-out, runs them so the planner itself is cleared" },
  "src/pages/info/giftGuides/fun/plannerStore.ts:viewer": { kind: "not-user-data", why: "who is looking at the gift planner (an account id or signed out), set from the auth state on every render of the planner page; a copy owned by anyone else is never shown, and sign-out clears the copy itself (clearPlannerDevice)" },
  "src/pages/info/giftGuides/fun/santaIdeas.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks that redraw a Secret Santa reveal's device-only gift ideas when one is saved (owner 11-20); the ideas are per browser (localStorage, by group code), saved only when signed out, never read from or tied to an account" },
  "src/pages/info/giftGuides/giftList.tsx:listeners": { kind: "not-user-data", why: "subscriber callbacks that redraw the gift guides' hearts when the browser-only My list changes (owner 11-18); the list is per browser (localStorage), never read from or tied to an account" },
  "src/pages/info/giftGuides/fun/santaWishStore.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks that redraw a Secret Santa participant's own wish list (owner 11-21); the list is per browser (localStorage, by group code and first name), never read from or tied to an account" },
  "src/pages/info/giftGuides/fun/santaWishStore.ts:empties": { kind: "not-user-data", why: "one empty list object per group and first name for the visit, so the id a Secret Santa page shows is the id saved; holds no gift and nothing from an account" },
  "src/pages/info/giftGuides/wishLinkSync.ts:sending": { kind: "not-user-data", why: "ids of gifts whose link request is in flight right now (so a list never sends one twice); random device ids, emptied as each request settles, nothing from an account" },
  "src/lib/notFoundPath.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the pathname the 404 catch-all is showing (L8, iOS audit 2026-11-16): which URL is a 404, nothing about the account" },
  "src/lib/guestTopBar.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks for 'is the guest top bar drawn' (F047, 2026-11-09): a yes or no about layout, nothing about the account" },
  "src/components/declutter/firstRowPhotoGate.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the per-page 'first row of photos is in' gate (B77, 2026-11-01); a yes or no about loading, nothing about the account" },
  "src/components/profile/earningsTab/useEarningsData.ts:lastReported": { kind: "not-user-data", why: "the last payout-read warning sent per read name (error text + time, B77 2026-11-01), so one failure is reported once a minute; holds no rows, amounts or ids" },
  "src/components/sections/useSectionPrefs.ts:pulled": { kind: "not-user-data", why: "which account ids already read their Customize row this app run (Q2199), so each account reads its own once; holds no choice or other data" },
  "src/components/declutter/useLinkedOrder.ts:noticed": { kind: "not-user-data", why: "the raw order-link values already warned about once (audit 11-10), so a bad link logs one warning; holds no account data" },
  "src/lib/proofPhotoStorage.ts:signed": { kind: "cleared-on-sign-out", reset: "resetProofPhotoSignCache" },
  "src/lib/declutter/itemViewsSent.ts:sent": { kind: "cleared-on-sign-out", reset: "resetSentItemViews" },
  "src/lib/activityCoreContinueDays.ts:kept": { kind: "cleared-on-sign-out", reset: "resetActiveContinueDays" },
  "src/lib/helprTasks/onlineHandoff.ts:answers": { kind: "cleared-on-sign-out", reset: "resetOnlineHandoff" },
  "src/lib/helprTasks/onlineHandoff.ts:done": { kind: "cleared-on-sign-out", reset: "resetOnlineHandoff" },
  "src/lib/helprTasks/onlineHandoff.ts:expected": { kind: "cleared-on-sign-out", reset: "resetOnlineHandoff" },
  "src/lib/helprTasks/onlineHandoff.ts:waiters": { kind: "cleared-on-sign-out", reset: "resetOnlineHandoff" },
  "src/lib/proofPhotoStorage.ts:inFlight": { kind: "cleared-on-sign-out", reset: "resetProofPhotoSignCache" },
  "src/lib/proofPhotoStorage.ts:pending": { kind: "cleared-on-sign-out", reset: "resetProofPhotoSignCache" },
  "src/lib/pinnedConversations.ts:cache": { kind: "keyed-by-user-id" },
  // Owner 11-14 new-member Home: the old "What brings you to Helpr?" picks, cached per account id (the raw value is in
  // safeStorage under helpr_first_run_picks_<userId>); read only since the picker went (owner 11-24, C11).
  "src/components/tour/startPicks.ts:cache": { kind: "keyed-by-user-id" },
  "src/pages/home/homeDashboard/useNeedsYouTodos.ts:deriveListeners": { kind: "not-user-data", why: "subscriber callbacks told once when Home's derivation code chunk is in (B51, 2026-11-03); a yes or no about loading code, nothing about the account" },
  "src/hooks/useCloseOnBack.ts:closers": { kind: "not-user-data", why: "close callbacks of the sheets open right now (flow audit 11-23 B4); emptied when they close, nothing about the account" },
  "src/hooks/usePageReadsSettled.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the one per-launch page-reads latch; a yes or no about timing, nothing about the account" },
  "src/components/job-card/faceActionRequest.ts:pending": { kind: "not-user-data", why: "a one-shot tap request (job id + 'confirm') that expires after 10 s and is cleared when JobConfirmation draws; nothing to leak to the next account" },
  "src/components/job-card/photoCaptureRequest.ts:pending":{ kind: "not-user-data", why: "a one-shot tap request (job id + before/after) that expires after 10 s and is cleared when its photo control draws; holds no photo and nothing to leak to the next account" },
  "src/components/job-card/helperStepRequest.ts:pending": { kind: "not-user-data",why: "a one-shot tap request (job id + step name) that expires after 10 s and is cleared the first time the tracker draws; nothing to leak to the next account" },
  "src/lib/pinnedConversations.ts:loadGen": { kind: "keyed-by-user-id" },
  "src/components/header/PageTitleBar.tsx:stackListeners": { kind: "not-user-data", why: "subscriber callbacks for which mounted title bar is first (overlay rows go under the desktop bar, 2026-10-28); mount ids only, no account data" },
  "src/lib/payoutAfterHireSwitch.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the payout_after_hire switch answer (owner 2026-10-25); IdentityCheckMount republishes the answer for whoever is signed in (signed out reads off)" },
  "src/lib/identityCheckSwitch.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the identity_check switch answer; IdentityCheckMount republishes the answer for whoever is signed in (signed out reads off)" },
  "src/lib/identityCheckSwitch.ts:answerListeners": { kind: "not-user-data", why: "subscriber callbacks of the identity_check switch's last real answer (F360b money figures); IdentityCheckMount republishes it for whoever is signed in (null signed out)" },
  "src/lib/declutter/stripeReturn.ts:seen": { kind: "not-user-data", why: "keys of Stripe returns this tab already counted (paid:<order id> or back:<30 s bucket>) so a re-render does not count one twice; holds no member data and only ever suppresses a duplicate funnel step" },
  "src/lib/declutter/reviewPrompt.ts:marked": { kind: "not-user-data", why: "order ids this device just tapped I got it on, each forgotten after 2 minutes; it only opens the review sheet on that order's own card, which another account cannot open (UX-7, b73)" },
  "src/lib/connectivity.ts:subscribers": { kind: "not-user-data", why: "subscriber callbacks of the one confirmed online/offline answer (owner 10-31); the network's state, nothing about the account" },
  "src/lib/i18n/language.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the language choice (English or Spanish, per device, helpr_lang); the choice is a device setting, nothing about the account" },
  "src/lib/identityCheck.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the one Identity sheet's open/closed state (IdentityCheckHost); the state is a reason string, nothing about the account" },
  "src/components/mobileNav/useSectionTabs.ts:shownComingSoon": { kind: "not-user-data", why: "toast ids of the 'X is coming soon' notices shown (one per switched-off section label), dismissed and cleared on the next route change; section names, nothing about the account" },
  "src/lib/archivedConversations.ts:cache": { kind: "keyed-by-user-id" },
  "src/lib/clearedConversations.ts:clearCache": { kind: "keyed-by-user-id" },
  "src/lib/userBlocks.ts:blockReads": { kind: "keyed-by-user-id" },
  "src/lib/userRealtimeBus.ts:buses": { kind: "keyed-by-user-id" },
  "src/hooks/useCurrentUser.ts:orphanedProfileReads": { kind: "keyed-by-user-id" },
  "src/lib/needsYouStore.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks (the counts carry their account id; a reader for another id gets zero)" },
  "src/components/mobileNav/navUnreadStore.ts:stores": { kind: "keyed-by-user-id" },
  "src/components/mobileNav/navUnreadStore.ts:watchers": { kind: "not-user-data", why: "re-render callbacks of the read-only unread readers (the phone top bar's Messages button, nav redesign 2026-11-06); holds no count or id" },
  "src/components/sections/createFabHidden.tsx:listeners": { kind: "not-user-data", why: "re-render callbacks of the floating create pill's hidden state (an empty state shows its own create, owner 11-08); a count of mounted empty states, nothing about the account" },
  "src/components/mobileNav/createSheetStore.ts:listeners": { kind: "not-user-data", why: "re-render callbacks of the Create sheet's open state (the top bar's + opens the sheet MobileNav mounts, nav redesign 2026-11-06); a yes or no, nothing about the account" },
  "src/components/job-card/useCardExpansion.ts:NONE_OPEN": { kind: "not-user-data", why: "an empty ReadonlySet, the default 'no card open' value; nothing writes to it" },
  "src/components/sections/useSectionPrefs.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/components/sections/useSectionPrefs.ts:cache": { kind: "keyed-by-user-id" },
  "src/components/notificationPanel/notificationFeed.ts:feeds": { kind: "keyed-by-user-id" },
  "src/components/notificationPanel/notificationFeed.ts:arrivalListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/components/notificationPanel/notificationFeed.ts:recoveryListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/integrations/supabase/keychainStorageAdapter.ts:cache": { kind: "not-user-data", why: "mirror of the native Keychain session, which sign-out removes itself (removeItem)" },
  "src/components/ScrollToTop.tsx:scrollPositions": { kind: "not-user-data", why: "scroll offsets by route" },
  "src/lib/visibleDeadline.ts:onShown": { kind: "not-user-data", why: "resume callbacks of pending read deadlines" },
  "src/pages/profile/useProfileLandingScroller.ts:profileScrollByKey": { kind: "not-user-data", why: "scroll offsets by tab" },
  "src/components/admin/AdminHelperTiers.tsx:reportedUnknownTiers": { kind: "not-user-data", why: "report-once dedupe of tier names" },
  "src/components/admin/adminBadgeStore.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/components/notificationPanel/notificationStore.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/hooks/usePermissionRationale.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/hooks/useMapKitJs.ts:reportedTokenFailures": { kind: "not-user-data", why: "report-once dedupe" },
  "src/hooks/useMapKitJs.ts:tokenSourceListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/hooks/useMapKitJs.ts:statusListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/hooks/useAuthReady.ts:authListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/hooks/useDrivingTime.ts:cache": { kind: "not-user-data", why: "drive minutes between ~110m-rounded points" },
  "src/hooks/useDashboardData.ts:NO_IDS": { kind: "not-user-data", why: "frozen empty constant (never mutated; stable fallback for the exclusion sets)" },
  "src/hooks/useDashboardFilters.ts:EMPTY_ID_SET": { kind: "not-user-data", why: "frozen empty constant" },
  "src/pages/home/viewerFeedExclusions.ts:EMPTY_SET": { kind: "not-user-data", why: "frozen empty constant" },
  "src/lib/errorLogger.ts:bgFailureReportedInMemory": { kind: "not-user-data", why: "report-once dedupe" },
  "src/lib/errorLogger.ts:bgFailureSends": { kind: "not-user-data", why: "report rate limit" },
  "src/lib/jobCompletedEvent.ts:emitted": { kind: "not-user-data", why: "analytics emit-once job ids" },
  "src/lib/chunkReload.ts:failedAssetUrls": { kind: "not-user-data", why: "same-origin /assets chunk paths that failed to load this page" },
  "src/lib/loadModule.ts:waiters": { kind: "not-user-data", why: "pending untilReload() callbacks for this page, failed when a recovery reload is called off" },
  "src/lib/routePrefetchTable.ts:warmed": { kind: "not-user-data", why: "route chunk names" },
  "src/hooks/useHelprTakesTips.ts:cache": { kind: "not-user-data", why: "per-Helpr yes/no on whether payouts are ready (public fact behind the tip button), 60 s; no personal data (audit F29)" },
  "src/lib/jobRealtimeBus.ts:buses": { kind: "not-user-data", why: "ref-counted realtime channels per job id; each entry is removed when its last subscriber leaves (audit F1)" },
  "src/lib/realtimeHealth.ts:downChannels": { kind: "not-user-data", why: "channel health" },
  "src/lib/realtimeHealth.ts:healthListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/lib/realtimeRecovery.ts:pendingWakes": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/lib/safeStorage.ts:TRACKED_KEYS": { kind: "not-user-data", why: "storage key names" },
  "src/lib/storagePath.ts:openableBlobUrls": { kind: "not-user-data", why: "content-addressed: a hit needs the exact data: URL, so it returns nothing the caller does not already hold" },
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const abs = join(dir, f);
    if (statSync(abs).isDirectory()) return f === "test" ? [] : files(abs);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [abs] : [];
  });
}

const DECL = /^(?:export )?(?:const|let) (\w+)(?:: [^=]+)? = new (?:Map|Set)(?:<.*>)?\(\);/gm;

function inventory(): string[] {
  return files(SRC).flatMap((abs) => {
    const rel = relative(ROOT, abs);
    return [...readFileSync(abs, "utf8").matchAll(DECL)].map((m) => `${rel}:${m[1]}`);
  });
}

describe("module-level caches vs sign-out (Q724)", () => {
  const found = inventory();

  it("finds the module caches (inventory is not empty)", () => {
    expect(found).toContain("src/lib/proofPhotoStorage.ts:signed");
  });

  it("every module Map/Set is classified, and nothing classified is gone", () => {
    expect(found.filter((k) => !(k in CLASSIFIED)), "unclassified: add it to CLASSIFIED").toEqual([]);
    expect(Object.keys(CLASSIFIED).filter((k) => !found.includes(k)), "stale: remove from CLASSIFIED").toEqual([]);
  });

  const signOut = readFileSync(join(SRC, "lib/authSignOut.ts"), "utf8");
  const cleared = Object.entries(CLASSIFIED).filter(([, v]) => v.kind === "cleared-on-sign-out");
  it.each(cleared)("%s is cleared by signOutWithPushCleanup", (key, v) => {
    const reset = (v as { reset: string }).reset;
    const file = key.split(":")[0];
    expect(readFileSync(join(ROOT, file), "utf8")).toMatch(new RegExp(`export function ${reset}\\(`));
    const body = signOut.slice(signOut.indexOf("export async function signOutWithPushCleanup"));
    expect(body.slice(0, body.indexOf("\n}\n")), `${reset}() not called on sign-out`).toMatch(new RegExp(`\\b${reset}\\(\\)`));
  });

  const keyed = Object.entries(CLASSIFIED).filter(([, v]) => v.kind === "keyed-by-user-id").map(([k]) => k);
  it.each(keyed)("%s is read and written by user id", (key) => {
    const [file, name] = key.split(":");
    const src = readFileSync(join(ROOT, file), "utf8");
    const uses = [...src.matchAll(new RegExp(`\\b${name}\\.(?:get|set)\\(([^,)]+)`, "g"))].map((m) => m[1].trim());
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((a) => !/^(?:user\.id|userId|currentUserId|uid)$/.test(a))).toEqual([]);
  });
});
