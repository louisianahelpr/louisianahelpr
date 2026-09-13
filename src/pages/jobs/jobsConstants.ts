import { categoryLabels } from "@/components/activity/activityConstants";

/**
 * The job-category keys, as one list. The public browse page that also lived
 * off this file (PAGE_SIZE, CARDS_PER_ROW, MAX_STAGGER_CARDS, toEnrichedJob,
 * noop, DEBUG_AUTH) was refactored away and took every other reader with it,
 * so this is the whole file now.
 */
export const ALL_CATEGORIES = Object.keys(categoryLabels);
