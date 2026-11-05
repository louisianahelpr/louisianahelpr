/**
 * The entry's one door to a member's first-screen reads: /declutter's (declutterPrefetch.ts), /home's
 * (homePrefetch.ts), /jobs' (jobsPrefetch.ts, B43) an item page's (declutterItemPrefetch.ts, B100) and the Posted / Working lists' (activityCoresPrefetch.ts, B100). One chunk and one import in the entry, so the entry every page downloads stays within its budget
 * (two separate imports measured +65 B gz, over the band, B78 11-01). Each start function checks its own route.
 *
 * NOTHING outside the entry may import this file (see guestJobsPrefetch.ts for why). Loading it starts the reads (the
 * last line), so the entry carries no `.then` for it (Q1158: that put the entry over its 5 KB band).
 */
import { startDeclutterPrefetch } from "./declutterPrefetch";
import { startHomePrefetch } from "./homePrefetch";
import { startJobsPrefetch } from "./jobsPrefetch";
import { startDeclutterItemPrefetch } from "./declutterItemPrefetch";
import { startActivityCoresPrefetch } from "./activityCoresPrefetch";

export function startSignedInPrefetch(pathname: string): void {
  startDeclutterPrefetch(pathname);
  startHomePrefetch(pathname);
  startJobsPrefetch(pathname);
  startDeclutterItemPrefetch(pathname);
  startActivityCoresPrefetch(pathname);
}

startSignedInPrefetch(window.location.pathname);
