/**
 * AL-4 (owner 2026-10-28, "One dispute screen for admin"): on a reported Declutter problem, the order's steps as both
 * sides' trackers draw them (OrderSteps, from buyerOrderFacts over the order's own rows) and the handover photos side
 * by side, the seller's side next to the buyer's, each with its time and, where the app measured it, how far it was
 * taken from the address. A Helpr delivery adds the Helpr's pickup photo (seller's side) and drop-off photo (buyer's
 * side). The facts and Helpr photos come from declutter_admin_problem_case (admin only); the seller's and buyer's
 * photos from declutter_admin_open_problems. No names, ids, addresses or codes here.
 */
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchProblemCase, type ProblemCase } from "@/lib/declutter/adminProblemCase";
import { handoverPhotoUrl, type AdminProblemDetail } from "@/lib/declutter/handover";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { taskPhotoUrl } from "@/lib/helprTasks/photoUrl";
import type { SellerDeliveryBooking } from "@/lib/declutter/sellerDelivery";
import { buyerOrderFacts } from "@/components/declutter/BuyingOrders";
import { OrderSteps } from "@/components/declutter/OrderSteps";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

/** A handover photo (private declutter-handover bucket, signed URL; admins may read it). */
function HandoverPhoto({ path, alt }: { path: string; alt: string }) {
  const url = useQuery({ queryKey: ["declutter", "handover-photo", path], queryFn: () => handoverPhotoUrl(path), staleTime: 5 * 60_000 });
  if (url.isError || url.data === null) return <p className="text-xs" role="alert">This photo couldn't load.</p>;
  if (!url.data) return <div className="aspect-square w-full rounded-lg bg-muted" aria-hidden />;
  return <img src={url.data} alt={alt} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />;
}

/** A Helpr's task photo (private helpr-tasks bucket, signed URL; admins may read it). */
export function HelprPhoto({ path, alt = "The Helpr's photo at the pickup address", square = false }: { path: string; alt?: string; square?: boolean }) {
  const url = useQuery({ queryKey: ["helpr-tasks", "photo", path], queryFn: () => taskPhotoUrl(path), staleTime: 5 * 60_000 });
  if (url.isError) return <p className="text-xs" role="alert">The Helpr's photo couldn't load.</p>;
  if (!url.data) return null;
  return <img src={url.data} alt={alt} className={square ? "aspect-square w-full rounded-lg object-cover" : "h-32 w-32 rounded-lg object-cover"} loading="lazy" />;
}

type Shot = { key: string; path: string; label: string; at: string | null; place: string | null; helpr: boolean };

const metres = (m: number | null | undefined, from: string) => (m != null ? `${m} m from the ${from}` : null);

/** The two columns: what the seller's side handed over, what the buyer's side received. */
function sideShots(d: AdminProblemDetail, c: ProblemCase | null): { seller: Shot[]; buyer: Shot[] } {
  const seller: Shot[] = [];
  const buyer: Shot[] = [];
  // DB-8: a seller-delivered order keeps the seller's photo at the buyer's door in the same column, so say which it is.
  const outLabel = c?.seller_delivery_status ? "Seller delivered it (photo at the buyer's address)" : "Seller set it out";
  if (d.set_out_photo_path) seller.push({ key: "out", path: d.set_out_photo_path, label: outLabel, at: when(d.set_out_at), place: null, helpr: false });
  if (c?.helpr_pickup_photo_path) {
    seller.push({ key: "hp", path: c.helpr_pickup_photo_path, label: "Helpr picked it up", at: when(c.helpr_picked_up_at), place: null, helpr: true });
  }
  if (d.picked_up_photo_path) {
    buyer.push({ key: "got", path: d.picked_up_photo_path, label: "Buyer picked it up", at: when(d.picked_up_at),
      place: metres(d.picked_up_distance_m, "pickup address"), helpr: false });
  }
  if (c?.helpr_dropoff_photo_path) {
    buyer.push({ key: "hd", path: c.helpr_dropoff_photo_path, label: "Helpr dropped it off", at: when(c.helpr_delivered_at),
      place: metres(c.helpr_dropoff_distance_m, "drop-off address"), helpr: true });
  }
  return { seller, buyer };
}

function ShotColumn({ title, shots }: { title: string; shots: Shot[] }) {
  return (
    <div className="min-w-0 space-y-2">
      <h5 className="text-xs font-semibold">{title}</h5>
      {shots.length === 0 ? <p className="text-xs text-muted-foreground">No photo.</p> : shots.map((s) => (
        <figure key={s.key} className="space-y-1">
          {s.helpr ? <HelprPhoto path={s.path} alt={s.label} square /> : <HandoverPhoto path={s.path} alt={s.label} />}
          <figcaption className="text-xs">
            <span className="font-medium">{s.label}</span>
            {s.at ? <span className="block text-muted-foreground">{s.at}</span> : null}
            {s.place ? <span className="block text-muted-foreground">{s.place}</span> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** The order's steps and both sides' photos for one problem. */
export function ProblemCaseView({ problemId, d }: { problemId: string; d: AdminProblemDetail }) {
  const kase = useQuery({ queryKey: ["declutter", "admin-problem-case", problemId], queryFn: () => fetchProblemCase(problemId) });
  const c = kase.data ?? null;
  const shots = sideShots(d, c);
  return (
    <div className="space-y-3" data-problem-case="">
      {kase.isError ? (
        <ErrorState variant="inline" title="The order's steps couldn't load." body={declutterErrorMessage(kase.error)} onRetry={() => void kase.refetch()} />
      ) : c ? (
        <OrderSteps facts={buyerOrderFacts(
          { handover: c.handover, status: c.order_status, lines: d.items_cents === 0 ? [{ price_cents: 0 }] : [{ price_cents: 1 }] },
          {
            slotStart: c.slot_start ?? c.pickup_day,
            handover: { set_out_at: d.set_out_at, picked_up_at: d.picked_up_at, confirmed_at: d.confirmed_at },
            sellerDelivery: c.seller_delivery_status
              ? { status: c.seller_delivery_status as SellerDeliveryBooking["status"], slot_start: c.seller_delivery_slot_start, delivered_at: c.seller_delivered_at }
              : null,
            task: c.helpr_accepted_at || c.helpr_picked_up_at || c.helpr_delivered_at
              ? { accepted_at: c.helpr_accepted_at, picked_up_at: c.helpr_picked_up_at, delivered_at: c.helpr_delivered_at } : null,
          },
        )} />
      ) : null}
      <section className="grid max-w-md grid-cols-2 gap-3" aria-label="Handover photos, side by side">
        <ShotColumn title="Seller's side" shots={shots.seller} />
        <ShotColumn title="Buyer's side" shots={shots.buyer} />
      </section>
    </div>
  );
}
