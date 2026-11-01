/**
 * Declutter safe meetup spots (Q2425, owner 2026-10-27; migration 20261027204500).
 *
 * MeetupSpotPicker: at checkout, under "Meet at a safe spot": the admin-curated public places near this seller's
 * items, nearest first; picking one saves it for this seller's cart (the server checks it again at checkout).
 * MeetupPanel: on a paid meetup order, the place (name, address, a map link; never the seller's home), each side's
 * "I'm here" from an hour before the meeting time, and who has arrived. The usual handover finishes it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  chooseMeetupSpot,
  fetchOrderMeetup,
  meetupHere,
  meetupMapUrl,
  type MeetupSpotNear,
} from "@/lib/declutter/meetup";
import { meetupErrorMessage } from "@/lib/declutter/meetupErrors";
import { ErrorState } from "@/components/ui/ErrorState";

const KIND_WORDS: Record<MeetupSpotNear["kind"], string> = {
  police: "Police safe exchange spot",
  store: "Busy store",
  other: "Public place",
  // B110: a public place the seller added themselves.
  seller: "The seller's meet spot",
};

export function MeetupSpotPicker({ sellerId, spots, onChosen }: { sellerId: string; spots: MeetupSpotNear[]; onChosen: () => void }) {
  const choose = useMutation({
    mutationFn: (spotId: string) => chooseMeetupSpot(sellerId, spotId),
    onSuccess: () => onChosen(),
    onError: (err) => toast.error(meetupErrorMessage(err)),
  });
  return (
    <fieldset className="space-y-2 rounded-xl border border-border p-3" data-meetup-picker="">
      <legend className="px-1 text-xs font-medium">Pick a spot to meet</legend>
      <p className="text-xs text-muted-foreground">{spots.some((s) => s.kind === "seller")
        ? "Public places to meet. Nobody's home address is shared."
        : "Public places Louisiana Helpr checked. Nobody's home address is shared."}</p>
      {spots.map((s) => (
        <label key={s.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${s.chosen ? "border-2 border-primary" : "border-border"}`}>
          <input
            type="radio"
            className="mt-1 h-4 w-4 min-h-0 min-w-0 shrink-0"
            name={`meetup-${sellerId}`}
            checked={s.chosen}
            disabled={choose.isPending}
            onChange={() => choose.mutate(s.id)}
            style={{ accentColor: "hsl(var(--primary))" }}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-ds-14 font-semibold [overflow-wrap:anywhere]">{s.name}</span>
            <span className="block text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">
              {KIND_WORDS[s.kind]} · {s.address}
            </span>
            {s.note && <span className="block text-ds-12 text-muted-foreground [overflow-wrap:anywhere]">{s.note}</span>}
          </span>
          {s.miles !== null && <span className="shrink-0 text-ds-13 text-muted-foreground tabular-nums">{s.miles} mi</span>}
        </label>
      ))}
    </fieldset>
  );
}

const timeWords = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export function MeetupPanel({ orderId, side, slotStart }: { orderId: string; side: "buyer" | "seller"; slotStart: string | null }) {
  const qc = useQueryClient();
  const meetup = useQuery({ queryKey: ["declutter", "order-meetup", orderId], queryFn: () => fetchOrderMeetup(orderId) });
  const here = useMutation({
    mutationFn: () => meetupHere(orderId),
    onSuccess: () => {
      toast("Checked in. We told the other person you're here.");
      void qc.invalidateQueries({ queryKey: ["declutter", "order-meetup", orderId] });
    },
    onError: (err) => toast.error(meetupErrorMessage(err)),
  });
  // An error with a retry (audit 2026-10-28: "Pull to refresh" with no button, and a desktop page cannot be pulled).
  if (meetup.isError) return <ErrorState variant="inline" title="We couldn't load the meeting spot." body={meetupErrorMessage(meetup.error)} onRetry={() => void meetup.refetch()} />;
  const m = meetup.data;
  if (!m) return null;
  const mine = side === "buyer" ? m.buyer_here_at : m.seller_here_at;
  const theirs = side === "buyer" ? m.seller_here_at : m.buyer_here_at;
  const open = !!slotStart && Date.now() >= new Date(slotStart).getTime() - 60 * 60_000;
  return (
    <section className="space-y-2 rounded-xl border border-border p-3" data-meetup-panel="" aria-label="Meeting spot">
      <p className="flex items-center gap-2 text-ds-14 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />Meet at a safe spot</p>
      <p className="text-ds-14 [overflow-wrap:anywhere]">{m.spot_name}</p>
      <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">{m.spot_address}</p>
      <a className="inline-flex min-h-11 items-center gap-1.5 text-ds-14 font-semibold text-primary" href={meetupMapUrl(m)} target="_blank" rel="noopener noreferrer">
        <MapPin className="h-4 w-4" aria-hidden /> Open in Maps
      </a>
      <p className="text-ds-13" aria-live="polite">
        {mine ? `You checked in at ${timeWords(mine)}.` : null}{" "}
        {theirs ? `${side === "buyer" ? "The seller" : "Your buyer"} is here (since ${timeWords(theirs)}).` : `${side === "buyer" ? "The seller" : "Your buyer"} hasn't checked in yet.`}
      </p>
      {!mine && (
        open ? (
          <button type="button" className="h-11 w-full rounded-full border border-border px-4 text-ds-15 font-semibold" disabled={here.isPending} onClick={() => here.mutate()}>
            {here.isPending ? "Checking in…" : "I'm here"}
          </button>
        ) : (
          // Audit 1028 D1-13: only the buyer books the meeting time, so the seller is never told to book it.
          <p className="text-ds-13 text-muted-foreground">{slotStart ? "You can tap \"I'm here\" from an hour before the meeting time." : side === "buyer" ? "Book a time to meet first." : "The buyer books the time; we'll tell you."}</p>
        )
      )}
    </section>
  );
}
