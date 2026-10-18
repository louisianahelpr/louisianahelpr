/**
 * /shops/orders: the member's Shops orders as a buyer (Shops M1). Stripe's
 * success_url lands here with ?sent=1 (shop-checkout), which says the order
 * went to the shop and drops the flag. While the shop has not answered
 * ('held') the buyer can withdraw: the hold drops and nothing is charged.
 */
import { useEffect, useState } from "react";
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

export default function ShopMyOrdersView() {
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

  return (
    <AppPage title="My orders" backTo="/shops">
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
        <ul className="space-y-3">
          {(orders.data ?? []).map((o) => (
            <ShopOrderCard key={o.id} order={o} side="buyer" heading={o.shops?.name ?? "A shop"}>
              {o.status === "held" && (
                <Button type="button" size="sm" variant="outline" disabled={withdraw.isPending} onClick={() => setWithdrawing(o)}>
                  Withdraw order
                </Button>
              )}
            </ShopOrderCard>
          ))}
        </ul>
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
    </AppPage>
  );
}
