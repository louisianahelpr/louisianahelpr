/**
 * "Raise the pay" on the buyer's delivery (spec row 40, Q1929; migration
 * 20261021185418). Shown under the delivery while no Helpr has taken it: the
 * buyer offers more, sees exactly what the second card payment costs (one
 * "You pay now" total, never a fee line: owner 2026-10-25, issue #3672), and pays it on a Stripe page. Nothing changes until
 * that payment goes through; a raise the delivery never uses comes back in
 * full. Every rule (who, when, how much) is enforced in SQL; this only explains it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { startDeliveryRaise, type DeliveryRaise } from "@/lib/declutter/deliveryRaise";
import { deliveryRaiseQuery } from "@/lib/declutter/deliveryRaiseQuery";
import { raiseCardFeeCents, RAISE_MIN_CENTS } from "@/lib/declutter/raiseFee";
import { openExternalUrl } from "@/lib/openExternalUrl";

const money = "font-semibold tabular-nums text-[hsl(var(--accent-ink))]";
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function raiseLine(r: DeliveryRaise): string {
  if (r.status === "applied") return `You raised the pay by ${formatPrice(r.raise_cents)}.`;
  // What actually goes back: the server's refund_cents (a buyer-side cancel keeps part of it). The line says the
  // amount coming back and nothing about why the rest is kept (owner 2026-10-25: no fee names, issue #3672).
  const back = typeof r.refund_cents === "number" ? r.refund_cents : r.total_cents;
  if (r.status === "refunded") return `${formatPrice(back)} of your raise payment was refunded.`;
  return `${formatPrice(back)} of your raise payment is coming back to your card.`;
}

export function DeliveryRaisePanel({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const status = useQuery(deliveryRaiseQuery(orderId));
  const [dollars, setDollars] = useState("10");
  const [opening, setOpening] = useState(false);
  const raise = useMutation({
    mutationFn: (cents: number) => startDeliveryRaise(orderId, cents),
    onSuccess: async (res) => {
      if (res.paid || !res.url) {
        toast("Your earlier raise went through.");
        void qc.invalidateQueries({ queryKey: ["declutter", "delivery-raise", orderId] });
        return;
      }
      setOpening(true);
      await openExternalUrl(res.url, () => {
        setOpening(false);
        void qc.invalidateQueries({ queryKey: ["declutter", "delivery-raise", orderId] });
        void qc.invalidateQueries({ queryKey: ["helpr-tasks"] });
      });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (status.isError) {
    // The switch turned off mid-sale: there is nothing to raise, so nothing to show.
    if (/feature_disabled/.test(String((status.error as { message?: unknown })?.message ?? ""))) return null;
    return <ErrorState variant="inline" title="We couldn't load the delivery pay." body={declutterErrorMessage(status.error)} onRetry={() => void status.refetch()} />;
  }
  const s = status.data;
  if (!s || (!s.can_raise && s.raises.length === 0)) return null;
  const cents = Math.round(Number(dollars) * 100);
  const valid = /^\d+$/.test(dollars) && cents >= RAISE_MIN_CENTS && cents <= s.room_cents;
  const fee = valid ? raiseCardFeeCents(cents) : 0;
  const busy = raise.isPending || opening;
  return (
    <section className="space-y-3 border-t border-border pt-3" aria-label="Raise the pay">
      <div className="space-y-1">
        <h3 className="text-ds-15 font-semibold">{s.can_raise ? "Raise the pay" : "Delivery pay"}</h3>
        {s.can_raise && (
          <p className="text-ds-13 text-muted-foreground">
            No Helpr has taken this yet. Offering more can help: Helprs see the new pay as soon as you pay.
          </p>
        )}
      </div>
      {s.raises.length > 0 && (
        <ul className="space-y-1 text-ds-13">
          {s.raises.map((r, i) => <li key={`${r.paid_at ?? ""}-${i}`}>{raiseLine(r)}</li>)}
        </ul>
      )}
      {s.can_raise && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy) raise.mutate(cents);
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={`raise-${orderId}`} className="block text-sm font-semibold">Add to the pay</label>
            <div className="flex h-[52px] items-center gap-1 rounded-[14px] border border-border bg-background px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
              <span className={money} aria-hidden>$</span>
              <input
                id={`raise-${orderId}`}
                inputMode="numeric"
                value={dollars}
                onChange={(e) => setDollars(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                className="w-full bg-transparent text-ds-15 font-semibold tabular-nums text-[hsl(var(--accent-ink))] outline-none focus-visible:outline-none focus-visible:ring-0"
              />
            </div>
            <p className="text-ds-12 text-muted-foreground">
              Whole dollars, from {formatPrice(RAISE_MIN_CENTS)} up to {formatPrice(s.room_cents)}.
            </p>
          </div>
          <dl className="space-y-1 text-ds-13">
            <div className="flex items-center justify-between gap-3">
              <dt>Added to the Helpr's pay</dt>
              <dd className={money}>{valid ? formatPrice(cents) : "-"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-1 font-semibold">
              <dt>You pay now</dt>
              <dd className={money}>{valid ? formatPrice(cents + fee) : "-"}</dd>
            </div>
          </dl>
          <p className="text-ds-12 text-muted-foreground">
            This is a second card payment.
            {s.open_until ? ` If no Helpr takes the delivery by ${when(s.open_until)}, all of it comes back with what you paid for delivery.` : ""}
          </p>
          <button type="submit" className="btn-grad-primary min-h-11 w-full rounded-full px-4 py-2 text-sm font-semibold" disabled={!valid || busy}>
            {busy ? "Opening payment…" : "Raise the pay"}
          </button>
        </form>
      )}
    </section>
  );
}
