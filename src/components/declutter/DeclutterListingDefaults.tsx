/**
 * Declutter settings' "Listing defaults" (owner 2026-10-30): what a NEW listing starts with, on the account
 * (src/lib/declutter/sellerDefaults.ts, the same record the sell form reads and saves). A listing already up keeps
 * what it has. A failed read shows the retry, never the app's defaults, so a Save can never write defaults over
 * choices we simply failed to read.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Switch } from "@/components/ui/switch";
import { useFeature } from "@/hooks/useFeature";
import { DROP_PCT_CHOICES } from "@/lib/declutter/priceDrop";
import { SELLER_DEFAULTS, fetchSellerDefaults, saveSellerDefaults, type SellerDefaults } from "@/lib/declutter/sellerDefaults";
import { AutoFreeChoice } from "./AutoFreeRow";
import { ChipGroup, dropRunTime } from "./DeclutterSellSteps";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { KEEP_UP_TITLE, keepUpSettingLine } from "./KeepUpRow";
import { SELLER_WAYS, SellWayTiles } from "./SellHandoverChoices";
import { DROPS_SWITCH_LABEL } from "./sellForm";

/** The everyday choices; a saved share that is none of these (from a typed lowest price) is added so it stays selected. */
const FLOOR_CHOICES = [25, 40, 50, 60, 75];

function floorOptions(current: number) {
  return [...new Set([...FLOOR_CHOICES, current])].sort((a, b) => a - b).map((p) => ({ value: String(p), label: `${p}%` }));
}

const same = (a: SellerDefaults, b: SellerDefaults) =>
  a.keepUp === b.keepUp && a.drops === b.drops && a.dropPct === b.dropPct && a.floorPct === b.floorPct && a.freeAfterDays === b.freeAfterDays
  && a.handovers.length === b.handovers.length && a.handovers.every((w) => b.handovers.includes(w));

export function ListingDefaultsCard({ userId }: { userId: string }) {
  const saved = useQuery({ queryKey: ["declutter", "seller-defaults", userId], queryFn: () => fetchSellerDefaults(userId) });
  if (saved.isLoading) return <p role="status" className="rounded-[20px] border border-border bg-card p-4 text-sm text-muted-foreground">Loading…</p>;
  if (saved.isError) return <ErrorState variant="inline" title="We couldn't load your listing defaults." body={declutterErrorMessage(saved.error)} onRetry={() => void saved.refetch()} />;
  return <ListingDefaultsForm userId={userId} current={saved.data ?? SELLER_DEFAULTS} />;
}

/** Price drops, keep it up and make it free: the same fields here and in the one-time setup (SellerSetup). */
export function ListingChoiceFields({ draft, change, idPrefix = "defaults" }: { draft: SellerDefaults; change: (patch: Partial<SellerDefaults>) => void; idPrefix?: string }) {
  return (<>
      <div className="flex items-start gap-3">
        <label htmlFor={`${idPrefix}-drops`} className="min-w-0 flex-1">
          <span className="block text-ds-15 font-semibold text-foreground">{DROPS_SWITCH_LABEL}</span>
          <span className="block text-ds-13 text-muted-foreground">
            {draft.drops ? `It drops ${draft.dropPct}% each evening at ${dropRunTime()}, to a whole dollar, never below your lowest price.` : "Off. It stays at your price until you change it."}
          </span>
        </label>
        <Switch id={`${idPrefix}-drops`} checked={draft.drops} onCheckedChange={(v) => change({ drops: v === true })} />
      </div>
      {draft.drops && (<>
        <ChipGroup label="How much each evening" options={DROP_PCT_CHOICES.map((p) => ({ value: String(p), label: `${p}%` }))} value={String(draft.dropPct)} onChange={(v) => change({ dropPct: Number(v) })} />
        <div className="space-y-2">
          <ChipGroup label="Lowest you'll take" options={floorOptions(draft.floorPct)} value={String(draft.floorPct)} onChange={(v) => change({ floorPct: Number(v) })} />
          <p className="text-ds-13 text-muted-foreground">Starts at {draft.floorPct}% of your asking price. Only you see this. The drops stop here.</p>
        </div>
      </>)}
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span id={`${idPrefix}-keep-up`} className="block text-ds-15 font-semibold text-foreground">{KEEP_UP_TITLE}</span>
          <span className="block text-ds-13 text-muted-foreground">{keepUpSettingLine(draft.keepUp)}</span>
        </span>
        <Switch aria-labelledby={`${idPrefix}-keep-up`} checked={draft.keepUp} onCheckedChange={(v) => change({ keepUp: v === true })} />
      </div>
      <AutoFreeChoice days={draft.freeAfterDays} onChange={(days) => change({ freeAfterDays: days })} />
  </>);
}

function ListingDefaultsForm({ userId, current }: { userId: string; current: SellerDefaults }) {
  const qc = useQueryClient();
  const sellerDeliveryOpen = useFeature("declutter_seller_delivery");
  // Only what the seller changed is held here, so a refetch of the saved row never wipes an edit and an untouched
  // field always shows what is saved. Helpr delivery is not a seller's choice any more (SELLER_WAYS, DC-4).
  const [edits, setEdits] = useState<Partial<SellerDefaults>>({});
  const base: SellerDefaults = { ...current, handovers: current.handovers.filter((w) => SELLER_WAYS.includes(w)) };
  const draft: SellerDefaults = { ...base, ...edits };
  const change = (patch: Partial<SellerDefaults>) => setEdits((e) => ({ ...e, ...patch }));
  const shown = SELLER_WAYS.filter((w) => w !== "seller_delivery" || sellerDeliveryOpen);
  const noWay = !draft.handovers.some((w) => shown.includes(w));
  const save = useMutation({
    mutationFn: () => saveSellerDefaults(userId, draft),
    onSuccess: (done) => {
      if (!done) {
        toast.error("We couldn't save your listing defaults yet. Try again in a little while.");
        return;
      }
      toast.success("Listing defaults saved.");
      qc.setQueryData(["declutter", "seller-defaults", userId], draft);
      setEdits({});
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <div className="space-y-5 rounded-[20px] border border-border bg-card p-4" data-listing-defaults="">
      <p className="text-ds-13 text-muted-foreground">
        Your next listing starts with these, and you can change them on any listing. What you pick when you post becomes
        the new start. Listings already up stay as they are.
      </p>
      <ListingChoiceFields draft={draft} change={change} />
      <div className="space-y-2" role="group" aria-labelledby="defaults-ways">
        <p id="defaults-ways" className="text-ds-14 font-semibold text-foreground">How buyers can get it</p>
        <SellWayTiles shown={shown} ways={draft.handovers} setWays={(w) => change({ handovers: w })} onSettingsPage />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={save.isPending || noWay || same(draft, base)} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {noWay && <p role="note" className="text-ds-13 font-semibold text-foreground" data-defaults-no-way="">Tick at least one way buyers can get it.</p>}
      </div>
    </div>
  );
}
