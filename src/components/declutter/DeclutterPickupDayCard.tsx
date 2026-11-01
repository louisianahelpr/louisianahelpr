/**
 * D-NEW11 (owner request 2026-10-29): the pickup-day card, on top of Buying. On a day the buyer has pickups booked, one
 * card with each one's place, time and directions, "I'm on my way" (it only tells the seller: declutter_on_my_way moves
 * no money and changes no order), and, with more than one place, one link for the whole route.
 *
 * Reads the same queries as the order cards (their keys), so it adds no request for what they already read. The address
 * reads are the server's own rule (declutter_address_access): a meetup never shows the seller's home.
 */
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CalendarCheck, Navigation } from "lucide-react";
import { fetchItemAddress, fetchMyHandover, onMyWay, type MyBooking } from "@/lib/declutter/handover";
import { fetchOrderMeetup, meetupMapUrl } from "@/lib/declutter/meetup";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { routeMapsUrl } from "@/lib/declutter/route";
import { pickupsToday, type PickupOrderLike, type PickupToday } from "@/lib/declutter/pickupDay";
import { mapsSearchUrl } from "@/lib/mapsLink";

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function timeWords(p: PickupToday): string {
  const b = p.booking;
  if (p.order.handover === "porch") return b.porch_until ? `Today, until ${clock(b.porch_until)}` : "Today, any time";
  return b.slot_start && b.slot_end ? `Today, ${clock(b.slot_start)} to ${clock(b.slot_end)}` : "Today";
}

function OnMyWayButton({ orderId, sent }: { orderId: string; sent: boolean }) {
  const qc = useQueryClient();
  const go = useMutation({
    mutationFn: () => onMyWay(orderId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["declutter", "bookings"] }),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (sent || go.isSuccess) return <p className="text-ds-13 font-semibold text-[hsl(var(--sage-ink))]" role="status">The seller knows you're on the way.</p>;
  return (
    <Button type="button" size="sm" className="py-2 text-sm font-semibold tracking-normal shadow-none" disabled={go.isPending} onClick={() => go.mutate()}>
      I'm on my way
    </Button>
  );
}

export function PickupDayCard({ orders, bookings, held }: { orders: PickupOrderLike[]; bookings: MyBooking[] | undefined; held?: ReadonlySet<string> }) {
  const today = pickupsToday(orders, bookings ?? [], new Date(), held);
  // The first line's address stands for the order's stop; an order with lines at two addresses also lists them on its own card.
  const places = useQueries({
    queries: today.map((p) => p.order.handover === "meetup"
      ? { queryKey: ["declutter", "order-meetup", p.order.orderId], queryFn: () => fetchOrderMeetup(p.order.orderId) }
      : { queryKey: ["declutter", "address", p.order.lines[0]?.item_id], queryFn: () => (p.order.lines[0]?.item_id ? fetchItemAddress(p.order.lines[0].item_id) : Promise.resolve(null)) }),
  });
  // BUY-6 (buying audit 10-30 #6): a porch pickup offered "I'm on my way" and Directions before the seller put it
  // out, against the app's own "Don't go until we tell you it's on the porch". The porch photo (set_out_at) is on
  // the handover row, read with the order card's own key, so nothing is read twice.
  const porchRows = useQueries({
    queries: today.map((p) => ({
      queryKey: ["declutter", "handover", p.order.orderId],
      queryFn: () => fetchMyHandover(p.order.orderId),
      enabled: p.order.handover === "porch",
    })),
  });
  if (today.length === 0) return null;
  const stops = today.map((p, i) => {
    const r = places[i]?.data as { spot_name?: string; spot_address?: string; spot_lat?: number; spot_lng?: number; pickup_address?: string } | null | undefined;
    if (p.order.handover === "meetup") {
      return r?.spot_name
        ? { name: r.spot_name, address: r.spot_address ?? null, map: meetupMapUrl({ spot_lat: r.spot_lat ?? 0, spot_lng: r.spot_lng ?? 0, spot_name: r.spot_name }) }
        : { name: null, address: null, map: null };
    }
    return { name: null, address: r?.pickup_address ?? null, map: r?.pickup_address ? mapsSearchUrl(r.pickup_address) : null };
  });
  const route = routeMapsUrl(stops);
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-4" aria-label="Your pickups today">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-primary" aria-hidden />
        {today.length === 1 ? "Your pickup today" : `Your ${today.length} pickups today`}
      </h2>
      <ul className="space-y-4">
        {today.map((p, i) => {
          const s = stops[i];
          const notOut = p.order.handover === "porch" && !porchRows[i]?.data?.set_out_at;
          return (
            <li key={p.order.orderId} className={i > 0 ? "space-y-2 border-t border-border pt-4" : "space-y-2"}>
              <p className="text-ds-15 font-semibold leading-snug line-clamp-2">{p.order.lines.map((l) => l.item_title).join(", ")}</p>
              <p className="text-ds-13">{timeWords(p)}</p>
              {places[i]?.isError
                ? <p className="text-ds-13" role="alert">We couldn't load the place. It's on the order below.</p>
                : (s.name || s.address) && <p className="text-ds-13 font-medium break-words">{[s.name, s.address].filter(Boolean).join(", ")}</p>}
              {notOut ? (
                <p className="text-ds-13 text-muted-foreground" data-porch-not-out="">Not out yet. Don't go until we tell you it's on the porch.</p>
              ) : (
              <div className="flex flex-wrap items-center gap-2">
                <OnMyWayButton orderId={p.order.orderId} sent={p.onWay} />
                {s.map && (
                  <a href={s.map} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold">
                    <Navigation className="h-4 w-4" aria-hidden />
                    Directions
                  </a>
                )}
              </div>
              )}
            </li>
          );
        })}
      </ul>
      {route && route.count > 1 && (
        <div className="space-y-1 border-t border-border pt-4">
          <a href={route.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold">
            <Navigation className="h-4 w-4" aria-hidden />
            Route for all {route.count}
          </a>
          <p className="text-ds-12 text-muted-foreground">
            In the order of your pickup times.{route.left_out > 0 ? ` Opens the next ${route.count}; the rest join once those are done.` : ""}
          </p>
        </div>
      )}
    </section>
  );
}
