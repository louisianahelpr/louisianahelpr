/**
 * The entry's one door to a member's first-screen reads: /declutter's (declutterPrefetch.ts) and /home's
 * (homePrefetch.ts). One chunk and one import in the entry, so the entry every page downloads stays within its budget
 * (two separate imports measured +65 B gz, over the band, B78 11-01). Each start function checks its own route.
 *
 * NOTHING outside the entry may import this file (see guestJobsPrefetch.ts for why).
 */
import { startDeclutterPrefetch } from "./declutterPrefetch";
import { startHomePrefetch } from "./homePrefetch";

export function startSignedInPrefetch(pathname: string): void {
  startDeclutterPrefetch(pathname);
  startHomePrefetch(pathname);
}
