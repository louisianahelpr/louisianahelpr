import { safeStorage } from "@/lib/safeStorage";

/**
 * Jobs → Browse's desktop map column: shown or hidden, remembered per device. Default ON, like Declutter's
 * Browse ("helpr.declutterMapVisible"): the split view, list left and map right, is the desktop layout.
 *
 * Owner 2026-10-30: "Declutter opens with the map showing. Make Jobs do the same thing." Jobs already defaulted
 * to ON, but under the old key "helpr.browseMapVisible", and a device that once hid the map (the owner asked for a
 * way to hide it) kept a "0" there, so Jobs opened list-only while Declutter opened split. The new key starts every
 * device on the map once; the toggle still remembers the choice from then on. The old key is never read.
 * Guard: src/lib/jobsMapVisible.test.ts.
 */
export const JOBS_MAP_KEY = "helpr.jobsMapVisible";

export function readJobsMapVisible(): boolean {
  return safeStorage.getItem(JOBS_MAP_KEY) !== "0";
}

export function saveJobsMapVisible(visible: boolean): void {
  safeStorage.setItem(JOBS_MAP_KEY, visible ? "1" : "0");
}
