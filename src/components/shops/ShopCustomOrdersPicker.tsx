/**
 * Custom orders (20261106202917; owner 11-06: the SHOP OWNER chooses, per shop, between the full payment held at
 * accept and a 50% deposit). Off by default. A buyer's ask freezes the choice when it is sent, so a later change
 * never changes what a buyer was offered. Its own file and query so it loads on its own.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { PICKABLE_CUSTOM_ORDER_MODES, CUSTOM_ORDER_TEXT, fetchCustomOrders, setCustomOrders, type CustomOrderMode } from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function CustomOrdersPicker({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const choice = useQuery({ queryKey: ["shops", "custom-orders", shopId], queryFn: () => fetchCustomOrders(shopId) });
  const save = useMutation({
    mutationFn: (m: CustomOrderMode) => setCustomOrders(m),
    // No success toast: the app-wide toast policy drops toast.success without an action (declutterHandoverConfirmationsShow ceiling).
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shops", "custom-orders", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  // A shop still on the hidden half-up-front choice is paid in full (the server moved it).
  const current = choice.data === "deposit_50" ? "full_hold" : choice.data ?? "";
  return (
    <section className="space-y-2" aria-labelledby="shop-custom-orders">
      <h2 id="shop-custom-orders" className="text-ds-13 font-semibold">Custom orders</h2>
      <p className="text-ds-11 text-muted-foreground">Let buyers ask you for something made to order. You send a price; they order it like any other order.</p>
      {choice.isLoading ? (
        <Skeleton className="h-20 w-full rounded-2xl" />
      ) : choice.isError ? (
        <ErrorState variant="inline" title="We couldn't load this setting." body={shopsErrorMessage(choice.error)} onRetry={() => void choice.refetch()} />
      ) : (
        <div className="space-y-2">
          {choice.data === "deposit_50" ? (
            <p className="text-ds-11 text-muted-foreground" role="note">
              Half up front isn't open yet, so your custom orders are paid in full for now.
            </p>
          ) : null}
          <RadioCardList
            label="Custom orders"
            options={PICKABLE_CUSTOM_ORDER_MODES.map((m) => ({ value: m, label: CUSTOM_ORDER_TEXT[m].label, sub: CUSTOM_ORDER_TEXT[m].hint }))}
            value={current}
            onChange={(m) => { if (m !== current && !save.isPending) save.mutate(m as CustomOrderMode); }}
          />
        </div>
      )}
    </section>
  );
}
