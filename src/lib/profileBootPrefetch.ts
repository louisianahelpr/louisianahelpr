/**
 * The hand-over from the entry's You landing reads (src/boot/profilePrefetch.ts). The entry must never import this file.
 *
 * Each read takes its part ONCE (a refetch must reach the server), only while the answer is fresh, only for the member
 * it was asked as, and only when it is shaped as expected. Anything else is null, and that read asks Supabase as it
 * always did. Guard: src/boot/profilePrefetch.test.ts.
 */
import { FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";

/** Same string as PROFILE_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhProfilePrefetch";
/** An answer older than this is not handed out: the page asks afresh. */
export const PROFILE_PREFETCH_MAX_AGE_MS = 30_000;

type Slot = {
  at: number;
  userId: string;
  keys: string;
  switches: Promise<unknown>;
  open: Promise<unknown>;
  page: Promise<{ handle: string; data: unknown } | null>;
  taken?: Set<string>;
};

const slot = (): Slot | undefined => (window as unknown as Record<string, Slot | undefined>)[KEY];

function fresh(now: number): Slot | null {
  const s = slot();
  return s && now - s.at <= PROFILE_PREFETCH_MAX_AGE_MS ? s : null;
}

/** Marks `part` taken; false when it already was. */
function claim(s: Slot, part: string): boolean {
  s.taken ??= new Set();
  if (s.taken.has(part)) return false;
  s.taken.add(part);
  return true;
}

/** feature_switches_for_me's answer, when it was asked as `userId` with exactly the app's switch keys. */
export async function takeProfileSwitches(userId: string | null, now: number = Date.now()): Promise<Record<string, unknown> | null> {
  const s = fresh(now);
  if (!userId || !s || s.userId !== userId || s.keys !== FEATURE_SWITCH_KEYS.join(",") || !claim(s, "switches")) return null;
  const a = await s.switches;
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : null;
}

/** features_open_to_everyone's answer (the same for every visitor). */
export async function takeProfileSectionsOpen(now: number = Date.now()): Promise<string[] | null> {
  const s = fresh(now);
  if (!s || !claim(s, "open")) return null;
  const a = await s.open;
  return Array.isArray(a) && a.every((k) => typeof k === "string") ? (a as string[]) : null;
}

/**
 * public_profile_by_handle's raw answer for `handle` (`data` may be null: no page to show), or null when the entry has
 * none for this handle. Waits before claiming, so a read for another handle (a /u page) never uses it up.
 */
export async function takeProfilePage(handle: string, now: number = Date.now()): Promise<{ data: unknown } | null> {
  const s = fresh(now);
  if (!s || s.taken?.has("page")) return null;
  const a = await s.page;
  if (!a || a.handle !== handle || !claim(s, "page")) return null;
  return { data: a.data };
}
