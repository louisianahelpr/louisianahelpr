/**
 * Did Jobs Browse draw its category chips row last time (design audit A J1 chips, 11-08)? The row only shows when the
 * feed has two or more category groups, so the loading skeleton draws its chips bone only when the last loaded Browse
 * drew the row: the list then lands where the bones were, either way, instead of moving ~44 px when the chips arrive
 * (or when a bone the feed never fills disappears). A per-device convenience; storage failing means "no bone".
 * Guard: src/test/jobsSkeletonChipsBone.test.tsx.
 */
const KEY = "lh-jobs-chips-row";

export function jobChipsRowSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Storage blocked (private mode, a thumbnail capture): draw no bone, the pre-change behaviour.
    return false;
  }
}

export function noteJobChipsRow(shown: boolean): void {
  try {
    if (shown) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the next skeleton simply draws no bone.
  }
}
