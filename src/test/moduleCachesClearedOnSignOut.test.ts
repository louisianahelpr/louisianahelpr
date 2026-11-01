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
  "src/lib/proofPhotoStorage.ts:signed": { kind: "cleared-on-sign-out", reset: "resetProofPhotoSignCache" },
  "src/lib/proofPhotoStorage.ts:inFlight": { kind: "cleared-on-sign-out", reset: "resetProofPhotoSignCache" },
  "src/lib/proofPhotoStorage.ts:pending": { kind: "cleared-on-sign-out", reset: "resetProofPhotoSignCache" },
  "src/lib/pinnedConversations.ts:cache": { kind: "keyed-by-user-id" },
  "src/hooks/usePageReadsSettled.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the one per-launch page-reads latch; a yes or no about timing, nothing about the account" },
  "src/components/job-card/faceActionRequest.ts:pending": { kind: "not-user-data", why: "a one-shot tap request (job id + 'confirm') that expires after 10 s and is cleared when JobConfirmation draws; nothing to leak to the next account" },
  "src/components/job-card/photoCaptureRequest.ts:pending":{ kind: "not-user-data", why: "a one-shot tap request (job id + before/after) that expires after 10 s and is cleared when its photo control draws; holds no photo and nothing to leak to the next account" },
  "src/components/job-card/helperStepRequest.ts:pending": { kind: "not-user-data",why: "a one-shot tap request (job id + step name) that expires after 10 s and is cleared the first time the tracker draws; nothing to leak to the next account" },
  "src/lib/pinnedConversations.ts:loadGen": { kind: "keyed-by-user-id" },
  "src/components/header/PageTitleBar.tsx:listeners": { kind: "not-user-data", why: "subscriber callbacks for the desktop top bar's title slot (a DOM element portal target); no account data" },
  "src/components/header/PageTitleBar.tsx:stackListeners": { kind: "not-user-data", why: "subscriber callbacks for which mounted title bar is first (overlay rows go under the desktop bar, 2026-10-28); mount ids only, no account data" },
  "src/lib/payoutAfterHireSwitch.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the payout_after_hire switch answer (owner 2026-10-25); IdentityCheckHost republishes the answer for whoever is signed in (signed out reads off)" },
  "src/lib/identityCheckSwitch.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the identity_check switch answer; IdentityCheckHost republishes the answer for whoever is signed in (signed out reads off)" },
  "src/lib/declutter/reviewPrompt.ts:marked": { kind: "not-user-data", why: "order ids this device just tapped I got it on, each forgotten after 2 minutes; it only opens the review sheet on that order's own card, which another account cannot open (UX-7, b73)" },
  "src/lib/connectivity.ts:subscribers": { kind: "not-user-data", why: "subscriber callbacks of the one confirmed online/offline answer (owner 10-31); the network's state, nothing about the account" },
  "src/lib/i18n/language.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the language choice (English or Spanish, per device, helpr_lang); the choice is a device setting, nothing about the account" },
  "src/lib/identityCheck.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks of the one Identity sheet's open/closed state (IdentityCheckHost); the state is a reason string, nothing about the account" },
  "src/components/mobileNav/useSectionTabs.ts:shownComingSoon": { kind: "not-user-data", why: "toast ids of the 'X is coming soon' notices shown (one per switched-off section label), dismissed and cleared on the next route change; section names, nothing about the account" },
  "src/lib/archivedConversations.ts:cache": { kind: "keyed-by-user-id" },
  "src/lib/userBlocks.ts:blockReads": { kind: "keyed-by-user-id" },
  "src/lib/userRealtimeBus.ts:buses": { kind: "keyed-by-user-id" },
  "src/hooks/useCurrentUser.ts:orphanedProfileReads": { kind: "keyed-by-user-id" },
  "src/lib/needsYouStore.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks (the counts carry their account id; a reader for another id gets zero)" },
  "src/components/mobileNav/useNavUnreadCount.ts:stores": { kind: "keyed-by-user-id" },
  "src/components/job-card/useCardExpansion.ts:NONE_OPEN": { kind: "not-user-data", why: "an empty ReadonlySet, the default 'no card open' value; nothing writes to it" },
  "src/components/sections/useSectionPrefs.ts:listeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/components/sections/useSectionPrefs.ts:cache": { kind: "keyed-by-user-id" },
  "src/components/notificationPanel/notificationFeed.ts:feeds": { kind: "keyed-by-user-id" },
  "src/components/notificationPanel/notificationFeed.ts:arrivalListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/components/notificationPanel/notificationFeed.ts:recoveryListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/integrations/supabase/keychainStorageAdapter.ts:cache": { kind: "not-user-data", why: "mirror of the native Keychain session, which sign-out removes itself (removeItem)" },
  "src/components/ScrollToTop.tsx:scrollPositions": { kind: "not-user-data", why: "scroll offsets by route" },
  "src/lib/visibleDeadline.ts:onShown": { kind: "not-user-data", why: "resume callbacks of pending read deadlines" },
  "src/pages/profile/Profile.tsx:profileScrollByKey": { kind: "not-user-data", why: "scroll offsets by tab" },
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
  "src/lib/pushPermissionNudge.ts:inFlight": { kind: "not-user-data", why: "nudge reasons in flight" },
  "src/lib/routePrefetch.ts:warmed": { kind: "not-user-data", why: "route chunk names" },
  "src/hooks/useHelprTakesTips.ts:cache": { kind: "not-user-data", why: "per-Helpr yes/no on whether payouts are ready (public fact behind the tip button), 60 s; no personal data (audit F29)" },
  "src/lib/jobRealtimeBus.ts:buses": { kind: "not-user-data", why: "ref-counted realtime channels per job id; each entry is removed when its last subscriber leaves (audit F1)" },
  "src/lib/realtimeRecovery.ts:downChannels": { kind: "not-user-data", why: "channel health" },
  "src/lib/realtimeRecovery.ts:healthListeners": { kind: "not-user-data", why: "subscriber callbacks" },
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
