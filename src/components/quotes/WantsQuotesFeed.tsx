/**
 * The Jobs browse feed with the "Wants Quotes" filter on (owner answer 12,
 * 2026-10-17: quote requests show up BOTH in Jobs browse and under a Quotes
 * link in the menu). Quote requests are not jobs yet, so they come from their
 * own reader, list_open_quote_requests (the poster's address masked, the
 * caller's own quote status only, never another quoter's price), not from
 * open_jobs_browse. Shown only while the hidden 'quotes' switch is on: the
 * Dashboard offers the filter only then.
 */
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchOpenQuoteRequests } from "@/lib/quotes/api";
import { QuotesNotice } from "@/components/quotes/quotesUi";
import { OpenQuoteRequestRow } from "@/components/quotes/OpenQuoteRequestRow";

export function WantsQuotesFeed({ onShowAllJobs }: { onShowAllJobs: () => void }) {
  const q = useQuery({ queryKey: ["quotes", "open"], queryFn: fetchOpenQuoteRequests });
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-safe-nav" data-wants-quotes-feed>
      <div className="flex items-center gap-2 mb-3">
        <p className="flex-1 min-w-0 text-sm text-muted-foreground">
          People near you want a price for these jobs. Send yours.
        </p>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onShowAllJobs}>
          Show all jobs
        </Button>
      </div>
      {q.isPending ? (
        <p className="text-sm text-muted-foreground">Loading open requests…</p>
      ) : q.isError ? (
        <ErrorState variant="inline" onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <QuotesNotice title="No open requests right now">
          When someone near you asks for quotes on a job, it shows up here.
        </QuotesNotice>
      ) : (
        <ul className="space-y-3" aria-label="Jobs that want quotes">
          {q.data.map((r) => (
            <OpenQuoteRequestRow key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
