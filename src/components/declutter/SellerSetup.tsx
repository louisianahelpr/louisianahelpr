/**
 * One-time setup before a seller's first post (owner 2026-10-30: "Make them set up location, pick up info and that kind
 * of stuff before listing so it's not asked every time they post. Don't even include it in posting.").
 *
 * The gate sits in front of the posting forms (one item, Give it away, Sell a bunch, moving out). It asks only for what
 * is missing and says why; a returning seller with everything saved never sees it. A saved draft (?item=) has its own
 * values and is not gated. What it saves goes where Settings already keeps it, with the RPCs Settings already uses:
 *   - the address: a saved pickup place, with the exact point looked up here (declutter_save_porch_place);
 *   - the times: declutter pickup windows;
 *   - the ways, price drops, keep it up and make it free: declutter_seller_defaults.
 * Each save is its own step, so a failure part way never asks again for what already went through.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { fetchMyPickupWindows, setPickupWindows, type PickupWindow } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { geocodeAddress } from "@/lib/geocode";
import { MY_PORCH_PLACES_KEY, saveMyPorchPlace } from "@/lib/declutter/porchPlaces";
import { SELLER_DEFAULTS, saveSellerDefaults, type SellerDefaults } from "@/lib/declutter/sellerDefaults";
import { ListingChoiceFields } from "./DeclutterListingDefaults";
import { PickupTimesEditor, pickupWindowsProblem } from "./DeclutterPickupTimes";
import { DeclutterSellSkeleton } from "./DeclutterSkeletons";
import { SELLER_WAYS, SellWayTiles } from "./SellHandoverChoices";
import { useSavedPickup } from "./useSavedPickup";

/** What a seller still has to choose before posting. Pure, so the rule is tested on its own. */
export interface SetupNeeds {
  pickup: boolean;
  ways: boolean;
  times: boolean;
  choices: boolean;
}

export function setupNeeds(s: { hasPickup: boolean; hasWays: boolean; hasWindows: boolean; hasSettings: boolean; free: boolean }): SetupNeeds {
  return {
    // No saved address, or none with an exact point (useSavedPickup never counts one without): asked here.
    pickup: !s.hasPickup,
    times: !s.hasWindows,
    // A free item is porch pickup with no price to lower, so these wait for a first priced listing.
    ways: !s.free && !s.hasWays,
    choices: !s.free && !s.hasSettings,
  };
}

const anyNeeded = (n: SetupNeeds) => n.pickup || n.ways || n.times || n.choices;

