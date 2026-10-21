/**
 * Boards 71 (buyer: paid, porch pickup ready) and 72 (seller: sold, put it
 * out). Where a paid pickup stands, for both sides, read from
 * declutter_my_handover (never a code or QR, owner 2026-10-17/18). Started by
 * Builder 3b (wip/builder3b-porch 9a124b08ab), finished here.
 *   - One tracker (spec §3, StepTracker): porch Paid -> Ready -> Picked up ->
 *     Done; door pickup Paid -> Booked -> Picked up -> Done. Each step comes
 *     from the real row: set_out_at (the seller's porch photo), the booked
 *     slot, picked_up_at / confirmed_at, and the order's handed_over.
 *   - One line saying where it stands and what is next, by name of side.
 *   - One money note: what the buyer paid (the order's total), or what the
 *     seller is paid (the whole item price) and when, from the real rule.
 *   - The porch photo IS the handover (board 159): once the seller posts it,
 *     both sides see it (private bucket, a short signed link).
 */
import { useQuery } from "@tanstack/react-query";
import { StepTracker } from "@/components/tracker/StepTracker";
import { fetchMyHandover, handoverPhotoUrl, type MyHandover } from "@/lib/declutter/handover";
import { formatPrice } from "@/lib/declutter/distance";

type Pickup = "porch" | "pickup_home";

const STEPS: Record<Pickup, readonly string[]> = {
  porch: ["Paid", "Ready", "Picked up", "Done"],
  pickup_home: ["Paid", "Booked", "Picked up", "Done"],
};

const time = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The current step (0-based) from the real handover row. */
function handoverStep(handover: Pickup, h: Pick<MyHandover, "status" | "picked_up_at" | "confirmed_at" | "set_out_at"> | null, booked: boolean): number {
  if (h?.status === "handed_over") return 3;
  if (h?.picked_up_at || h?.confirmed_at) return 2;
  if (handover === "porch" ? !!h?.set_out_at : booked) return 1;
  return 0;
}

function useMyHandover(orderId: string) {
  return useQuery({ queryKey: ["declutter", "handover", orderId], queryFn: () => fetchMyHandover(orderId) });
}

/** The words for where it stands, per side and step. Names the other side only by role (no pronouns). */
function standing(handover: Pickup, side: "buyer" | "seller", at: number): string {
  // The booked time is the booking panel's line, right below; it is not repeated here.
  if (handover === "porch") {
    if (at === 0) return side === "buyer"
      ? "Paid · the seller puts it out and posts a photo of where it is."
      : "Paid · put it out and take one photo where the buyer will find it.";
    if (at === 1) return side === "buyer" ? "Ready · it's out. Pick it up at your pickup time." : "It's out · the buyer is told and sees your photo.";
  } else {
    if (at === 0) return side === "buyer" ? "Paid · book a pickup time with the seller." : "Paid · the buyer books a pickup time.";
    if (at === 1) return "Booked · see the pickup time below.";
  }
  return at === 2 ? "Picked up." : "Handed over. The sale is final.";
}

export function PickupStatus({
  orderId,
  handover,
  side,
  slot,
  itemsCents,
  totalCents,
}: {
  orderId: string;
  handover: Pickup;
  side: "buyer" | "seller";
  /** The booked pickup time, when there is one. */
  slot: string | null;
  /** The items' price: what the seller keeps. */
  itemsCents: number;
  /** The order's total charge: what the buyer paid. Null hides the buyer's figure. */
  totalCents: number | null;
}) {
  const h = useMyHandover(orderId);
  if (h.isError) return null;
  const at = handoverStep(handover, h.data ?? null, !!slot);
  const done = at === 3;
  const money =
    side === "buyer"
      ? totalCents != null ? <>You paid <strong className="tabular-nums">{formatPrice(totalCents)}</strong>{done ? "." : " · the seller is paid after you pick it up."}</> : null
      : done
        ? null
        : handover === "porch"
          ? <>You get <strong className="tabular-nums">{formatPrice(itemsCents)}</strong> when the buyer marks it picked up, or 24 hours after the pickup time once your porch photo is in, unless a problem is reported.</>
          : <>You get <strong className="tabular-nums">{formatPrice(itemsCents)}</strong> when the handover is confirmed.</>;
  return (
    <div className="space-y-2" data-pickup-status={at}>
      <StepTracker steps={STEPS[handover]} at={at} />
      <p className="text-ds-14">{standing(handover, side, at)}</p>
      {money && (
        // Rust on the amount only (lead, board 65 note): the sentence is ink on the money tint.
        <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground [&_strong]:text-[hsl(var(--sienna-ink))]" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
          {money}
        </p>
      )}
    </div>
  );
}

/** Board 159: the seller's porch photo, for both sides, once it's out. */
export function PorchOutPhoto({ orderId, side }: { orderId: string; side: "buyer" | "seller" }) {
  const h = useMyHandover(orderId);
  const path = h.data?.set_out_photo_path ?? null;
  const url = useQuery({
    queryKey: ["declutter", "handover-photo", path],
    queryFn: () => handoverPhotoUrl(path!),
    enabled: !!path,
    staleTime: 5 * 60_000,
  });
  if (!h.data?.set_out_at || !path) return null;
  return (
    <figure className="space-y-1.5" data-porch-photo="">
      <p className="text-sm font-semibold">
        {side === "buyer" ? "It's out" : "You put it out"} · {time(h.data.set_out_at)}
      </p>
      <div className="aspect-[4/3] w-full max-w-[320px] overflow-hidden rounded-2xl bg-muted">
        {url.data && <img src={url.data} alt="Where the item was left" className="h-full w-full object-cover" />}
      </div>
      <figcaption className="text-ds-13 text-muted-foreground">
        {side === "buyer"
          ? "This photo shows where it is. Something wrong? Report it before you take your pickup photo."
          : "The buyer sees this photo."}
      </figcaption>
    </figure>
  );
}
