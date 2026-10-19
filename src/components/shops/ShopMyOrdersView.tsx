/**
 * /shops/orders: the member's Shops orders as a buyer (Shops M1). Stripe's
 * success_url lands here with ?sent=1 (shop-checkout), which says the order
 * went to the shop and drops the flag. While the shop has not answered
 * ('held') the buyer can withdraw: the hold drops and nothing is charged.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cancelOrderRequest, fetchMyOrders, type ShopOrder } from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopsNotice } from "./shopsUi";
import { ShopOrderCard } from "./ShopOrderCard";
import { ShopHandoverActions } from "./ShopHandoverActions";
import { StatusBoxes, useStatusFilter } from "@/components/sections/StatusBoxes";
import { OrderGroup } from "./shopsUi";

/** The buyer's order groups under Shops > Orders (owner, 2026-10-19). */
const BUYER_GROUPS = ["waiting", "accepted", "done"] as const;
type BuyerGroup = (typeof BUYER_GROUPS)[number];
const BUYER_GROUP_LABEL: Record<BuyerGroup, string> = { waiting: "Waiting", accepted: "Accepted", done: "Done" };
const BUYER_GROUP_TITLE: Record<BuyerGroup, string> = { waiting: "Waiting for the shop", accepted: "Accepted", done: "Done" };
export function buyerGroup(o: Pick<ShopOrder, "status">): BuyerGroup {
  if (o.status === "held") return "waiting";
  if (o.status === "accepted" || o.status === "handed_over") return "accepted";
  return "done";
}

/**
 * `embedded`: rendered inside the Shops section's Orders tab (no page frame of
 * its own), with the status boxes on top and the orders grouped. Standalone
 * (/shops/orders) it is unchanged.
 */
export default function ShopMyOrdersView({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [withdrawing, setWithdrawing] = useState<ShopOrder | null>(null);
  const orders = useQuery({
    queryKey: ["shops", "my-orders", user?.id ?? null],
    queryFn: () => fetchMyOrders(user!.id),
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (params.get("sent") !== "1") return;
    toast.success("Order sent. The shop has 24 hours to answer; your card is held, not charged.");
    const next = new URLSearchParams(params);
    next.delete("sent");
    setParams(next, { replace: true });
  }, [params, setParams]);

  const [status, toggleStatus] = useStatusFilter(BUYER_GROUPS);
  const withdraw = useMutation({
    mutationFn: (id: string) => cancelOrderRequest(id),
    onSuccess: () => {
      toast.success("Order withdrawn. Nothing was charged.");
      setWithdrawing(null);
      void qc.invalidateQueries({ queryKey: ["shops", "my-orders"] });
    },
    onError: (err) => {
      toast.error(shopsErrorMessage(err));
      void qc.invalidateQueries({ queryKey: ["shops", "my-orders"] });
    },
  });

  const renderOrder = (o: ShopOrder, uid: string) => (
    <ShopOrderCard key={o.id} order={o} side="buyer" heading={o.shops?.name ?? "A shop"}>
      {o.status === "held" && (
        <Button type="button" size="sm" variant="outline" disabled={withdraw.isPending} onClick={() => setWithdrawing(o)}>
          Withdraw order
        </Button>
      )}
      {(o.status === "accepted" || o.status === "handed_over") && <ShopHandoverActions order={o} side="buyer" userId={uid} />}
    </ShopOrderCard>
  );
  const Frame = embedded ? EmbeddedFrame : StandaloneFrame;

  return (
    <Frame>
      {orders.isError ? (
        <ErrorState variant="inline" title="We couldn't load your orders." body={shopsErrorMessage(orders.error)} onRetry={() => void orders.refetch()} />
      ) : orders.isLoading || !user ? (
        <ul className="space-y-3" role="status" aria-label="Loading your orders">
          {[0, 1].map((i) => <li key={i}><Skeleton className="h-36 w-full rounded-2xl" /></li>)}
        </ul>
      ) : (orders.data ?? []).length === 0 ? (
        <ShopsNotice title="No orders yet.">
          <p>
            Order from a local shop and it shows here. <Link to="/shops" className="underline">Browse shops</Link>
          </p>
        </ShopsNotice>
      ) : (
        embedded ? (
          <>
            <StatusBoxes
              boxes={BUYER_GROUPS.map((g) => ({ key: g, label: BUYER_GROUP_LABEL[g], count: (orders.data ?? []).filter((o) => buyerGroup(o) === g).length, hot: g === "accepted" }))}
              value={status}
              onToggle={toggleStatus}
            />
            {BUYER_GROUPS.filter((g) => status === null || status === g).map((g) => {
              const rows = (orders.data ?? []).filter((o) => buyerGroup(o) === g);
              return (
                <OrderGroup key={g} title={BUYER_GROUP_TITLE[g]} count={rows.length} empty="Nothing here right now.">
                  {rows.map((o) => renderOrder(o, user.id))}
                </OrderGroup>
              );
            })}
          </>
        ) : (
          <ul className="space-y-3">{(orders.data ?? []).map((o) => renderOrder(o, user.id))}</ul>
        )
      )}
      <BrandConfirmDialog
        open={!!withdrawing}
        onOpenChange={(open) => { if (!open) setWithdrawing(null); }}
        title="Withdraw this order?"
        description="The shop hasn't answered yet. The hold on your card drops and nothing is charged."
        primaryLabel={withdraw.isPending ? "Withdrawing…" : "Withdraw order"}
        primaryDisabled={withdraw.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          if (withdrawing) withdraw.mutate(withdrawing.id);
        }}
        secondaryLabel="Keep it"
      />
    </Frame>
  );
}

function StandaloneFrame({ children }: { children: ReactNode }) {
  return <AppPage title="My orders" backTo="/shops">{children}</AppPage>;
}
function EmbeddedFrame({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4" data-testid="shops-orders-tab">{children}</div>;
}
