import { useCallback, useState } from "react";
import { useFeature } from "@/hooks/useFeature";

/**
 * "Wants Quotes" (owner answer 12, 2026-10-17): a lens like "Only saved",
 * offered only while the hidden 'quotes' switch is on. Quote requests are not
 * jobs yet, so it swaps the feed for their own list (WantsQuotesFeed) rather
 * than narrowing the job read; the map column steps aside while it is on.
 *
 * Lives here, not in Dashboard.tsx, to keep that god component from growing
 * (scripts/component-size-baseline.json is exact).
 *
 * @mutate src/pages/home/useWantsQuotes.ts |   const wantsQuotes = quotesOn && wantsQuotesPicked; |   const wantsQuotes = wantsQuotesPicked;
 */
export function useWantsQuotes() {
  const quotesOn = useFeature("quotes");
  const [wantsQuotesPicked, setWantsQuotesPicked] = useState(false);
  const wantsQuotes = quotesOn && wantsQuotesPicked;
  const toggleWantsQuotes = useCallback(() => setWantsQuotesPicked((v) => !v), []);
  const showAllJobs = useCallback(() => setWantsQuotesPicked(false), []);
  return { quotesOn, wantsQuotes, toggleWantsQuotes, showAllJobs };
}
