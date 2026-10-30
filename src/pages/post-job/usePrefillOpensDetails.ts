import { useEffect, useRef } from "react";
import { SELL_FOR_ME_PARAM } from "@/lib/declutter/sellForMe";
import { MATCHMAKER_PARAM } from "@/lib/matchmakerLink";

/**
 * The deep links whose pre-fill already picks the job's category. They open Post a job at Details (4 of 7), never
 * at the category groups (2 of 7) with nothing chosen on screen (audit 3, A3-3, 2026-10-28: "Put it together"
 * opened "What do you need done?" while the preview already read "Assembly · Put together Oak side table").
 * `declutterOrder`: Declutter "Add a Helpr" (useJobFormEffects' declutterSetupPrefill sets the category).
 * `sellForMe`: Declutter "Sell it for me" -> Hire a local Helpr (deep audit #34: it opened the same empty "2 of 7";
 * buildSellForMePrefill sets Declutter help).
 */
// `mm`: a matchmaker link from Admin -> Growth links (B59) sets the category from the link.
export const PREFILL_OPENS_DETAILS = ["declutterOrder", SELL_FOR_ME_PARAM, MATCHMAKER_PARAM] as const;

/** Is this Post a job link one whose pre-fill picks the category (usePostJobForm hands FormStep the answer)? */
export function prefillOpensDetails(searchParams: URLSearchParams): boolean {
  return PREFILL_OPENS_DETAILS.some((k) => !!searchParams.get(k));
}

/**
 * Once, when such a link's category lands while the form shows its first page, go on as a category tap does
 * (FormStep's onPicked): not while the open-job cap or the age gate stops the flow at screen 1. Once only, so
 * Back from Details still reaches the category's group and the groups, and stays there.
 */
export function usePrefillOpensDetails({ deepLink, category, onFirstPage, blocked, goOn }: {
  deepLink: boolean;
  category: string;
  onFirstPage: boolean;
  blocked: boolean;
  goOn: () => void;
}): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !deepLink || !category || blocked) return;
    done.current = true;
    if (onFirstPage) goOn();
  }, [deepLink, category, blocked, onFirstPage, goOn]);
}
