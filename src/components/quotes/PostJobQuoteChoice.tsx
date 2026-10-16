/**
 * Post a Job, section 3 (owner Q1, Q4): "Set my price" (today's flow: a
 * budget, then Review & Pay) or "Get quotes" (no price; members near you send
 * theirs for 24 hours, 48 hours or 3 days, 48 hours by default). Shown only
 * while the hidden 'quotes' switch is on for the member, and only for a
 * one-time job with no direct offer (a series, a crew job or an offer to one
 * Helpr keep today's flow).
 *
 * "Ask for quotes" sends the same details, address and schedule the form
 * holds to create_quote_request; nothing is charged. The poster pays later,
 * when they book a quote, through the one escrow checkout.
 */
import { raceVisibleDeadline } from "@/lib/visibleDeadline";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CircleDollarSign } from "lucide-react";
import { SectionCard } from "@/components/postjob/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useQueryClient } from "@tanstack/react-query";
import { composeJobAddress, geocodeAddress } from "@/lib/geocode";
import { report } from "@/lib/errorLogger";
import {
  DEFAULT_QUOTE_WINDOW,
  QUOTE_WINDOWS,
  createQuoteRequest,
  type QuoteWindowHours,
} from "@/lib/quotes/api";
import { quoteErrorMessage } from "@/lib/quotes/errors";

export type PriceMode = "price" | "quotes";

export function PriceModeChoice({ value, onChange }: { value: PriceMode; onChange: (v: PriceMode) => void }) {
  return (
    <SegmentedControl
      ariaLabel="How to price this job"
      value={value}
      onChange={(v) => onChange(v as PriceMode)}
      options={[
        { value: "price", label: "Set my price" },
        { value: "quotes", label: "Get quotes" },
      ]}
    />
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
        Members near you send their price, a note and when they can do it. You pick one, counter, or set your own price
        instead. Nothing is charged until you book.
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

function useAskForQuotes() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [windowHours, setWindowHours] = useState<QuoteWindowHours>(DEFAULT_QUOTE_WINDOW);
  const [sending, setSending] = useState(false);

  async function ask(f: QuoteRequestFormFields) {
    if (sending) return;
    setSending(true);
    try {
      const location = `${f.streetAddress.trim()}, ${f.city.trim()}, ${f.addrState.trim()} ${f.zipCode.replace(/\D/g, "").slice(0, 5)}`;
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
      toast.success("Your request is up", { description: "We'll let you know when quotes come in." });
      navigate(`/quotes/request/${id}`);
    } catch (err) {
      toast.error(quoteErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return { windowHours, setWindowHours, sending, ask };
}

/** What Post a Job's submit calls while "Get quotes" is picked. */
export interface QuoteAskHandle {
  ask: (f: QuoteRequestFormFields) => Promise<void>;
}

/**
 * The quote window section, mounted only while "Get quotes" is picked, so the
 * router and query hooks it needs are never touched on today's flow. Post a
 * Job's submit reaches it through the ref.
 */
export const QuoteRequestSection = forwardRef<QuoteAskHandle, { stepNumber: number; onSendingChange: (sending: boolean) => void }>(
  function QuoteRequestSection({ stepNumber, onSendingChange }, ref) {
    const quotes = useAskForQuotes();
    useImperativeHandle(ref, () => ({ ask: quotes.ask }), [quotes.ask]);
    useEffect(() => onSendingChange(quotes.sending), [quotes.sending, onSendingChange]);
    return <QuoteWindowSection stepNumber={stepNumber} windowHours={quotes.windowHours} onWindowChange={quotes.setWindowHours} />;
  },
);
