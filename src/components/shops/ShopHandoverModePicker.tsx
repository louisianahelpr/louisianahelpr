/**
 * How the shop's orders are handed over (Shops M2, owner pop-up 2026-10-18:
 * the shop's choice, in person by default, NO codes). Its own file so the
 * dashboard keeps one loading gate (oneLoadingGatePerScreen): this section
 * loads on its own, as the cancel rule does.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchHandoverMode, HANDOVER_MODES, HANDOVER_MODE_TEXT, setHandoverMode, type HandoverMode } from "@/lib/shops/handover";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function HandoverModePicker({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const mode = useQuery({ queryKey: ["shops", "handover-mode", shopId], queryFn: () => fetchHandoverMode(shopId) });
  const save = useMutation({
    mutationFn: (m: HandoverMode) => setHandoverMode(m),
    onSuccess: () => {
      toast.success("Saved. New orders use it.");
      void qc.invalidateQueries({ queryKey: ["shops", "handover-mode", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  return (
    <section className="space-y-2" aria-labelledby="shop-handover-mode">
      <h2 id="shop-handover-mode" className="text-sm font-semibold">How buyers get their orders</h2>
      <p className="text-xs text-muted-foreground">Orders already placed keep the way they were placed under.</p>
      {mode.isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : mode.isError ? (
        <ErrorState variant="inline" title="We couldn't load this setting." body={shopsErrorMessage(mode.error)} onRetry={() => void mode.refetch()} />
      ) : (
        <div className="space-y-2" role="group" aria-label="How buyers get their orders">
          {HANDOVER_MODES.map((m) => {
            const on = mode.data === m;
            return (
              <Button
                key={m}
                type="button"
                variant={on ? "default" : "outline"}
                className={`${on ? "btn-grad-primary " : ""}h-auto w-full justify-start whitespace-normal py-2 text-left`}
                aria-pressed={on}
                disabled={save.isPending}
                onClick={() => { if (!on) save.mutate(m); }}
              >
                <span className="block">
                  <span className="block text-sm font-semibold">{HANDOVER_MODE_TEXT[m].label}</span>
                  <span className="block text-xs font-normal">{HANDOVER_MODE_TEXT[m].detail}</span>
                </span>
              </Button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** What a buyer reads before paying: how this shop hands orders over. Nothing until it has loaded. */
export function HandoverModeNote({ shopId }: { shopId: string }) {
  const mode = useQuery({ queryKey: ["shops", "handover-mode", shopId], queryFn: () => fetchHandoverMode(shopId) });
  if (!mode.data) return null;
  const t = HANDOVER_MODE_TEXT[mode.data];
  return (
    <div className="space-y-1 rounded-xl bg-muted/60 p-3" data-testid="shop-order-handover-mode">
      <p className="text-sm font-semibold">{t.label}</p>
      <p className="text-xs text-muted-foreground">
        {mode.data === "porch"
          ? "The shop leaves your order out with a photo. Tap \"I got it\" when you have it. If you don't, it finishes on its own 24 hours after the ready date."
          : "You pick your order up from the shop. Tap \"I got it\" when you have it. If you don't, it finishes on its own 24 hours after the ready date."}
      </p>
    </div>
  );
}
