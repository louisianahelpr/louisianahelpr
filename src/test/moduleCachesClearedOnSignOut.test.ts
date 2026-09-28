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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
  "src/lib/pinnedConversations.ts:loadGen": { kind: "keyed-by-user-id" },
  "src/lib/archivedConversations.ts:cache": { kind: "keyed-by-user-id" },
  "src/lib/userBlocks.ts:blockReads": { kind: "keyed-by-user-id" },
  "src/lib/userRealtimeBus.ts:buses": { kind: "keyed-by-user-id" },
  "src/hooks/useCurrentUser.ts:orphanedProfileReads": { kind: "keyed-by-user-id" },
  "src/hooks/useActivityBadgeCounts.ts:stores": { kind: "keyed-by-user-id" },
  "src/components/mobileNav/useNavUnreadCount.ts:stores": { kind: "keyed-by-user-id" },
  "src/components/notificationPanel/notificationFeed.ts:feeds": { kind: "keyed-by-user-id" },
  "src/components/notificationPanel/notificationFeed.ts:arrivalListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/components/notificationPanel/notificationFeed.ts:recoveryListeners": { kind: "not-user-data", why: "subscriber callbacks" },
  "src/integrations/supabase/preferencesStorageAdapter.ts:cache": { kind: "not-user-data", why: "mirror of native Preferences, which sign-out clears itself" },
  "src/components/ScrollToTop.tsx:scrollPositions": { kind: "not-user-data", why: "scroll offsets by route" },
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
  "src/hooks/useDashboardFilters.ts:EMPTY_ID_SET": { kind: "not-user-data", why: "frozen empty constant" },
  "src/pages/home/viewerFeedExclusions.ts:EMPTY_SET": { kind: "not-user-data", why: "frozen empty constant" },
  "src/lib/errorLogger.ts:bgFailureReportedInMemory": { kind: "not-user-data", why: "report-once dedupe" },
  "src/lib/errorLogger.ts:bgFailureSends": { kind: "not-user-data", why: "report rate limit" },
  "src/lib/jobCompletedEvent.ts:emitted": { kind: "not-user-data", why: "analytics emit-once job ids" },
  "src/lib/chunkReload.ts:failedAssetUrls": { kind: "not-user-data", why: "same-origin /assets chunk paths that failed to load this page" },
  "src/lib/pushPermissionNudge.ts:inFlight": { kind: "not-user-data", why: "nudge reasons in flight" },
  "src/lib/routePrefetch.ts:warmed": { kind: "not-user-data", why: "route chunk names" },
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