function SetupScreen({ userId, needs, saved, savedWindows }: { userId: string; needs: SetupNeeds; saved: SellerDefaults | null; savedWindows: PickupWindow[] }) {
  const qc = useQueryClient();
  const sellerDeliveryOpen = useFeature("declutter_seller_delivery");
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [areaAsked, setAreaAsked] = useState(false);
  // No day is picked for them (audit single-free #16): a guessed pickup time would be a promise they never made.
  const [windows, setWindows] = useState<PickupWindow[]>([]);
  const [defaults, setDefaults] = useState<SellerDefaults>(saved ?? SELLER_DEFAULTS);
  const change = (patch: Partial<SellerDefaults>) => setDefaults((d) => ({ ...d, ...patch }));
  const [problem, setProblem] = useState<string | null>(null);
  const shown = SELLER_WAYS.filter((w) => w !== "seller_delivery" || sellerDeliveryOpen);

  const save = useMutation({
    mutationFn: async () => {
      if (needs.pickup && address.trim().length < 5) throw new Error("setup_address");
      if (needs.times && pickupWindowsProblem(windows)) throw new Error("setup_times");
      if (needs.ways && !defaults.handovers.some((w) => shown.includes(w))) throw new Error("setup_ways");
      if (needs.ways || needs.choices) {
        await saveSellerDefaults(userId, defaults);
        await qc.invalidateQueries({ queryKey: ["declutter", "seller-defaults", userId] });
      }
      if (needs.times) {
        await setPickupWindows(windows);
        await qc.invalidateQueries({ queryKey: ["declutter", "windows", userId] });
      }
      if (needs.pickup) {
        const found = await geocodeAddress(address);
        // Never an approximate or made-up point: no match means the seller is asked again.
        if (!found) throw new Error("setup_not_found");
        const areaLabel = area.trim() || found.town || "";
        if (!areaLabel) {
          setAreaAsked(true);
          throw new Error("setup_area");
        }
        const days = [...new Set((needs.times ? windows : savedWindows).map((w) => w.weekday))];
        await saveMyPorchPlace({ id: null, label: "Home", address: address.trim(), area: areaLabel, lat: found.latitude, lng: found.longitude, weekdays: days });
        await qc.invalidateQueries({ queryKey: MY_PORCH_PLACES_KEY });
      }
    },
    onError: (err) => {
      const code = err instanceof Error ? err.message : "";
      const said: Record<string, string> = {
        setup_address: "Add your pickup address.",
        setup_times: pickupWindowsProblem(windows) ?? "",
        setup_ways: "Tick at least one way buyers can get your things.",
        setup_not_found: "We couldn't find that address. Check the street, city and ZIP.",
        setup_area: "We couldn't tell the town from that address. Add your neighborhood or town.",
      };
      if (said[code]) setProblem(said[code]);
      else toast.error(declutterErrorMessage(err));
    },
    onMutate: () => setProblem(null),
  });

  return (
    <AppPage title="Set up selling" backTo="/declutter?tab=selling">
      <div className="mx-auto w-full max-w-xl space-y-6" data-seller-setup="">
        <p className="text-ds-15 text-foreground">
          Buyers need to know where and when they can get your things. Set this once and every listing uses it. You can change it any time in Settings.
        </p>
        {needs.pickup && (
          <section className="space-y-2 rounded-[20px] border border-border bg-card p-4" data-setup-pickup="">
            <label htmlFor="setup-address" className="block text-ds-15 font-semibold text-foreground">Pickup address</label>
            <Input id="setup-address" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, ZIP" autoComplete="street-address" />
            <p className="text-ds-13 text-muted-foreground">Private. Only the buyer who pays gets it. Other buyers see your town.</p>
            {areaAsked && (
              <div className="space-y-1.5 pt-1">
                <label htmlFor="setup-area" className="block text-ds-14 font-semibold text-foreground">Area buyers see</label>
                <Input id="setup-area" maxLength={80} value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Mid-City, Baton Rouge" />
              </div>
            )}
          </section>
        )}
        {needs.times && (
          <section className="space-y-2 rounded-[20px] border border-border bg-card p-4" data-setup-times="">
            <h2 className="text-ds-15 font-semibold text-foreground">When buyers can come</h2>
            <p className="text-ds-13 text-muted-foreground">Buyers pick one of these times.</p>
            <PickupTimesEditor windows={windows} setWindows={setWindows} />
          </section>
        )}
        {needs.ways && (
          <section className="space-y-2 rounded-[20px] border border-border bg-card p-4" role="group" aria-labelledby="setup-ways" data-setup-ways="">
            <h2 id="setup-ways" className="text-ds-15 font-semibold text-foreground">How buyers can get your things</h2>
            <SellWayTiles shown={shown} ways={defaults.handovers} setWays={(w) => change({ handovers: w })} />
          </section>
        )}
        {needs.choices && (
          <section className="space-y-5 rounded-[20px] border border-border bg-card p-4" data-setup-choices="">
            <h2 className="text-ds-15 font-semibold text-foreground">If it doesn't sell right away</h2>
            <ListingChoiceFields draft={defaults} change={change} idPrefix="setup" />
          </section>
        )}
        {problem && <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-setup-problem="">{problem}</p>}
        <Button type="button" className="w-full rounded-full" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </AppPage>
  );
}

/** In front of a posting form: asks what is missing, once. A failed read offers a retry, since the form no longer asks. */
export function SellerSetupGate({ free = false, children }: { free?: boolean; children: ReactNode }) {
  const { user } = useCurrentUser();
  const { underAge } = useAgeGate();
  const userId = user?.id;
  const setup = useSavedPickup(userId, () => {});
  const windows = useQuery({ queryKey: ["declutter", "windows", userId], queryFn: () => fetchMyPickupWindows(userId!), enabled: !!userId });
  // The posting forms say what they need of an under-18 or signed-out member themselves.
  if (!userId || underAge) return <>{children}</>;
  if (setup.failed || windows.isError) {
    return (
      <AppPage title="Sell" backTo="/declutter?tab=selling">
        <ErrorState variant="inline" title="We couldn't load your selling settings." body="Check your connection and try again." onRetry={() => { setup.retry(); void windows.refetch(); }} />
      </AppPage>
    );
  }
  if (!setup.settled || !windows.isFetched) return <DeclutterSellSkeleton />;
  const saved = (windows.data ?? []).map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) }));
  const needs = setupNeeds({ hasPickup: !!setup.pickup, hasWays: setup.hasWays, hasWindows: saved.length > 0, hasSettings: setup.hasSettings, free });
  if (anyNeeded(needs)) return <SetupScreen userId={userId} needs={needs} saved={setup.settings} savedWindows={saved} />;
  return <>{children}</>;
}
