/**
 * The entry's one door to a member's first-screen reads: /declutter's (declutterPrefetch.ts), /home's
 * (homePrefetch.ts), /jobs' (jobsPrefetch.ts, B43) an item page's (declutterItemPrefetch.ts, B100) the Posted / Working lists' (activityCoresPrefetch.ts, B100) and the You landing's (profilePrefetch.ts). One chunk and one import in the entry, so the entry every page downloads stays within its budget
 * (two separate imports measured +65 B gz, over the band, B78 11-01). Each start function checks its own route.
 *
 * NOTHING outside the entry may import this file (see guestJobsPrefetch.ts for why).
 */
import { startDeclutterPrefetch } from "./declutterPrefetch";
import { startHomePrefetch } from "./homePrefetch";
import { startJobsPrefetch } from "./jobsPrefetch";
import { startDeclutterItemPrefetch } from "./declutterItemPrefetch";
import { startActivityCoresPrefetch } from "./activityCoresPrefetch";
import { startProfilePrefetch } from "./profilePrefetch";

/**
 * Set once the reads have started. index.html's head starts this chunk for a member with a live session (Builder 2, 11-15,
 * see the script beside <meta name="lh-signed-in-prefetch">), and the entry still calls it too (a guest's item page, a
 * build without the head script): the second call must not ask every read again.
 */
export const SIGNED_IN_PREFETCH_STARTED_KEY = "__lhSignedInPrefetchStarted";

export function startSignedInPrefetch(pathname: string): void {
  const w = window as unknown as Record<string, unknown>;
  if (w[SIGNED_IN_PREFETCH_STARTED_KEY]) return;
  w[SIGNED_IN_PREFETCH_STARTED_KEY] = true;
  startDeclutterPrefetch(pathname);
  startHomePrefetch(pathname);
  startJobsPrefetch(pathname);
  startDeclutterItemPrefetch(pathname);
  startActivityCoresPrefetch(pathname);
  startProfilePrefetch(pathname, location.search);
}
