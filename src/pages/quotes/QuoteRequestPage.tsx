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
  fetchBookedJobPaid,
  fetchMyQuoteRequests,
  fetchQuotesForRequest,
  offersOf,
  quotePhotoUrl,
  switchToSetPrice,
  type MyQuoteRequest,
  type RequestQuote,
} from "@/lib/quotes/api";
import { quoteErrorMessage } from "@/lib/quotes/errors";
import { openEscrowCheckout } from "@/lib/escrowCheckout";
import { QUOTE_STATUS_LABEL, QuotesGate, QuotesNotice, REQUEST_STATUS_LABEL, dayLabel, timeLeft } from "@/components/quotes/quotesUi";
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
          <p className="min-w-0 font-semibold text-foreground break-words">{quote.quoter_name || "A member"}</p>
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

function SetMyOwnPrice({ request }: { request: MyQuoteRequest }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const budget = parseWholeDollars(price);
  const go = useMutation({
    mutationFn: async () => {
      const jobId = await switchToSetPrice(request.id, budget ?? 0);
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      await openEscrowCheckout(jobId);
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
        <Button type="submit" disabled={budget == null || go.isPending}>
          Post and pay
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={go.isPending}>
          Back
        </Button>
      </div>
    </form>
  );
}

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
    queryKey: ["quotes", "booked-paid", bookedJobId],
    enabled: !!bookedJobId,
    queryFn: () => fetchBookedJobPaid(bookedJobId as string),
  });

  const book = useMutation({
    mutationFn: async () => {
      const jobId = await bookAcceptedQuote(id);
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      await openEscrowCheckout(jobId);
    },
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });
  const payJob = useMutation({
    mutationFn: () => openEscrowCheckout(bookedJobId as string),
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: () => cancelQuoteRequest(id),
    onSuccess: () => {
      toast.success("Request cancelled");
      void qc.invalidateQueries({ queryKey: ["quotes"] });
    },
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });

  if (reqs.isPending || quotes.isPending) return <p className="text-sm text-muted-foreground">Loading quotes…</p>;
  if (reqs.isError || quotes.isError || !request) {
    return <ErrorState variant="inline" title="We couldn't load this request." onRetry={() => { void reqs.refetch(); void quotes.refetch(); }} />;
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
        <QuotesNotice title={`You agreed on ${dollars(accepted.price_cents)} with ${accepted.quoter_name || "this member"}`}>
          <p>Pay now to book it. The money is held until the job is done. Checkout shows your total before you pay.</p>
          <Button type="button" className="mt-3 w-full" disabled={book.isPending} onClick={() => book.mutate()}>
            Book and pay
          </Button>
        </QuotesNotice>
      )}
      {bookedJobId && paid.data === false && (
        <QuotesNotice title="Not paid yet">
          <p>
            {ownPrice ? "Finish paying to post your job." : "Finish paying to book it."} The money is held until the job is
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
      {bookedJobId && paid.data === true && (
        <QuotesNotice title={ownPrice ? "Posted and paid" : "Booked and paid"}>
          <Link to={`/jobs/${bookedJobId}`} className="font-medium text-foreground underline underline-offset-2">
            Open the job
          </Link>
        </QuotesNotice>
      )}
      {quotes.data.length === 0 ? (
        <QuotesNotice title={open ? "No quotes yet" : "No quotes"}>
          {open ? "Members near you can send their price until the window closes. We'll let you know when one arrives." : null}
        </QuotesNotice>
      ) : (
        <ul className="space-y-3" aria-label="Quotes, lowest price first">
          {quotes.data.map((q) => (
            <QuoteCard key={q.id} quote={q} requestOpen={open} requestId={id} />
          ))}
        </ul>
      )}
      {open && <SetMyOwnPrice request={request} />}
      {(open || (agreed && !request.job_id)) && (
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
    <QuotesGate title={TITLE} backTo="/quotes" label="Loading the request">
      <AppPage title={TITLE} backTo="/quotes">
        <RequestView id={id} />
      </AppPage>
    </QuotesGate>
  );
}
