/**
 * "Ship it" in Manage listing (docs/specs/shipping-draft.md sections 6 and 8; owner decisions 8 and 11; Q2259): the
 * seller of a small, priced listing picks the box it ships in (each size is quoted at its most weight, so a label is
 * never short). Turning it on needs the seller's tick that nothing in it is on the USPS restricted list; electronics
 * and appliances are pickup only. Hidden unless the declutter_shipping switch is on for this account (testers) and
 * until the migration is on prod; the server refuses without the switch or the tick whatever this shows
 * (declutter_set_ship_options, 20261103201144).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { Checkbox } from "@/components/ui/checkbox";
import { useFeature } from "@/hooks/useFeature";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchShipOptions, setShipOptions } from "@/lib/declutter/api";
import { SHIP_PICKUP_ONLY_CATEGORIES, SHIP_PRESETS, type ShipPreset } from "@/lib/declutter/shipOptions";
import { ChipGroup } from "./DeclutterSellSteps";

const OFF = "off";
const CHOICES = [{ value: OFF, label: "Off" }, ...SHIP_PRESETS.map((p) => ({ value: p.key as string, label: p.label }))];

export function ShipItRow({ itemId, small, category, rowClassName }: { itemId: string; small: boolean; category: string; rowClassName: string }) {
  const on = useFeature("declutter_shipping");
  const qc = useQueryClient();
  const [ticked, setTicked] = useState(false);
  const allowed = small && !SHIP_PICKUP_ONLY_CATEGORIES.has(category);
  const key = ["declutter", "ship-options", itemId];
  const state = useQuery({ queryKey: key, queryFn: () => fetchShipOptions(itemId), enabled: on && allowed });
  const save = useMutation({
    mutationFn: (preset: ShipPreset | null) => setShipOptions(itemId, preset, preset !== null),
    onSuccess: (next) => {
      toast.success(next.preset === null ? "Shipping is off for this item." : "Saved. Buyers in Louisiana can have it shipped.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!on || !allowed || state.data === "not_deployed") return null;
  if (state.isError) {
    return <li className={rowClassName}><ErrorState variant="inline" title="We couldn't load this setting." body={declutterErrorMessage(state.error)} onRetry={() => void state.refetch()} /></li>;
  }
  if (state.isLoading || !state.data) return null;
  const cur = state.data;
  const confirmed = cur.preset !== null || ticked;
  const pick = (value: string) => {
    if (save.isPending || value === (cur.preset ?? OFF)) return;
    const preset = value === OFF ? null : (value as ShipPreset);
    if (preset !== null && !confirmed) {
      toast.error("First confirm nothing in it is on the USPS restricted list.");
      return;
    }
    save.mutate(preset);
  };
  return (
    <li className={`${rowClassName} flex-col items-stretch`} data-ship-it-row="">
      <div className="space-y-2">
        {cur.preset === null && (
          <label className="flex min-h-11 items-start gap-3 text-ds-13">
            <Checkbox checked={ticked} onCheckedChange={(v) => setTicked(v === true)} aria-labelledby={`ship-restricted-${itemId}`} />
            <span id={`ship-restricted-${itemId}`}>
              Nothing in it is on the USPS restricted list: no sprays, perfume, nail polish, batteries, matches or lighters.
            </span>
          </label>
        )}
        <ChipGroup label="Ship it" options={CHOICES} value={cur.preset ?? OFF} onChange={pick} />
        <p className="text-ds-13 text-muted-foreground">Buyers in Louisiana can have it mailed. Pick the box it fits in. Under 4 oz ships cheapest.</p>
      </div>
    </li>
  );
}
