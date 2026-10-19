import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useFeature } from "@/hooks/useFeature";

/**
 * "Wants Quotes" (owner answer 12, 2026-10-17): a lens like "Only saved",
 * offered only while the hidden 'quotes' switch is on. Quote requests are not
 * jobs yet, so it swaps the feed for their own list (WantsQuotesFeed) rather
 * than narrowing the job read; the map column steps aside while it is on.
 * Since the /quotes hub retired (owner 2026-10-19) this feed is where open
 * requests live, so a link can open Jobs with the lens on: ?wantsQuotes=1
 * (QUOTE_HOMES.openRequests, src/lib/quotes/homes.ts).
 *
 * Lives here, not in Dashboard.tsx, to keep that god component from growing
 * (scripts/component-size-baseline.json is exact). The switch-gate line below
 * is mutation-registered in src/components/quotes/wantsQuotesFilter.test.tsx.
 */
export function useWantsQuotes() {
  const quotesOn = useFeature("quotes");
  const [params] = useSearchParams();
  const [wantsQuotesPicked, setWantsQuotesPicked] = useState(() => params.get("wantsQuotes") === "1");
  const wantsQuotes = quotesOn && wantsQuotesPicked;
  const toggleWantsQuotes = useCallback(() => setWantsQuotesPicked((v) => !v), []);
  const showAllJobs = useCallback(() => setWantsQuotesPicked(false), []);
  return { quotesOn, wantsQuotes, toggleWantsQuotes, showAllJobs };
}
