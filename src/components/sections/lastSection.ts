import { safeStorage } from "@/lib/safeStorage";
import type { SectionKey } from "./sectionsConfig";

const LAST_KEY = "helpr_explore_last";
/** A signed-out visitor's key: one per device (audit 11-21, P8). */
const GUEST = "guest";

/**
 * The section Explore reopens on: per member ("<key>:<userId>", never one global key), or per device for a guest.
 *
 * Audit 11-21 (P8): this was only ever written by ExploreSwitcher, which nothing mounts any more, so /explore never
 * remembered anything, and a guest's read always answered null. Every section screen's top bar writes it now
 * (AppTopBar's `section`). Guard: src/test/jobsAudit1121Mediums.test.tsx.
 */
export function readLastSection(userId: string | undefined): SectionKey | null {
  try {
    return (safeStorage.getItem(`${LAST_KEY}:${userId ?? GUEST}`) as SectionKey | null) ?? null;
  } catch {
    return null; // storage blocked: Explore opens on the first section
  }
}

export function writeLastSection(userId: string | undefined, key: SectionKey) {
  try {
    safeStorage.setItem(`${LAST_KEY}:${userId ?? GUEST}`, key);
  } catch {
    /* best-effort: Explore reopens on the first section instead */
  }
}
