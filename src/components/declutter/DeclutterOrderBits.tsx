/** Self-contained pieces of the paid-order card (split out of DeclutterHandoverViews.tsx to keep it under the size line). */
import { useQueries } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import type { CartLine } from "@/lib/declutter/api";
import { fetchItemAddress } from "@/lib/declutter/handover";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { OrderTalkButton } from "@/components/declutter/DeclutterOrderTalk";
import { PickupStatus } from "./DeclutterPorchHandover";
import type { PaidOrder } from "./paidOrders";

/**
 * The exact address is stored per ITEM, so a multi-item order can have more
 * than one (authz review 2.7): every line's address is read, and each distinct
 * address is listed with the items picked up there.
 */
export function PickupAddresses({ lines }: { lines: CartLine[] }) {
  const results = useQueries({
    // A line whose listing is gone (its seller deleted their account, Q2307) has no address to read.
    queries: lines.map((l) => ({ queryKey: ["declutter", "address", l.item_id], queryFn: () => (l.item_id ? fetchItemAddress(l.item_id) : Promise.resolve(null)) })),
  });
  const failed = results.find((r) => r.isError);
  // An error with a retry (audit 2026-10-28: the pickup address failing was one line with no way to try again).
  if (failed) return <ErrorState variant="inline" title="We couldn't load the pickup address." body={declutterErrorMessage(failed.error)} onRetry={() => void failed.refetch()} />;
  const byAddress = new Map<string, string[]>();
  results.forEach((r, i) => {
    const a = r.data?.pickup_address;
    if (a) byAddress.set(a, [...(byAddress.get(a) ?? []), lines[i].item_title]);
  });
  if (byAddress.size === 0) return null;
  if (byAddress.size === 1) {
    const [only] = byAddress.keys();
    return <p className="text-sm">Pickup address: <span className="font-medium">{only}</span></p>;
  }
  return (
    <div className="text-sm">
      <p>These items are picked up at different addresses:</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {[...byAddress.entries()].map(([a, titles]) => (
          <li key={a}><span className="font-medium">{a}</span> ({titles.join(", ")})</li>
        ))}
      </ul>
    </div>
  );
}

/** A pickup at the door (big items): short safety tips for both sides (owner 2026-10-18). */
export function DoorPickupTips({ side }: { side: "buyer" | "seller" }) {
  return (
    <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">Pickup at the door</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {/* Night audit sold states #3: the buyer picks the slot; the seller is never told to. */}
        {side === "buyer" && <li>Pick a daytime slot.</li>}
        <li>{side === "seller" ? "Have someone home with you." : "Bring someone with you."}</li>
        <li>Meet at the door; nobody needs to go inside.</li>
        {side === "buyer" && <li>Too big to carry? Add a Helpr below.</li>}
      </ul>
    </div>
  );
}

/**
 * NIGHT-SELL-soldstates-3 (B18's order): on the seller's open pickup sale, the money note and Message the buyer
 * come AFTER the next actions (DeclutterHandoverViews' OrderCard renders this only when sellerNextFirst).
 */
export function SellerAfterActions({ order, booking, itemsCents, problemOpen, refunded }: {
  order: PaidOrder;
  booking: { slot_start?: string | null; pickup_day?: string | null } | null | undefined;
  itemsCents: number;
  problemOpen: boolean;
  refunded: boolean;
}) {
  return (
    <div className="space-y-3" data-seller-after-actions="">
      <PickupStatus orderId={order.orderId} handover={order.handover as "porch" | "pickup_home" | "meetup"} side="seller" slot={booking?.slot_start ?? null}
        day={booking?.pickup_day ?? null} itemsCents={itemsCents} problemOpen={problemOpen} refunded={refunded} part="money" />
      <OrderTalkButton orderId={order.orderId} side={order.side} />
    </div>
  );
}
