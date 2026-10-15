/**
 * The back-and-forth on one quote, and the answer controls for whichever side
 * has the turn (owner Q6): accept the price on the table, decline it, or
 * counter with a new whole-dollar price and an optional note. Used by the
 * poster (QuoteRequestPage) and by the quoter (MyQuoteCard): the server
 * decides whose turn it is (respond_to_job_quote refuses 'not_your_turn').
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_QUOTE_DOLLARS,
  MIN_QUOTE_DOLLARS,
  dollars,
  respondToQuote,
  type QuoteAnswer,
  type QuoteOffer,
} from "@/lib/quotes/api";
import { quoteErrorMessage } from "@/lib/quotes/errors";

export function OfferThread({ offers, mySide }: { offers: QuoteOffer[]; mySide: "quoter" | "poster" }) {
  if (offers.length <= 1) return null;
  return (
    <ol className="mt-3 space-y-1.5 border-l-2 border-border pl-3" aria-label="Offers so far">
      {offers.map((o, i) => (
        <li key={`${o.at}-${i}`} className="text-sm">
          <span className="font-medium text-foreground">
            {o.by === mySide ? "You" : mySide === "poster" ? "They" : "The poster"}: {dollars(o.price_cents)}
          </span>
          {o.note ? <span className="text-muted-foreground"> · {o.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** A whole-dollar price from what was typed, or null when it is not one. */
export function parseWholeDollars(raw: string): number | null {
  const t = raw.replace(/[$,\s]/g, "");
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= MIN_QUOTE_DOLLARS && n <= MAX_QUOTE_DOLLARS ? n : null;
}

export function QuoteAnswerControls({
  quoteId,
  priceCents,
  acceptLabel,
  invalidate,
}: {
  quoteId: string;
  priceCents: number;
  acceptLabel: string;
  /** React Query keys to refresh after an answer. */
  invalidate: readonly (readonly unknown[])[];
}) {
  const qc = useQueryClient();
  const [countering, setCountering] = useState(false);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const counterDollars = parseWholeDollars(price);

  const answer = useMutation({
    mutationFn: (action: QuoteAnswer) =>
      respondToQuote({
        quoteId,
        action,
        priceDollars: action === "counter" ? (counterDollars ?? undefined) : undefined,
        note: action === "counter" ? note : undefined,
      }),
    onSuccess: (out) => {
      toast.success(
        out === "accepted" ? "Quote accepted" : out === "declined" ? "Quote declined" : "Counter-offer sent",
      );
      setCountering(false);
      setPrice("");
      setNote("");
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });

  if (countering) {
    return (
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (counterDollars != null) answer.mutate("counter");
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={`counter-price-${quoteId}`}>Your price (whole dollars)</Label>
          <Input
            id={`counter-price-${quoteId}`}
            inputMode="numeric"
            autoComplete="off"
            placeholder={String(Math.round(priceCents / 100))}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-describedby={`counter-help-${quoteId}`}
          />
          <p id={`counter-help-${quoteId}`} className="text-xs text-muted-foreground">
            From ${MIN_QUOTE_DOLLARS} to ${MAX_QUOTE_DOLLARS.toLocaleString("en-US")}. They have 48 hours to answer.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`counter-note-${quoteId}`}>Note (optional)</Label>
          <Textarea
            id={`counter-note-${quoteId}`}
            maxLength={500}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={counterDollars == null || answer.isPending}>
            Send counter-offer
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setCountering(false)} disabled={answer.isPending}>
            Back
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={answer.isPending} onClick={() => answer.mutate("accept")}>
        {acceptLabel}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={answer.isPending} onClick={() => setCountering(true)}>
        Counter
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={answer.isPending} onClick={() => answer.mutate("decline")}>
        Decline
      </Button>
    </div>
  );
}
