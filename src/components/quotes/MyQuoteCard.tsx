/**
 * One quote this member sent (the "Your quotes" view on /quotes): the price on
 * the table, whose turn it is, the counter-offers, and the answer controls
 * when the poster has countered. A pending quote can be withdrawn.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { dollars, offersOf, withdrawJobQuote, type MyJobQuote } from "@/lib/quotes/api";
import { quoteErrorMessage } from "@/lib/quotes/errors";
import { QUOTE_STATUS_LABEL, dayLabel, timeLeft } from "./quotesUi";
import { OfferThread, QuoteAnswerControls } from "./QuoteAnswerControls";

const MINE_KEY = ["quotes", "mine"] as const;

export function MyQuoteCard({ quote }: { quote: MyJobQuote }) {
  const qc = useQueryClient();
  const pending = quote.status === "pending";
  const theirTurn = pending && quote.last_offer_side === "quoter";
  const myTurn = pending && quote.last_offer_side === "poster";
  const withdraw = useMutation({
    mutationFn: () => withdrawJobQuote(quote.id),
    onSuccess: () => {
      toast.success("Quote withdrawn");
      void qc.invalidateQueries({ queryKey: MINE_KEY });
    },
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });

  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-semibold text-foreground break-words">{quote.title}</p>
        <p className="shrink-0 font-semibold tabular-nums text-foreground">{dollars(quote.price_cents)}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {myTurn
          ? "The poster sent a counter-offer"
          : theirTurn
            ? "Waiting for the poster"
            : (QUOTE_STATUS_LABEL[quote.status] ?? "Closed")}
        {pending && timeLeft(quote.respond_until) ? ` · ${timeLeft(quote.respond_until)}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Needed {dayLabel(quote.date_needed)}
        {quote.parish ? ` · ${quote.parish}` : ""}
      </p>
      <OfferThread offers={offersOf(quote.offers)} mySide="quoter" />
      {quote.status === "accepted" && (
        <p className="mt-3 text-sm text-foreground">
          {quote.job_id ? (
            <>
              The poster booked it.{" "}
              <Link to={`/jobs/${quote.job_id}`} className="font-medium underline underline-offset-2">
                Open the job
              </Link>
            </>
          ) : (
            "Accepted. It is booked once the poster pays."
          )}
        </p>
      )}
      {myTurn && (
        <QuoteAnswerControls
          quoteId={quote.id}
          priceCents={quote.price_cents}
          acceptLabel={`Accept ${dollars(quote.price_cents)}`}
          invalidate={[MINE_KEY]}
        />
      )}
      {pending && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-2 px-0 text-muted-foreground"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate()}
        >
          Withdraw my quote
        </Button>
      )}
    </li>
  );
}
