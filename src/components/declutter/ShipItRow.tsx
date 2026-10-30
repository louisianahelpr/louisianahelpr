/**
 * "Ship it" in Manage listing (docs/specs/shipping-draft.md section 6; owner decisions 8, 9 and 11; Q2259): the
 * seller of a small, priced listing picks the box it ships in (each size is quoted at its most weight, so a label is
 * never short) and may tick "I'll pay shipping" (buyers see Free shipping; the label comes out of the sale). Hidden
 * unless the declutter_shipping switch is on for this account (testers) and until the migration is on prod; the
 * server refuses without the switch whatever this shows (declutter_set_ship_options).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { Switch } from "@/components/ui/switch";
import { useFeature } from "@/hooks/useFeature";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchShipOptions, setShipOptions } from "@/lib/declutter/api";
import { SHIP_PRESETS, type ShipOptions, type ShipPreset } from "@/lib/declutter/shipOptions";
import { ChipGroup } from "./DeclutterSellSteps";

const OFF = "off";
const CHOICES = [{ value: OFF, label: "Off" }, ...SHIP_PRESETS.map((p) => ({ value: p.key as string, label: p.label }))];

export function ShipItRow({ itemId, small, rowClassName }: { itemId: string; small: boolean; rowClassName: string }) {
  const on = useFeature("declutter_shipping");
  const qc = useQueryClient();
  const key = ["declutter", "ship-options", itemId];
  const state = useQuery({ queryKey: key, queryFn: () => fetchShipOptions(itemId), enabled: on && small });
  const save = useMutation({
    mutationFn: (next: ShipOptions) => setShipOptions(itemId, next),
    onSuccess: (next) => {
      toast.success(next.preset === null ? "Shipping is off for this item." : next.seller_pays ? "Saved. Buyers see free shipping." : "Saved. Buyers can have it shipped.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!on || !small || state.data === "not_deployed") return null;
  if (state.isError) {
    return <li className={rowClassName}><ErrorState variant="inline" title="We couldn't load this setting." body={declutterErrorMessage(state.error)} onRetry={() => void state.refetch()} /></li>;
  }
  if (state.isLoading || !state.data) return null;
  const cur = state.data;
  const pick = (value: string) => {
    if (save.isPending || value === (cur.preset ?? OFF)) return;
    const preset = value === OFF ? null : (value as ShipPreset);
    save.mutate({ preset, seller_pays: preset === null ? false : cur.seller_pays });
  };
  return (
    <li className={`${rowClassName} flex-col items-stretch`} data-ship-it-row="">
      <div className="space-y-2">
        <ChipGroup label="Ship it" options={CHOICES} value={cur.preset ?? OFF} onChange={pick} />
        <p className="text-ds-13 text-muted-foreground">Buyers in Louisiana can have it mailed. Pick the box it fits in. Under 4 oz ships cheapest.</p>
      </div>
      {cur.preset !== null && (
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span id={`ship-pays-${itemId}`} className="block text-ds-15 font-semibold">I'll pay shipping</span>
            <span className="block text-ds-13 text-muted-foreground">Buyers see free shipping. The label comes out of what you get for the sale.</span>
          </span>
          <Switch aria-labelledby={`ship-pays-${itemId}`} checked={cur.seller_pays} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ preset: cur.preset, seller_pays: v })} />
        </span>
      )}
    </li>
  );
}
