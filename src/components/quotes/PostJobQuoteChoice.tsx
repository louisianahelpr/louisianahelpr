/**
 * Post a Job, chosen at the top of the form (owner Q1, Q4; moved to the top
 * as pills 2026-10-19): "Set a price" (today's flow: a budget, then Review &
 * Pay) or "Get quotes" (no price; Helprs near you send
 * theirs for 24 hours, 48 hours or 3 days, 48 hours by default). Shown only
 * while the hidden 'quotes' switch is on for the member, and only for a
 * one-time job with no direct offer (a series, a crew job or an offer to one
 * Helpr keep today's flow).
 *
 * Get quotes has its own Review (A2-C32): "Ask for quotes" there sends the same details, address and schedule the form
 * holds to create_quote_request; nothing is charged. The poster pays later,
 * when they book a quote, through the one escrow checkout.
 */
import { raceVisibleDeadline } from "@/lib/visibleDeadline";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CircleDollarSign } from "lucide-react";
import { SectionCard } from "@/components/postjob/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useQueryClient } from "@tanstack/react-query";
import { composeJobAddress, geocodeAddress } from "@/lib/geocode";
import { composeLocationString } from "@/pages/post-job/postJobFormHelpers";
import { report } from "@/lib/errorLogger";
import {
  QUOTE_WINDOWS,
  createQuoteRequest,
  type QuoteWindowHours,
} from "@/lib/quotes/api";
import { quoteErrorMessage } from "@/lib/quotes/errors";

export type PriceMode = "price" | "quotes";

/** What happens next, one line per choice (owner 2026-10-19: say it under the pills). */
const PRICE_MODE_NEXT: Record<PriceMode, string> = {
  price: "You set the budget and review it before anything is charged. Helprs apply at your price.",
  quotes: "No price yet. Helprs near you send theirs; you pick one and pay only when you book.",
};

/** What a member without the 'quotes' switch is told on tapping Get quotes (owner 2026-10-19). */
const QUOTES_COMING_SOON = "Getting quotes from local pros is coming soon. For now, set your price.";

/**
 * The top of Post a Job (owner 2026-10-19: quotes live inside Post a Job):
 * "Set a price" or "Get quotes", as the app's pill choice (SegmentedControl:
 * olive gloss on the picked pill), with one line on what happens next.
 *
 * `quotesComingSoon` (everyone without the 'quotes' switch): "Get quotes" is
 * greyed with a small "Coming soon" under it, and a tap only says so, in the
 * line under the pills (a toast.info would be silenced by src/lib/toastPolicy.ts);
 * the choice never moves off "Set a price".
 */
export function PriceModeChoice({
  value,
  onChange,
  quotesComingSoon = false,
}: {
  value: PriceMode;
  onChange: (v: PriceMode) => void;
  quotesComingSoon?: boolean;
}) {
  const [soonTapped, setSoonTapped] = useState(false);
  return (
    <div data-price-mode-choice>
      <p className="mb-2 text-sm font-semibold text-foreground">
        How do you want to price it?
      </p>
      <SegmentedControl
        ariaLabel="How to price this job"
        value={value}
        onChange={(v) => {
          if (v === "quotes" && quotesComingSoon) {
            setSoonTapped(true);
            return;
          }
          onChange(v as PriceMode);
        }}
        options={[
          { value: "price", label: "Set a price" },
          quotesComingSoon
            ? {
                value: "quotes",
                ariaLabel: "Get quotes, coming soon",
                label: (
                  <span className="flex flex-col items-center leading-tight text-muted-foreground/60" data-quotes-coming-soon>
                    <span>Get quotes</span>
                    <span className="text-ds-10 font-medium">Coming soon</span>
                  </span>
                ),
              }
            : { value: "quotes", label: "Get quotes" },
        ]}
      />
      <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
        {quotesComingSoon && soonTapped ? QUOTES_COMING_SOON : PRICE_MODE_NEXT[value]}
      </p>
    </div>
  );
}

function QuoteWindowSection({
  stepNumber,
  windowHours,
  onWindowChange,
}: {
  stepNumber: number;
  windowHours: QuoteWindowHours;
  onWindowChange: (h: QuoteWindowHours) => void;
}) {
  return (
    <SectionCard stepNumber={stepNumber} title="Quotes" icon={CircleDollarSign} complete>
      <p className="text-sm text-muted-foreground">
        Each quote comes with a note and when they can do it. You can pick one, counter, or set your own price instead.
      </p>
      <p className="mt-4 text-sm font-medium text-foreground" id="quote-window-label">
        Take quotes for
      </p>
      <div className="mt-2" aria-labelledby="quote-window-label">
        <SegmentedControl
          ariaLabel="Take quotes for"
          value={String(windowHours)}
          onChange={(v) => onWindowChange(Number(v) as QuoteWindowHours)}
          options={QUOTE_WINDOWS.map((w) => ({ value: String(w.value), label: w.label }))}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Quotes close earlier if the job starts sooner.</p>
    </SectionCard>
  );
}

/** The fields of the Post a Job form a quote request uses. */
interface QuoteRequestFormFields {
  title: string;
  description: string;
  category: string;
  streetAddress: string;
  city: string;
  addrState: string;
  zipCode: string;
  dateNeeded: string;
  startTime: string;
  isFlexibleSchedule: boolean;
  estimatedHours: string;
  parish: string | null;
}

/** Sends the quote request from Review (A2-C32: Get quotes has a Review screen too, then "Ask for quotes"). */
export function useAskForQuotes(windowHours: QuoteWindowHours) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);

  async function ask(f: QuoteRequestFormFields) {
    if (sending) return;
    setSending(true);
    try {
      const location = composeLocationString(f);
      // Best effort and capped like Post a Job's: a request without a map
      // point still takes quotes.
      // 2.5 s of VISIBLE time (raceVisibleDeadline): a backgrounded app does
      // not burn the wait; past it the request goes without a map point.
      let coords: { latitude: number; longitude: number } | null = null;
      try {
        coords = await raceVisibleDeadline(
          geocodeAddress(composeJobAddress({ streetAddress: f.streetAddress, city: f.city, state: f.addrState, zipCode: f.zipCode })),
          2500,
          "geocode_timeout",
        );
      } catch (geoErr) {
        report(geoErr, { severity: "warning", tags: { source: "quotes.askForQuotes.geocode" } });
      }
      const hours = f.estimatedHours ? Number.parseFloat(f.estimatedHours) : NaN;
      const id = await createQuoteRequest({
        title: f.title.trim(),
        description: f.description.trim(),
        category: f.category,
        dateNeeded: f.dateNeeded,
        startTime: f.isFlexibleSchedule ? null : f.startTime || null,
        estimatedHours: Number.isFinite(hours) && hours > 0 ? hours : null,
        location,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        parish: f.parish,
        windowHours,
      });
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      toast("Your request is up", { description: "We'll let you know when quotes come in." });
      navigate(`/quotes/request/${id}`);
    } catch (err) {
      toast.error(quoteErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return { sending, ask };
}

/**
 * The quote window section, mounted only while "Get quotes" is picked. The window lives in the form
 * (usePostJobForm) so Review reads it; the ask goes out from Review (useAskForQuotes).
 */
export function QuoteRequestSection({ stepNumber, windowHours, onWindowChange }: { stepNumber: number; windowHours: QuoteWindowHours; onWindowChange: (h: QuoteWindowHours) => void }) {
  return <QuoteWindowSection stepNumber={stepNumber} windowHours={windowHours} onWindowChange={onWindowChange} />;
}
