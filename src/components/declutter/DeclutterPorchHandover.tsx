/**
 * Boards 71, 72, 159 (2026-10-20): where a paid pickup stands, for both sides,
 * read from declutter_my_handover (never a code or QR, owner 2026-10-17/18).
 *   - One tracker (spec §3 "Progress tracker"): porch Paid -> Out -> Picked up
 *     -> Done; door pickup Paid -> Booked -> Picked up -> Done. Each step comes
 *     from the real row: set_out_at (the seller's "Left on porch" photo), the
 *     booked slot, picked_up_at / confirmed_at, and the order's handed_over.
 *   - The porch photo IS the handover (board 159): once the seller posts it,
 *     the buyer sees it (private bucket, a short signed link the two sides may
 *     read: declutter_handover_photo_access) with the time it went out.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyHandover, handoverPhotoUrl, type MyHandover } from "@/lib/declutter/handover";

type Handover = "porch" | "pickup_home" | "delivery";

const STEPS: Record<"porch" | "pickup_home", string[]> = {
  porch: ["Paid", "Out", "Picked up", "Done"],
  pickup_home: ["Paid", "Booked", "Picked up", "Done"],
};

const time = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

/** The current step (0-based) from the real handover row. */
export function handoverStep(handover: "porch" | "pickup_home", h: MyHandover | null, booked: boolean): number {
  if (h?.status === "handed_over") return 3;
  if (h?.picked_up_at || h?.confirmed_at) return 2;
  if (handover === "porch" ? !!h?.set_out_at : booked) return 1;
  return 0;
}

export function useMyHandover(orderId: string) {
  return useQuery({ queryKey: ["declutter", "handover", orderId], queryFn: () => fetchMyHandover(orderId) });
}

export function HandoverTracker({ orderId, handover, booked }: { orderId: string; handover: Handover; booked: boolean }) {
  const h = useMyHandover(orderId);
  if (handover === "delivery" || h.isError) return null;
  const names = STEPS[handover];
  const at = handoverStep(handover, h.data ?? null, booked);
  return (
    <div className="space-y-1.5" data-handover-tracker={at}>
      <ol className="grid grid-cols-4 gap-1.5" aria-label={`Step ${at + 1} of 4 · ${names[at]}`}>
        {names.map((n, i) => (
          <li key={n} className="space-y-1">
            <span aria-hidden className={`block h-1 rounded-full ${i <= at ? "bg-primary" : "bg-border"}`} />
            <span className={`block text-[11px] ${i === at ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{n}</span>
          </li>
        ))}
      </ol>
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
      <div className="aspect-[4/3] w-full max-w-[320px] overflow-hidden rounded-2xl bg-photo-empty">
        {url.data && <img src={url.data} alt="Where the item was left" className="h-full w-full object-cover" />}
      </div>
      <figcaption className="text-ds-13 text-muted-foreground">
        {side === "buyer"
          ? "This photo is the handover. Once you tap \"I got it\", the sale is final and the seller is paid. Something wrong? Tell us before you tap."
          : "The buyer sees this photo. You're paid when they tap \"I got it\" or take their pickup photo, or automatically 24 hours after the pickup time unless a problem is reported."}
      </figcaption>
    </figure>
  );
}
