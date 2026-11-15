/**
 * The door to the entry's You landing reads (src/boot/profilePrefetch.ts -> src/lib/profileBootPrefetch.ts), for the
 * readers every page boots with (useFeature, useSectionsOpen, profileLink/api). Same names and answers as the
 * hand-over module's.
 *
 * Why a door (lead 11-14, the perf2 train's critical-path budget): imported statically by useFeature, the hand-over
 * module (and the switch-key list it compares against) rode in the boot graph of every route, and /home, /admin and
 * the Declutter item page each went 1 KB gz over their budgets for reads only a cold You landing ever hands out. Now
 * the hand-over loads only when the entry left one (the window slot exists only after a cold /profile landing), and
 * src/boot/profileRoute.ts starts it beside the page on that load, so the landing waits no extra round. Everywhere
 * else each take is one property read: no slot, nothing loads, null. Guard: src/boot/profilePrefetch.test.ts.
 */
import { loadModule } from "@/lib/loadModule";

/** Same string as PROFILE_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhProfilePrefetch";

const handOver = () => loadModule(() => import("@/lib/profileBootPrefetch"));
type HandOver = typeof import("@/lib/profileBootPrefetch");

/** `take`'s answer when the entry asked on this load; null otherwise, without loading anything. */
async function fromBoot<T>(take: (m: HandOver) => Promise<T | null>): Promise<T | null> {
  if (typeof window === "undefined" || !(window as unknown as Record<string, unknown>)[KEY]) return null;
  const mod = await handOver().catch(() => {
    // A hand-over that did not load is no answer: the caller reads Supabase as it always did, so nothing is lost.
    return null;
  });
  return mod ? take(mod) : null;
}

/** profileBootPrefetch's takeProfileSwitches, loaded only when the entry asked. */
export const takeProfileSwitches = (userId: string | null): Promise<Record<string, unknown> | null> => fromBoot((m) => m.takeProfileSwitches(userId));
/** profileBootPrefetch's takeProfileSectionsOpen, loaded only when the entry asked. */
export const takeProfileSectionsOpen = (): Promise<string[] | null> => fromBoot((m) => m.takeProfileSectionsOpen());
/** profileBootPrefetch's takeProfilePage, loaded only when the entry asked. */
export const takeProfilePage = (handle: string): Promise<{ data: unknown } | null> => fromBoot((m) => m.takeProfilePage(handle));
