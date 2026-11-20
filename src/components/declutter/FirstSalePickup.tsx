/**
 * A first sale on the ONE Sell screen (ease batch, owner-approved 2026-11-20: in 30 days 9 members opened Declutter and
 * only 2 listed). The one-item form no longer sits behind the "Set up selling" screen (SellerSetup.tsx). What that
 * screen asked is asked here, in the form, only when it is missing:
 *   - the pickup address: asked inline (private: only the buyer who pays gets it; the exact-point rule is unchanged,
 *     useExactAddressPoint). A saved place or the last listing's address is used as before (useSavedPickup).
 *   - the pickup times: start at every day 5:00-8:00 PM, SHOWN as one line with Change (audit single-free #16 said a
 *     guessed time is a promise the seller never made, so it is never hidden: it is on screen, editable, before Post).
 *   - the selling settings: SELLER_DEFAULTS, said in one line, as the setup screen said them (F124).
 * Post saves them first, with the setup screen's own saveSellerSetup, then posts as before. The server's rules are
 * unchanged: declutter_set_pickup_windows takes 1-21 windows (7 here), and declutter_publish_item still refuses a
 * seller with none (pickup_windows_required).
 * Guard: src/components/declutter/sellOneQuickList.test.tsx.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { fetchMyPickupWindows, type PickupWindow } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { AddressNeedsExactSpot } from "./AddressNeedsExactSpot";
import { PickupTimesEditor, pickupWindowsProblem } from "./DeclutterPickupTimes";
import { SellerAddressField } from "./SellerAddressField";
import { SELL_INPUT } from "./SellFormParts";
import { anyNeeded, saveSellerSetup, setupNeeds, type SetupNeeds } from "@/lib/declutter/sellerSetupSave";
import { daysAndHours } from "./SellingSettingsRows";
import { useSavedPickup } from "./useSavedPickup";
import type { SellFlow } from "./useSellFlowState";
import "@/lib/i18n/enSellForm";
import { t as tr } from "@/lib/i18n/language";

/** Every day, 5:00-8:00 PM: after work, before dark most of the year. Seven windows (the server takes 1-21). */
export const FIRST_SALE_WINDOWS: PickupWindow[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "17:00", ends: "20:00" }));

export interface FirstSale {
  /** Every read is back (or there is no member). Post waits for it, so a saved setup is never overwritten. */
  settled: boolean;
  /** A read failed: the form offers a retry instead of guessing the seller has nothing saved. */
  failed: boolean;
  reload: () => void;
  /** What is missing; null until settled (or when a read failed). */
  needs: SetupNeeds | null;
  /** What blocks Post in the times (the address uses the form's own address and city problems). */
  timesProblem: string | null;
  /** Saves what was missing; throws the setup screen's codes. A no-op when nothing is. */
  save: () => Promise<void>;
}

export function useFirstSale(s: SellFlow): FirstSale {
  const qc = useQueryClient();
  const userId = s.user?.id;
  // Its own read (the same cache keys as the flow and the setup screen): the flow skips it for work brought back.
  const saved = useSavedPickup(userId, () => {});
  const windowsQ = useQuery({ queryKey: ["declutter", "windows", userId], queryFn: () => fetchMyPickupWindows(userId!), enabled: !!userId });
  const failed = saved.failed || windowsQ.isError;
  const settled = !userId || (saved.settled && windowsQ.isFetched);
  const savedWindows = (windowsQ.data ?? []).map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) }));
  const needs = userId && settled && !failed
    ? setupNeeds({ hasPickup: !!saved.pickup, hasWindows: savedWindows.length > 0, hasSettings: saved.hasSettings })
    : null;
  // The shown start for a seller with no times yet, once (they change it with Change).
  const startedTimes = useRef(false);
  const { setWindows } = s;
  useEffect(() => {
    if (!needs?.times || startedTimes.current) return;
    startedTimes.current = true;
    setWindows(FIRST_SALE_WINDOWS);
  }, [needs?.times, setWindows]);
  return {
    settled,
    failed,
    reload: () => { saved.reload(); void windowsQ.refetch(); },
    needs,
    timesProblem: needs?.times ? pickupWindowsProblem(s.windows) : null,
    save: async () => {
      if (!userId || !needs || !anyNeeded(needs)) return;
      await saveSellerSetup({
        userId, needs, address: s.form.pickupAddress, area: s.form.areaLabel, locate: s.place.locate,
        windows: s.windows, savedWindows, qc,
      });
    },
  };
}

/** A setup save's failure in the member's words, or null when the form already shows it (the exact-spot note). */
export function firstSaleProblem(err: unknown): string | null {
  const code = err instanceof Error ? err.message : "";
  if (code === "address_not_exact") return null;
  if (code === "setup_area") return tr("sf.fp.city");
  if (code === "invalid_location") return tr("sf.fs.notFound");
  return declutterErrorMessage(err);
}

/** The Pickup box on the one Sell screen, for a seller with no address or no times saved yet. */
export function FirstSalePickup({ s, needs, problem }: { s: SellFlow; needs: SetupNeeds; problem: ReactNode }) {
  const [changing, setChanging] = useState(false);
  const { form, set, place, windows, setWindows } = s;
  if (!anyNeeded(needs)) return null;
  return (
    <section className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-sell-row="pickup" data-first-sale="" aria-labelledby="first-sale-head">
      <h2 id="first-sale-head" className="text-ds-15 font-semibold text-foreground">{tr("sf.fs.head")}</h2>
      {needs.pickup && (
        <div className="space-y-2" data-first-sale-address="">
          <label htmlFor="first-sale-address" className="block text-ds-14 font-semibold text-foreground">{tr("sf.fs.address")}</label>
          <SellerAddressField id="first-sale-address" ariaLabel={tr("sf.fs.address")} className={SELL_INPUT} value={form.pickupAddress} place={place}
            onChange={(address, city) => { set("pickupAddress", address); set("areaLabel", city); }} />
          <AddressNeedsExactSpot typedAddress={form.pickupAddress} inexact={place.inexact} locating={place.locating} shareMyLocation={place.shareMyLocation} />
          <p className="text-ds-13 text-muted-foreground">{tr(form.free ? "sf.wy.privFree" : "sf.wy.priv")}</p>
        </div>
      )}
      {needs.times && (
        <div className="space-y-3" data-first-sale-times="">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 flex-1 text-ds-14 text-foreground">
              <span className="font-semibold">{tr("sf.fs.times")}</span> <span data-first-sale-times-line="">{daysAndHours(windows)}</span>
            </p>
            <InlineTextButton className="text-ds-14 font-semibold text-[hsl(var(--sage-ink))]" aria-expanded={changing} data-first-sale-change=""
              onClick={() => setChanging((c) => !c)}>
              {changing ? tr("sf.fs.done") : tr("sf.fs.change")}
            </InlineTextButton>
          </div>
          {changing && <PickupTimesEditor windows={windows} setWindows={setWindows} />}
        </div>
      )}
      {needs.defaults && <p className="text-ds-13 text-muted-foreground" data-first-sale-defaults="">{tr("sf.fs.defaults")}</p>}
      {problem}
    </section>
  );
}
