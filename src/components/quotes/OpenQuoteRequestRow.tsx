/**
 * One open quote request, as a member who may quote on it sees it: title,
 * description, when, the masked place, the time left, and Send a quote (or
 * "You sent a quote"). Shared by /quotes "Open requests" and the "Wants Quotes"
 * filter on the Jobs browse feed (owner answer 12, 2026-10-17), so the two
 * places show one card.
 */
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { OpenQuoteRequest } from "@/lib/quotes/api";
import { dayLabel, timeLeft } from "@/components/quotes/quotesUi";

export function OpenQuoteRequestRow({ r }: { r: OpenQuoteRequest }) {
  const quoted = !!r.my_quote_id;
  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <p className="font-semibold text-foreground break-words">{r.title}</p>
      <p className="mt-1 text-sm text-muted-foreground line-clamp-3 break-words">{r.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Needed {dayLabel(r.date_needed)}
        {r.location ? ` · ${r.location}` : r.parish ? ` · ${r.parish}` : ""}
        {timeLeft(r.quotes_close_at) ? ` · ${timeLeft(r.quotes_close_at)}` : ""}
      </p>
      <div className="mt-3">
        {quoted ? (
          <p className="text-sm font-medium text-foreground">You sent a quote. See it under Your quotes.</p>
        ) : (
          <Button asChild size="sm">
            <Link to={`/quotes/send/${r.id}`}>Send a quote</Link>
          </Button>
        )}
      </div>
    </li>
  );
}
