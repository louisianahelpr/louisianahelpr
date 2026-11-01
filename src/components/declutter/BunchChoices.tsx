/**
 * Sell a bunch's listing choices (audit finding 9): "Lower the price" and "Keep it up", once for the batch, starting
 * from the seller's remembered choices (lib/declutter/sellerDefaults.ts: both ON when nothing is saved) and the ways
 * buyers get an item from there or their last listing, as the single form does. What the seller chose is remembered
 * again once something lists. Pickup times are not here: they are per seller, and only a change is saved.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import type { PickupWindow, SellerHandover } from "@/lib/declutter/api";
import type { BunchChoices } from "@/lib/declutter/bunch";
import { fetchLastSetup } from "@/lib/declutter/lastSetup";
import { SELLER_DEFAULTS, fetchSellerDefaults, saveSellerDefaults } from "@/lib/declutter/sellerDefaults";
import { KEEP_UP_TITLE, keepUpSettingLine } from "./KeepUpRow";
import { DROPS_SWITCH_LABEL } from "./sellForm";

type SavedWindow = { weekday: number; starts_local: string; ends_local: string };

/** Whether the times on screen are the ones already saved, in any order (a saved time reads back as 09:00:00). */
export function samePickupWindows(shown: PickupWindow[], saved: SavedWindow[]): boolean {
  const words = (w: { weekday: number; starts: string; ends: string }) => `${w.weekday} ${w.starts} ${w.ends}`;
  const a = shown.map(words).sort();
  const b = saved.map((r) => words({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) })).sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function useBunchChoices(userId: string | undefined, setWays: (u: (w: SellerHandover[]) => SellerHandover[]) => void) {
  // The same reads and cache entries as the single form.
  const saved = useQuery({ queryKey: ["declutter", "seller-defaults", userId], queryFn: () => fetchSellerDefaults(userId!), enabled: !!userId });
  const last = useQuery({ queryKey: ["declutter", "last-setup", userId], queryFn: () => fetchLastSetup(userId!), enabled: !!userId, staleTime: 60_000 });
  const [choices, setChoices] = useState<BunchChoices>({
    // LEAD-BUNCH-PCT-LABEL (owner 2026-10-31): price drops start OFF on Sell a bunch until the seller turns them on
    // (here or in Settings); saved settings still win below.
    keepUp: SELLER_DEFAULTS.keepUp, drops: false, dropPct: SELLER_DEFAULTS.dropPct, floorPct: SELLER_DEFAULTS.floorPct,
  });
  const applied = useRef(false);
  useEffect(() => {
    // isFetched is true after a failed read too: that is extra help lost, and the app's defaults stand.
    if (!userId || applied.current || !saved.isFetched || !last.isFetched) return;
    applied.current = true;
    const row = saved.data ?? null;
    const lastSetup = last.data ?? null;
    // LEAD-OFFERS-CHOICE part (2): each item's Accept offers starts from the saved default.
    if (row) setChoices({ keepUp: row.keepUp, drops: row.drops, dropPct: row.dropPct, floorPct: row.floorPct, acceptsOffers: row.acceptsOffers, freeAfterDays: row.freeAfterDays });
    else if (lastSetup?.dropPct != null) setChoices((c) => ({ ...c, dropPct: lastSetup.dropPct! }));
    const ways = (row?.handovers ?? lastSetup?.ways ?? []).filter((w) => w !== "delivery");
    // The default is porch pickup alone; a seller who already ticked something keeps it.
    if (ways.length > 0) setWays((w) => (w.length === 1 && w[0] === "porch" ? ways : w));
  }, [userId, saved.isFetched, saved.data, last.isFetched, last.data, setWays]);

  /** What the seller chose becomes next time's start, on the single form too. Listing has already happened. */
  async function remember(ways: SellerHandover[]): Promise<void> {
    if (!userId) return;
    try {
      await saveSellerDefaults(userId, { ...choices, freeAfterDays: choices.freeAfterDays ?? saved.data?.freeAfterDays ?? SELLER_DEFAULTS.freeAfterDays, handovers: ways, acceptsOffers: saved.data?.acceptsOffers ?? SELLER_DEFAULTS.acceptsOffers });
    } catch (err) {
      // Remembering is extra: logged, never a second error on a screen that says what was listed.
      console.warn("[declutter] could not save the seller's listing choices", err);
    }
  }

  const set = (patch: Partial<BunchChoices>) => setChoices((c) => ({ ...c, ...patch }));
  return { choices, set, remember };
}

/** The price-drops switch for the whole bunch, on the setup form (no saved settings yet). */
function BunchDropsSwitch({ c }: { c: ReturnType<typeof useBunchChoices> }) {
  const { drops, dropPct, floorPct } = c.choices;
  return (
    <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-4" data-bunch-drops={drops ? "on" : "off"}>
      <span className="min-w-0 flex-1">
        <span id="bunch-drops" className="block text-ds-15 font-semibold">{DROPS_SWITCH_LABEL}</span>
        <span className="block text-ds-13 text-muted-foreground">
          {drops ? `On. Each priced item drops ${dropPct}% each evening, never below ${floorPct}% of its price.` : "Off. Each priced item stays at its price."}
        </span>
      </span>
      <Switch aria-labelledby="bunch-drops" checked={drops} onCheckedChange={(v) => c.set({ drops: v === true })} />
    </div>
  );
}

export function BunchChoicesCard({ c, anyPriced }: { c: ReturnType<typeof useBunchChoices>; anyPriced: boolean }) {
  const { keepUp } = c.choices;
  return (
    <div className="space-y-3 pt-2" data-bunch-switches="">
      {anyPriced && <BunchDropsSwitch c={c} />}
      <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-4" data-bunch-keep-up={keepUp ? "on" : "off"}>
        <span className="min-w-0 flex-1">
          <span id="bunch-keep-up" className="block text-ds-15 font-semibold">{KEEP_UP_TITLE}</span>
          <span className="block text-ds-13 text-muted-foreground">{keepUpSettingLine(keepUp)}</span>
        </span>
        <Switch aria-labelledby="bunch-keep-up" checked={keepUp} onCheckedChange={(v) => c.set({ keepUp: v === true })} />
      </div>
    </div>
  );
}
