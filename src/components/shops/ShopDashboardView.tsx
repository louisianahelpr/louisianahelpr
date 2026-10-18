/**
 * /shops/dashboard: the shop owner's dashboard, M1 skeleton (SH7). Orders
 * waiting for an answer with the time left to answer (the card hold drops
 * after 24 hours), Accept (the buyer's card is charged) and Decline with a
 * reason (the hold drops, nothing is charged), the rest of the shop's orders,
 * and the cancel rule buyers read before paying (O2 presets). Later slices
 * add handovers, payouts, items and stats. No visual pass yet.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchMyShopId } from "@/lib/shops/api";
import {
  acceptOrder,
  CANCEL_POLICIES,
  CANCEL_POLICY_TEXT,
  declineOrder,
  fetchCancelPolicy,
  fetchShopOrders,
  formatCents,
  setCancelPolicy,
  timeLeftText,
  type CancelPolicy,
  type ShopOrder,
} from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopsNotice } from "./shopsUi";
import { ShopOrderCard } from "./ShopOrderCard";

const REASON_MAX = 200;

/** Re-renders once a minute so the time left to answer stays current. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function CancelPolicyPicker({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ["shops", "cancel-policy", shopId], queryFn: () => fetchCancelPolicy(shopId) });
  const save = useMutation({
    mutationFn: (p: CancelPolicy) => setCancelPolicy(p),
    onSuccess: () => {
      toast.success("Cancel rule saved. New orders use it.");
      void qc.invalidateQueries({ queryKey: ["shops", "cancel-policy", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  return (
    <section className="space-y-2" aria-labelledby="shop-cancel-rule">
      <h2 id="shop-cancel-rule" className="text-sm font-semibold">Your cancel rule</h2>
      <p className="text-xs text-muted-foreground">Buyers read it before they pay. Orders already placed keep the rule they were placed under.</p>
      {policy.isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : policy.isError ? (
        <ErrorState variant="inline" title="We couldn't load your cancel rule." body={shopsErrorMessage(policy.error)} onRetry={() => void policy.refetch()} />
      ) : (
        <div className="space-y-2" role="group" aria-label="Cancel rule">
          {CANCEL_POLICIES.map((p) => {
            const on = policy.data === p;
            return (
              <Button
                key={p}
                type="button"
                variant={on ? "default" : "outline"}
                className={`${on ? "btn-grad-primary " : ""}h-auto w-full justify-start whitespace-normal py-2 text-left`}
                aria-pressed={on}
                disabled={save.isPending}
                onClick={() => { if (!on) save.mutate(p); }}
              >
                <span className="block">
                  <span className="block text-sm font-semibold">{CANCEL_POLICY_TEXT[p].label}</span>
                  <span className="block text-xs font-normal">{CANCEL_POLICY_TEXT[p].detail}</span>
                </span>
              </Button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function ShopDashboardView() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const now = useMinuteTick();
  const [accepting, setAccepting] = useState<ShopOrder | null>(null);
  const [declining, setDeclining] = useState<ShopOrder | null>(null);
  const [reason, setReason] = useState("");
  const myId = useQuery({ queryKey: ["shops", "mine"], queryFn: fetchMyShopId });
  const orders = useQuery({
    queryKey: ["shops", "shop-orders", user?.id ?? null],
    queryFn: () => fetchShopOrders(user!.id),
    enabled: !!user?.id && !!myId.data,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["shops", "shop-orders"] });

  const accept = useMutation({
    mutationFn: (id: string) => acceptOrder(id),
    onSuccess: ({ charged }) => {
      toast.success(charged ? "Accepted. The buyer's card is charged." : "Accepted. The charge finishes within a few minutes.");
      setAccepting(null);
      refresh();
    },
    onError: (err) => {
      toast.error(shopsErrorMessage(err));
      setAccepting(null);
      refresh();
    },
  });
  const decline = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => declineOrder(id, why),
    onSuccess: () => {
      toast.success("Declined. The buyer's card was not charged.");
      setDeclining(null);
      setReason("");
      refresh();
    },
    onError: (err) => {
      toast.error(shopsErrorMessage(err));
      refresh();
    },
  });

  if (myId.isLoading || (!!myId.data && orders.isLoading)) {
    return (
      <AppPage title="Shop dashboard" backTo="/shops">
        <ul className="space-y-3" role="status" aria-label="Loading your shop's orders">
          {[0, 1].map((i) => <li key={i}><Skeleton className="h-36 w-full rounded-2xl" /></li>)}
        </ul>
      </AppPage>
    );
  }
  if (myId.isError) {
    return (
      <AppPage title="Shop dashboard" backTo="/shops">
        <ErrorState variant="inline" title="We couldn't load your shop." body={shopsErrorMessage(myId.error)} onRetry={() => void myId.refetch()} />
      </AppPage>
    );
  }
  if (!myId.data) {
    return (
      <AppPage title="Shop dashboard" backTo="/shops">
        <ShopsNotice title="You don't have a shop yet.">
          <p>
            Open a free shop and its orders show here. <Link to="/shops/mine" className="underline">Open a shop</Link>
          </p>
        </ShopsNotice>
      </AppPage>
    );
  }

  const all = orders.data ?? [];
  const waiting = all.filter((o) => o.status === "held");
  const accepted = all.filter((o) => o.status === "accepted");
  const earlier = all.filter((o) => o.status !== "held" && o.status !== "accepted");

  return (
    <AppPage title="Shop dashboard" backTo={`/shops/${myId.data}`}>
      <div className="space-y-6 pb-6">
        {orders.isError ? (
          <ErrorState variant="inline" title="We couldn't load your orders." body={shopsErrorMessage(orders.error)} onRetry={() => void orders.refetch()} />
        ) : (
          <>
            <section className="space-y-2" aria-labelledby="shop-waiting">
              <h2 id="shop-waiting" className="text-sm font-semibold">Waiting for your answer</h2>
              {waiting.length === 0 ? (
                <p className="text-sm text-muted-foreground">No new orders right now.</p>
              ) : (
                <ul className="space-y-3">
                  {waiting.map((o) => (
                    <ShopOrderCard key={o.id} order={o} side="shop" heading="New order">
                      <p className="text-xs font-semibold" data-testid="shop-order-time-left">
                        {timeLeftText(o.accept_by, now) ?? "The time to answer has passed; this order is closing."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="btn-grad-primary"
                          disabled={accept.isPending || decline.isPending || !timeLeftText(o.accept_by, now)}
                          onClick={() => setAccepting(o)}
                        >
                          Accept
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={accept.isPending || decline.isPending}
                          onClick={() => { setReason(""); setDeclining(o); }}
                        >
                          Decline
                        </Button>
                      </div>
                    </ShopOrderCard>
                  ))}
                </ul>
              )}
            </section>
            {accepted.length > 0 && (
              <section className="space-y-2" aria-labelledby="shop-accepted">
                <h2 id="shop-accepted" className="text-sm font-semibold">Accepted: make these</h2>
                <ul className="space-y-3">
                  {accepted.map((o) => <ShopOrderCard key={o.id} order={o} side="shop" heading="Accepted order" />)}
                </ul>
              </section>
            )}
            {earlier.length > 0 && (
              <section className="space-y-2" aria-labelledby="shop-earlier">
                <h2 id="shop-earlier" className="text-sm font-semibold">Earlier orders</h2>
                <ul className="space-y-3">
                  {earlier.map((o) => <ShopOrderCard key={o.id} order={o} side="shop" heading="Order" />)}
                </ul>
              </section>
            )}
          </>
        )}
        <CancelPolicyPicker shopId={myId.data} />
      </div>
      <BrandConfirmDialog
        open={!!accepting}
        onOpenChange={(open) => { if (!open) setAccepting(null); }}
        title="Accept this order?"
        description={
          accepting
            ? `The buyer's card is charged now, and you get ${formatCents(accepting.items_cents)} for it. Only accept if you can have it ready on the date.`
            : ""
        }
        primaryLabel={accept.isPending ? "Accepting…" : "Accept and charge"}
        primaryDisabled={accept.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          if (accepting) accept.mutate(accepting.id);
        }}
        secondaryLabel="Not yet"
      />
      <BrandConfirmDialog
        open={!!declining}
        onOpenChange={(open) => { if (!open) setDeclining(null); }}
        title="Decline this order?"
        description="The hold on the buyer's card drops and nothing is charged."
        primaryLabel={decline.isPending ? "Declining…" : "Decline order"}
        primaryDisabled={decline.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          if (declining) decline.mutate({ id: declining.id, why: reason });
        }}
        secondaryLabel="Keep it"
      >
        <div className="space-y-1">
          <Label htmlFor="shop-decline-reason">Reason for the buyer (optional)</Label>
          <Textarea id="shop-decline-reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder="Booked up that day" />
        </div>
      </BrandConfirmDialog>
    </AppPage>
  );
}
