/**
 * /quotes/request/:id: the poster's quotes on one request (owner Q5, Q6, Q8).
 * Cheapest first. For each quote: the price on the table, the note, when the
 * quoter can do it, up to 4 past-work photos, and the back-and-forth; accept,
 * decline or counter when it is the poster's turn. Once a quote is accepted,
 * "Book and pay" turns it into a job (book_accepted_quote) and opens the ONE
 * escrow checkout (src/lib/escrowCheckout.ts, create-payment). While the
 * request is open the poster can instead set their own price (the job is
 * posted to everyone and paid the same way) or cancel the request.
 *
 * Money (lh-money-escrow review, 2026-10-15):
 *  - The buttons name no amount. create-payment can add the one-time setup fee
 *    and Louisiana sales tax on top of the job price, so a "$250" button would
 *    under-state the charge; Stripe Checkout shows the real total.
 *  - A job that exists but is not paid yet (checkout cancelled, refused or cut
 *    off) can always be paid from here, for an agreed quote AND for a request
 *    switched to the poster's own price (status 'closed'): unpaid jobs are
 *    hidden from Activity and Posts, so this screen is the only way back.
 */
import { useState } from "react";
import { formatName } from "@/lib/utils";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  bookAcceptedQuote,
  cancelQuoteRequest,
  dollars,
  fetchBookedJobPayment,
  fetchMyQuoteRequests,
  fetchQuotesForRequest,
  offersOf,
  quotePhotoUrl,
  switchToSetPrice,
  type BookedJobPayment,
  type MyQuoteRequest,
  type RequestQuote,
} from "@/lib/quotes/api";
import { quoteErrorMessage } from "@/lib/quotes/errors";
import { openEscrowCheckout } from "@/lib/escrowCheckout";
import { useFeature } from "@/hooks/useFeature";
import { buildFeeQuote, type JobFeeQuote } from "@/lib/jobCheckout";

/**
 * The fee model these screens pay under (owner 2026-10-18, behind
 * jobs_poster_fee). They show no total ("Checkout shows your total before you
 * pay"), so the quote carries the model only; create-payment refuses a
 * mismatch instead of charging a model this build does not know.
 */
function useQuoteFeeQuote(): JobFeeQuote {
  const posterFeeOn = useFeature("jobs_poster_fee");
  return buildFeeQuote({ switchOn: posterFeeOn });
}
import { QuotesSideBySide } from "@/components/quotes/QuotesSideBySide";
import { QUOTE_STATUS_LABEL, QuotesGate, QuotesNotice, REQUEST_STATUS_LABEL, dayLabel, timeLeft } from "@/components/quotes/quotesUi";
import { QUOTE_HOMES } from "@/lib/quotes/homes";
import { OfferThread, QuoteAnswerControls, parseWholeDollars } from "@/components/quotes/QuoteAnswerControls";

const TITLE = "Quotes for your job";

