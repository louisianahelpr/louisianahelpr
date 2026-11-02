import { useState } from "react";

/**
 * A Declutter link this Post a Job was opened from, read ONCE per mount (Q1963).
 *
 * `?declutterOrder=<order>` (Add a Helpr) and `?haulAway=<ids>` (haul-away) arrive
 * pre-filled. Tapping Post in the nav navigates to a bare /post-job, and the route
 * is not keyed, so the same form stays mounted with the link gone from the URL. Read
 * live, that turned the draft gate off (the Add a Helpr form autosaved as a plain
 * draft) and dropped the order id (the job posted and paid with no link to the
 * order, so a seller-fault refund of the order would not cancel or refund it).
 * Decided once here, as useHaulAwayPrefill keeps its item ids in state; PostJob
 * also remounts the form when the link changes (postJobIntentKey).
 */
export interface DeclutterIntent {
  /** The paid order an Add a Helpr post links to, or null. */
  declutterOrderId: string | null;
  /** Never saved as a draft: a draft cannot carry the order or the items. */
  noDraft: boolean;
}

export function readDeclutterIntent(searchParams: URLSearchParams): DeclutterIntent {
  const declutterOrderId = searchParams.get("declutterOrder") || null;
  return { declutterOrderId, noDraft: !!(declutterOrderId || searchParams.get("haulAway")) };
}

export function useDeclutterIntent(searchParams: URLSearchParams): DeclutterIntent {
  const [intent] = useState(() => readDeclutterIntent(searchParams));
  return intent;
}

/** The form's key: a different Declutter link (or none) is a different post. */
export function postJobIntentKey(searchParams: URLSearchParams): string {
  return `${searchParams.get("declutterOrder") ?? ""}|${searchParams.get("haulAway") ?? ""}`;
}
