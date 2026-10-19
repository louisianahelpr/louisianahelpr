import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { useFeature } from "@/hooks/useFeature";

// Its own chunk: the quotes readers stay off My Jobs and Posts while the switch is off.
const JobListQuotes = lazy(() => import("@/components/quotes/JobListQuotes").then((m) => ({ default: m.JobListQuotes })));

/** My Jobs / Posts: the member's quotes (JobListQuotes), only while the hidden 'quotes' switch is on. */
export function JobListQuotesSlot({ tab, className }: { tab: "posted" | "applied"; className?: string }) {
  const quotesOn = useFeature("quotes");
  const [params] = useSearchParams();
  if (!quotesOn) return null;
  return (
    <Suspense fallback={null}>
      <JobListQuotes tab={tab} focus={params.get("quotes") === "1"} className={className} />
    </Suspense>
  );
}
