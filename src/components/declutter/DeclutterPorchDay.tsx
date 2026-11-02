/**
 * Porch pickup is a DAY, not a time (owner 2026-10-28: "make porch just pick a day but they also need to
 * know once it's on the porch so they don't show up and it's not there"). The buyer picks one of the
 * seller's pickup days (declutter_porch_days); the seller puts it out that day and posts the porch photo,
 * which tells the buyer (the photo's notice) and turns the card to "It's out. Pick it up today."
 *
 * The server (20261028225038) holds every rule: which days, move once, never once it is out, the
 * no-show and the auto-pay from the END of the day. Until that migration is live (the days read comes
 * back null) and for a pickup already booked for a TIME, the card keeps the time picker (`fallback`).
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { bookPorchDay, fetchMyHandover, fetchPorchDays, type MyBooking } from "@/lib/declutter/handover";
import { declutterErrorMessage } from "@/lib/declutter/errors";

/** "2026-10-29" -> a local date (never shifted by the device's time zone). */
function localDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "Today", "Tomorrow", else "Thu, Oct 30". */
export function porchDayWords(day: string, now = new Date()): string {
  if (day === todayKey(now)) return "Today";
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (day === todayKey(tomorrow)) return "Tomorrow";
  return localDay(day).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** True when the picked day is today or already past (the item, once out, is to be picked up now). */
export function porchDayIsNow(day: string, now = new Date()): boolean {
  return day <= todayKey(now);
}

/**
 * When "They didn't show" may open. A booked time: its start (the button adds its own 15 minutes). A porch
 * day: 15 minutes before the day ends, so the button opens when the day is over (the server's rule).
 */
export function noShowFrom(booking: Pick<MyBooking, "slot_start" | "pickup_day">): string | null {
  if (!booking.slot_start) return null;
  if (!booking.pickup_day) return booking.slot_start;
  const d = localDay(booking.pickup_day);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return new Date(end.getTime() - 15 * 60_000).toISOString();
}

/**
 * True once the booked pickup is over (owner 2026-10-29, D2-9: no "Report a problem" while the order waits for
 * pickup): 15 minutes after a booked time, or the end of a porch day, the moment "They didn't show" opens. The
 * "I got it" sheet's "Something's not right" (the handover itself) still opens the form. No booking yet: false.
 */
export function pickupTimeOver(booking: Pick<MyBooking, "slot_start" | "pickup_day"> | null, now = Date.now()): boolean {
  const from = booking ? noShowFrom(booking) : null;
  return !!from && now >= new Date(from).getTime() + 15 * 60_000;
}

type Booking = MyBooking & { buyer_reschedules?: number; seller_reschedules?: number };

export function PorchDayPanel({ orderId, side, booking, fallback, noDays }: {
  orderId: string;
  side: "buyer" | "seller";
  booking: Booking | null;
  /** The time picker: before the server knows days, and for a pickup already booked for a time. */
  fallback: ReactNode;
  /** The buyer's way out when the seller has no pickup days left (the only "Report a problem" before a day is booked, D2-9). */
  noDays?: ReactNode;
}) {
  const qc = useQueryClient();
  const booked = booking?.slot_start ? booking.pickup_day ?? null : null;
  const timeBooked = !!booking?.slot_start && !booking.pickup_day;
  const days = useQuery({ queryKey: ["declutter", "porch-days", orderId], queryFn: () => fetchPorchDays(orderId), enabled: !timeBooked });
  const [pick, setPick] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  // Audit 1028 D1-5: once the seller's porch photo is in, it is out; the seller no longer moves the day.
  const out = useQuery({ queryKey: ["declutter", "handover", orderId], queryFn: () => fetchMyHandover(orderId), enabled: side === "seller" && !!booked });
  const putOut = side === "seller" && !!out.data?.set_out_at;
  const book = useMutation({
    mutationFn: (day: string) => bookPorchDay(orderId, day),
    onSuccess: (r) => {
      toast(r.result === "booked" ? "Pickup day booked." : "Pickup day changed.");
      setPick(null);
      setMoving(false);
      for (const key of [["declutter", "porch-days", orderId], ["declutter", "bookings"], ["declutter", "my-cart"], ["declutter", "handover", orderId]]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (timeBooked) return <>{fallback}</>;
  if (days.isError) {
    return <ErrorState variant="inline" title="We couldn't load the pickup days." body={declutterErrorMessage(days.error)} onRetry={() => void days.refetch()} />;
  }
  if (days.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading pickup days…</p>;
  // The server does not know porch days yet: the time picker, as before.
  if (days.data === null) return <>{fallback}</>;
  const movedAlready = side === "buyer" ? (booking?.buyer_reschedules ?? 0) >= 1 : (booking?.seller_reschedules ?? 0) >= 1;
  const choosing = (!booked && side === "buyer") || moving;
  // The days on offer: never the one already booked (with only that day left, the card says none are left).
  const otherDays = (days.data ?? []).filter((d) => d !== booked);
  return (
    <div className="space-y-2" data-porch-day={booked ?? ""}>
      {booked ? (
        <p className="text-sm">
          Pickup day: <span className="font-medium">{porchDayWords(booked)}</span>.{" "}
          {side === "seller" ? "The buyer can come any time that day once you post the porch photo." : "It's out all that day once the seller posts the porch photo."}
        </p>
      ) : null /* A3-49: the seller's waiting line is the card's next-step line, said once. */}
      {booked && !moving && !movedAlready && !putOut && (
        <button type="button" className="min-h-11 text-sm font-semibold underline underline-offset-2" onClick={() => setMoving(true)}>
          Pick another day (once)
        </button>
      )}
      {choosing && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">{booked ? "Pick another day" : "Pick a pickup day"}</legend>
          {otherDays.length === 0 ? (
            <div className="space-y-2">
              {/* Night audit sold states #8: the seller read the buyer's line about "the seller". */}
              <p className="text-sm text-muted-foreground">
                {side === "seller"
                  ? "You have no pickup days left before the buyer's 7-day pickup deadline."
                  : "The seller has no pickup days left before your 7-day pickup deadline. Report a problem and we'll sort it out."}
              </p>
              {side === "buyer" && !booked && noDays}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Pickup days">
              {otherDays.map((d) => (
                <button key={d} type="button" aria-pressed={pick === d} onClick={() => setPick(d)}
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold ${pick === d ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-border bg-card text-foreground"}`}>
                  {porchDayWords(d)}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-grad-primary !text-[hsl(var(--parchment))] min-h-11 rounded-full px-5 text-sm font-semibold"
              disabled={!pick || book.isPending} onClick={() => { if (pick) book.mutate(pick); }}>
              {book.isPending ? "Saving…" : booked ? "Move to this day" : "Book this day"}
            </button>
            {moving && <button type="button" className="min-h-11 text-sm font-semibold underline underline-offset-2" onClick={() => { setMoving(false); setPick(null); }}>Keep {porchDayWords(booked ?? "")}</button>}
          </div>
          {side === "buyer" && (
            <p className="text-xs text-muted-foreground">
              Don't go until we tell you it's on the porch. If the seller never puts it out that day, you can report it once the day is over.
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