function QuoteCard({ quote, requestOpen, requestId }: { quote: RequestQuote; requestOpen: boolean; requestId: string }) {
  const pending = quote.status === "pending";
  const myTurn = requestOpen && pending && quote.last_offer_side === "quoter";
  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {quote.quoter_avatar_url ? (
            <img src={quote.quoter_avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
          ) : (
            <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-muted" />
          )}
          <p className="min-w-0 font-semibold text-foreground break-words">{formatName(quote.quoter_name, "A member")}</p>
        </div>
        <p className="shrink-0 text-lg font-semibold tabular-nums text-foreground">{dollars(quote.price_cents)}</p>
      </div>
      <p className="mt-2 text-sm text-foreground break-words">{quote.note}</p>
      <p className="mt-1 text-sm text-muted-foreground break-words">Can do it: {quote.available_note}</p>
      {quote.photo_paths.length > 0 && (
        <ul className="mt-3 grid grid-cols-4 gap-2" aria-label="Past work photos">
          {quote.photo_paths.map((p) => (
            <li key={p}>
              <img src={quotePhotoUrl(p)} alt="Past work" loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {myTurn
          ? `Your turn to answer${timeLeft(quote.respond_until) ? ` · ${timeLeft(quote.respond_until)}` : ""}`
          : pending
            ? "Waiting for their answer to your counter-offer"
            : (QUOTE_STATUS_LABEL[quote.status] ?? "Closed")}
      </p>
      <OfferThread offers={offersOf(quote.offers)} mySide="poster" />
      {myTurn && (
        <QuoteAnswerControls
          quoteId={quote.id}
          priceCents={quote.price_cents}
          acceptLabel={`Accept ${dollars(quote.price_cents)}`}
          invalidate={[["quotes", "request", requestId], ["quotes", "my-requests"]]}
        />
      )}
    </li>
  );
}

/** Q1862: a cancelled quote checkout comes back to its request page, not an empty Post a Job. */
const requestReturnPath = (requestId: string) => `/quotes/request/${requestId}`;

function SetMyOwnPrice({ request }: { request: MyQuoteRequest }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const budget = parseWholeDollars(price);
  const feeQuote = useQuoteFeeQuote();
  const go = useMutation({
    mutationFn: async () => {
      const jobId = await switchToSetPrice(request.id, budget ?? 0);
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      await openEscrowCheckout(jobId, { feeQuote, returnPath: requestReturnPath(request.id) });
    },
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });
  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        Set my own price instead
      </Button>
    );
  }
  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (budget != null) go.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Every quote closes and your job is posted at your price, open to everyone. You pay now and the money is held until the job is done. Checkout shows your total before you pay.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="own-price">Your price (whole dollars)</Label>
        <Input id="own-price" inputMode="numeric" autoComplete="off" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={go.isPending}>
          Back
        </Button>
        <Button type="submit" disabled={budget == null || go.isPending}>
          Post and pay
        </Button>
      </div>
    </form>
  );
}

/** Q1874: only a job whose money is held or paid out reads "paid". */
function bookedNoticeTitle(p: Exclude<BookedJobPayment, "not_paid">, ownPrice: boolean): string {
  if (p === "paid") return ownPrice ? "Posted and paid" : "Booked and paid";
  if (p === "refunded") return "Refunded";
  if (p === "cancelled") return "Cancelled";
  if (p === "cancelling") return "Being cancelled";
  if (p === "disputed") return "Payment disputed";
  return ownPrice ? "Posted" : "Booked";
}

const BOOKED_NOTICE_BODY: Partial<Record<BookedJobPayment, string>> = {
  refunded: "This job's payment was refunded.",
  cancelled: "This job was cancelled.",
  cancelling: "This job is being cancelled.",
  disputed: "This job's payment is being disputed with the card's bank.",
};

function RequestView({ id }: { id: string }) {
  const qc = useQueryClient();
  const reqs = useQuery({ queryKey: ["quotes", "my-requests"], queryFn: fetchMyQuoteRequests });
  const quotes = useQuery({ queryKey: ["quotes", "request", id], queryFn: () => fetchQuotesForRequest(id) });
  const request = reqs.data?.find((r) => r.id === id);
  // A job made from this request: from an agreed quote, or posted at the
  // poster's own price (closed). Either can be left unpaid by a checkout that
  // did not finish.
  const bookedJobId = request && (request.status === "agreed" || request.status === "closed") ? request.job_id : null;
  const paid = useQuery({
    queryKey: ["quotes", "booked-payment", bookedJobId],
    enabled: !!bookedJobId,
    queryFn: () => fetchBookedJobPayment(bookedJobId as string),
  });
  const feeQuote = useQuoteFeeQuote();

  const book = useMutation({
    mutationFn: async () => {
      const jobId = await bookAcceptedQuote(id);
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      await openEscrowCheckout(jobId, { feeQuote, returnPath: requestReturnPath(id) });
    },
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });
  const payJob = useMutation({
    mutationFn: () => openEscrowCheckout(bookedJobId as string, { feeQuote, returnPath: requestReturnPath(id) }),
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: () => cancelQuoteRequest(id),
    onSuccess: () => {
      toast("Request cancelled");
      void qc.invalidateQueries({ queryKey: ["quotes"] });
    },
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });

  if (reqs.isPending) return <p className="text-sm text-muted-foreground">Loading quotes…</p>;
  if (reqs.isError) {
    return <ErrorState variant="inline" title="We couldn't load this request." onRetry={() => { void reqs.refetch(); void quotes.refetch(); }} />;
  }
  // The list loaded and this id is not in it (deleted, someone else's, or a mistyped link): that is a
  // missing request, not a hiccup, and "Try again" could never fix it (nightly-red #2375). Decided
  // BEFORE the quotes read, because get_quotes_for_request raises unknown_request for such an id.
  if (!request) {
    return (
      <QuotesNotice title="We can't find this quote request.">
        <p>It may have been cancelled, or the link is not yours. Your requests are under Jobs · Posted.</p>
      </QuotesNotice>
    );
  }
  if (quotes.isPending) return <p className="text-sm text-muted-foreground">Loading quotes…</p>;
  if (quotes.isError) {
    return <ErrorState variant="inline" title="We couldn't load this request." onRetry={() => { void quotes.refetch(); }} />;
  }
  const open = request.status === "open";
  const agreed = request.status === "agreed";
  const ownPrice = request.status === "closed";
  const accepted = quotes.data.find((q) => q.status === "accepted");

  return (
    <div className="space-y-4 pb-safe-nav">
      <div>
        <p className="font-semibold text-foreground break-words">{request.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {REQUEST_STATUS_LABEL[request.status] ?? "Closed"} · Needed {dayLabel(request.date_needed)}
          {open && timeLeft(request.quotes_close_at) ? ` · ${timeLeft(request.quotes_close_at)}` : ""}
        </p>
      </div>
      {agreed && accepted && !request.job_id && (
        <QuotesNotice title={`You agreed on ${dollars(accepted.price_cents)} with ${formatName(accepted.quoter_name, "this member")}`}>
          <p>Pay now to book it. The money is held until the job is done. Checkout shows your total before you pay.</p>
          <Button type="button" className="mt-3 w-full" disabled={book.isPending} onClick={() => book.mutate()}>
            Book and pay
          </Button>
        </QuotesNotice>
      )}
      {bookedJobId && paid.data === "not_paid" && (
        <QuotesNotice title="Not paid yet">
          <p>
            {ownPrice ? "Pay to post your job." : "Pay to book it."} The money is held until the job is
            done. Checkout shows your total before you pay.
          </p>
          <Button type="button" className="mt-3 w-full" disabled={payJob.isPending} onClick={() => payJob.mutate()}>
            Pay now
          </Button>
        </QuotesNotice>
      )}
      {bookedJobId && paid.isError && (
        <ErrorState variant="inline" title="We couldn't check whether this job is paid." onRetry={() => void paid.refetch()} />
      )}
      {bookedJobId && paid.data && paid.data !== "not_paid" && (
        <QuotesNotice title={bookedNoticeTitle(paid.data, ownPrice)}>
          {BOOKED_NOTICE_BODY[paid.data] ? <p>{BOOKED_NOTICE_BODY[paid.data]}</p> : null}
          <Link to={`/jobs/${bookedJobId}`} className="font-medium text-foreground underline underline-offset-2">
            Open the job
          </Link>
        </QuotesNotice>
      )}
      {quotes.data.length === 0 ? (
        <QuotesNotice title={open ? "No quotes yet" : "No quotes"}>
          {open ? "Helprs near you can send their price until the window closes. We'll let you know when one arrives." : null}
        </QuotesNotice>
      ) : (
        <>
        {/* Board 115: two or more live quotes, side by side, before the cards you act on. */}
        <QuotesSideBySide quotes={quotes.data} />
        <ul className="space-y-3" aria-label="Quotes, lowest price first">
          {quotes.data.map((q) => (
            <QuoteCard key={q.id} quote={q} requestOpen={open} requestId={id} />
          ))}
        </ul>
        </>
      )}
      {open && <SetMyOwnPrice request={request} />}
      {/* An agreed request whose job was never paid can still be cancelled: cancel_quote_request
          (20261018155222) allows it and deletes the unpaid job; a live checkout is refused there
          with its own words (Q2158, sentry review on PR #3173). */}
      {(open || (agreed && (!request.job_id || paid.data === "not_paid"))) && (
        <Button type="button" variant="ghost" className="w-full text-muted-foreground" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          Cancel this request
        </Button>
      )}
    </div>
  );
}

export default function QuoteRequestPage() {
  const { id = "" } = useParams<{ id: string }>();
  return (
    <QuotesGate title={TITLE} backTo={QUOTE_HOMES.myRequests} label="Loading the request">
      {/* wrapTitle: "Quotes for your job" was cut to "Quotes for you..." at 375 (AUD31-64). */}
      <AppPage title={TITLE} backTo={QUOTE_HOMES.myRequests} wrapTitle>
        <RequestView id={id} />
      </AppPage>
    </QuotesGate>
  );
}
