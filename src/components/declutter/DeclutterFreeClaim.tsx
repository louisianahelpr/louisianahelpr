/**
 * The Free section (20261027170717, owner 2026-10-27 for the launch): on someone else's FREE item, one
 * "Get it free" button in place of Buy now / Make an offer. No card is asked and nothing is charged: the
 * claim reserves the item for 48 hours, like a purchase (declutter_claim_free), and the buyer then picks
 * how to collect it in the cart (pickup at the seller's home, or porch pickup). At most 3 free items wait
 * at once; the server says so in plain words when a fourth is tried.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAgeGate } from "@/hooks/useAgeGate";
import { checkoutFree, claimFree, fetchMyCart, type DeclutterItem, type Handover } from "@/lib/declutter/api";
import { wayAllowed } from "@/lib/declutter/handovers";
import { NoWayWorks } from "./DeclutterHandoverTalk";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { DeclutterNotice } from "./declutterUi";
import { HoldChecking, myHoldOn, ReservedForYou } from "./DeclutterYourOffer";

/** Is this listing free? (price and current price are both 0, a CHECK keeps them together). */
export function isFreeItem(item: Pick<DeclutterItem, "current_price_cents">): boolean {
  return item.current_price_cents === 0;
}

export function FreeClaimPanel({ item }: { item: DeclutterItem }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { underAge } = useAgeGate();
  // Deep audit #3: a free item the member claimed themselves says so, with the way to choose a pickup.
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart, enabled: item.status === "reserved" });
  const myHold = myHoldOn(cart.data, item.id);
  const claim = useMutation({
    mutationFn: () => claimFree(item.id),
    onSuccess: () => {
      toast.success("It's yours. Choose how you'll pick it up within 48 hours.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      navigate("/declutter?tab=buying");
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });

  // Until the cart read is in, say nothing yet: "Someone is buying" would flash before "Reserved for you".
  if (item.status === "reserved" && cart.isLoading) return <HoldChecking />;
  if (item.status === "reserved" && myHold) {
    return <ReservedForYou line={myHold} free />;
  }
  if (item.status === "reserved") {
    return <DeclutterNotice title="Someone claimed this item.">If they don't choose a pickup in time, it's free again.</DeclutterNotice>;
  }
  if (underAge) {
    return <DeclutterNotice tone="warn" title="You must be 18 or older to use Declutter." />;
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label="Get this item free" data-free-claim="">
      <Button type="button" size="wrap" className="w-full rounded-full" disabled={claim.isPending} onClick={() => claim.mutate()}>
        Get it free
      </Button>
      <p className="text-xs text-muted-foreground">
        No card needed and nothing is charged. You pick it up at the seller's home or from their porch. You can hold up to 3
        free items at a time.
      </p>
    </section>
  );
}

type FreeHandover = "porch" | "pickup_home";
const FREE_HANDOVER: Record<FreeHandover, { title: string; words: string }> = {
  porch: { title: "Porch pickup", words: "The giver leaves it out for you, no need to meet. Address once you confirm." },
  pickup_home: { title: "Meet at the giver's home", words: "Pick it up at their door. Address once you confirm." },
};

/**
 * The cart for a seller whose waiting items are ALL free: no payment page and no fee. The buyer picks
 * porch pickup (only when every item allows it) or pickup at the giver's home; Helpr and seller delivery
 * are not offered for a free order. declutter_checkout_free sets the order at once, and the pickup time is
 * then booked like any paid pickup.
 */
export function FreeCheckoutForSeller({ sellerId, porchOk, ways = null, onDone }: {
  sellerId: string; porchOk: boolean; onDone: () => void;
  /** Owner 2026-10-28: the ways the giver ticked for every item here (null = older items: as before). */
  ways?: Handover[] | null;
}) {
  const qc = useQueryClient();
  // An item made free on day 12 whose giver ticked only other ways offers nothing here: no fallback to the giver's
  // door (Q2462); NoWayWorks below opens the chat with them.
  const offered: FreeHandover[] = (porchOk ? (["porch", "pickup_home"] as FreeHandover[]) : (["pickup_home"] as FreeHandover[])).filter((h) => wayAllowed(ways, h));
  const [handover, setHandover] = useState<FreeHandover>(offered[0]);
  const chosen = offered.includes(handover) ? handover : offered[0];
  const confirm = useMutation({
    mutationFn: () => checkoutFree(sellerId, chosen),
    onSuccess: () => {
      toast.success("It's set. Next: choose your pickup time.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      onDone();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <div className="space-y-3" data-free-checkout="">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">How you'll get it</legend>
        {offered.map((h) => (
          <label key={h} className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <input type="radio" className="mt-1 h-4 w-4 min-h-0 min-w-0 shrink-0" name={`free-handover-${sellerId}`} value={h}
              checked={chosen === h} onChange={() => setHandover(h)} style={{ accentColor: "hsl(var(--primary))" }} />
            <span className="min-w-0">
              <span className="block font-semibold">{FREE_HANDOVER[h].title}</span>
              <span className="block text-muted-foreground">{FREE_HANDOVER[h].words}</span>
            </span>
          </label>
        ))}
        {!porchOk && ways === null && <p className="text-xs text-muted-foreground">The giver asked to meet at their home for this item, so porch pickup isn't available.</p>}
        {offered.length === 0 && <NoWayWorks sellerId={sellerId} who="giver" />}
      </fieldset>
      <Button type="button" size="wrap" className="w-full rounded-full" disabled={confirm.isPending || offered.length === 0} onClick={() => confirm.mutate()}>
        {confirm.isPending ? "Confirming…" : "Confirm and pick a time"}
      </Button>
      <p className="text-xs text-muted-foreground">Free items are picked up only. Nothing is charged.</p>
    </div>
  );
}
