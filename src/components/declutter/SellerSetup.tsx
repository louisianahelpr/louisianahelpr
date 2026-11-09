/**
 * One-time setup before a seller's first post (owner 2026-10-30: "Make them set up location, pick up info and that kind
 * of stuff before listing so it's not asked every time they post. Don't even include it in posting.").
 *
 * The gate sits in front of the posting forms (one item, Give it away, Sell a bunch, moving out). It asks only for what
 * is missing and says why; a returning seller with everything saved never sees it. A saved draft (?item=) has its own
 * values and is not gated. What it saves goes where Settings already keeps it, with the RPCs Settings already uses:
 *   - the address: a saved pickup place, with the exact point looked up here (useExactAddressPoint: an exact match or the
 *     seller's own position at the address, never a town or street point; declutter_save_porch_place);
 *   - the times: declutter pickup windows;
 *   - the ways, price drops, keep it up and make it free: declutter_seller_defaults. F124 (UI audit 11-09, owner): these
 *     are NOT asked. A first-timer gets SELLER_DEFAULTS saved with the address and times (porch pickup, 5% a night down
 *     to half the price, offers on, trades off, never free) and changes them in Declutter settings.
 * The address is settled first, so a lookup that can't place it writes nothing. After that each save is its own step, so
 * a failure part way never asks again for what already went through.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { fetchMyPickupWindows, setPickupWindows, type PickupWindow } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { MY_PORCH_PLACES_KEY, saveMyPorchPlace } from "@/lib/declutter/porchPlaces";
import { SELLER_DEFAULTS, saveSellerDefaults, type SellerDefaults } from "@/lib/declutter/sellerDefaults";
import { AddressNeedsExactSpot } from "./AddressNeedsExactSpot";
import { PickupTimesEditor, pickupWindowsProblem } from "./DeclutterPickupTimes";
import { DeclutterSellSkeleton } from "./DeclutterSkeletons";
import { SellerAddressField } from "./SellerAddressField";
import { NO_CITY_IN_ADDRESS } from "./sellForm";
import { useExactAddressPoint } from "./useExactAddressPoint";
import { useSavedPickup } from "./useSavedPickup";

/** What a seller still has to choose before posting. Pure, so the rule is tested on its own. */
export interface SetupNeeds {
  /** Asked: the pickup address. */
  pickup: boolean;
  /** Asked: the days and times buyers can come. */
  times: boolean;
  /** Never asked (F124): no saved selling settings yet, so SELLER_DEFAULTS are saved along with the answers above. */
  defaults: boolean;
}

export function setupNeeds(s: { hasPickup: boolean; hasWindows: boolean; hasSettings: boolean }): SetupNeeds {
  return {
    // No saved address, or none with an exact point (useSavedPickup never counts one without): asked here.
    pickup: !s.hasPickup,
    times: !s.hasWindows,
    defaults: !s.hasSettings,
  };
}

/** Only the two questions open the screen; missing settings alone never do (every read gives SELLER_DEFAULTS). */
const anyNeeded = (n: SetupNeeds) => n.pickup || n.times;

/** F124: what a first-timer gets without being asked, in plain words, with where to change it. */
const SETUP_DEFAULTS_WORDS =
  "We set the rest for you: porch pickup, the price lowers 5% each evening down to half your asking price, offers on, trades off, and it never turns free on its own.";

function SetupScreen({ userId, needs, savedWindows }: { userId: string; needs: SetupNeeds; savedWindows: PickupWindow[] }) {
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const place = useExactAddressPoint();
  const [area, setArea] = useState("");
  // No day is picked for them (audit single-free #16): a guessed pickup time would be a promise they never made.
  const [windows, setWindows] = useState<PickupWindow[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (needs.pickup && address.trim().length < 5) throw new Error("setup_address");
      if (needs.times && pickupWindowsProblem(windows)) throw new Error("setup_times");
      let pickup: { lat: number; lng: number; area: string } | null = null;
      if (needs.pickup) {
        const found = await place.locate(address);
        // The city from the pick, or as typed. An address with none says so; nothing is guessed.
        if (!area.trim()) throw new Error("setup_area");
        pickup = { lat: found.lat, lng: found.lng, area: area.trim() };
      }
      if (needs.defaults) {
        const defaults: SellerDefaults = { ...SELLER_DEFAULTS, acceptsTrades: false };
        await saveSellerDefaults(userId, defaults);
        await qc.invalidateQueries({ queryKey: ["declutter", "seller-defaults", userId] });
      }
      if (needs.times) {
        await setPickupWindows(windows);
        await qc.invalidateQueries({ queryKey: ["declutter", "windows", userId] });
      }
      if (pickup) {
        const days = [...new Set((needs.times ? windows : savedWindows).map((w) => w.weekday))];
        await saveMyPorchPlace({ id: null, label: "Home", address: address.trim(), area: pickup.area, lat: pickup.lat, lng: pickup.lng, weekdays: days });
        await qc.invalidateQueries({ queryKey: MY_PORCH_PLACES_KEY });
      }
    },
    onError: (err) => {
      const code = err instanceof Error ? err.message : "";
      // The note under the address says what to do, with "I'm at this address".
      if (code === "address_not_exact") return;
      const said: Record<string, string> = {
        setup_address: "Add your pickup address.",
        setup_times: pickupWindowsProblem(windows) ?? "",
        invalid_location: "We couldn't find that address. Check the street, city and ZIP.",
        // The lookup itself is down: the address may be fine, so this never reads as "not found".
        address_lookup_unavailable: declutterErrorMessage({ message: "address_lookup_unavailable" }),
        setup_area: NO_CITY_IN_ADDRESS,
      };
      if (said[code]) setProblem(said[code]);
      else toast.error(declutterErrorMessage(err));
    },
    onMutate: () => setProblem(null),
  });

  return (
    <AppPage title="Set up selling" backTo="/declutter?tab=selling">
      {/* Q2582 (audit 1102a): centred (mx-auto), the 576px column started at x 556 at 1440 under a title at x 320; it
          starts under the title now. */}
      <div className="w-full max-w-xl space-y-6" data-seller-setup="">
        <p className="text-ds-15 text-foreground">
          Buyers need to know where and when they can get your things. Set this once and every listing uses it. You can change it any time in Settings.
        </p>
        {needs.pickup && (
          <section className="space-y-2 rounded-[20px] border border-border bg-card p-4" data-setup-pickup="">
            <label htmlFor="setup-address" className="block text-ds-15 font-semibold text-foreground">Pickup address</label>
            <SellerAddressField id="setup-address" ariaLabel="Pickup address" value={address} place={place} onChange={(a, city) => { setAddress(a); setArea(city); setProblem(null); }} />
            <AddressNeedsExactSpot typedAddress={address} inexact={place.inexact} locating={place.locating} shareMyLocation={place.shareMyLocation} />
            <p className="text-ds-13 text-muted-foreground">Private. Only the buyer who pays gets it. Other buyers see your town.</p>
          </section>
        )}
        {needs.times && (
          <section className="space-y-2 rounded-[20px] border border-border bg-card p-4" data-setup-times="">
            <h2 className="text-ds-15 font-semibold text-foreground">When buyers can come</h2>
            <p className="text-ds-13 text-muted-foreground">Buyers pick one of these times.</p>
            <PickupTimesEditor windows={windows} setWindows={setWindows} />
          </section>
        )}
        {needs.defaults && (
          <p className="text-ds-13 text-muted-foreground" data-setup-defaults="">
            {SETUP_DEFAULTS_WORDS}{" "}
            <Link to="/declutter/settings" className="font-semibold text-foreground underline underline-offset-2">Change these in Declutter settings</Link>
          </p>
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
export function SellerSetupGate({ children }: { children: ReactNode }) {
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
        <ErrorState variant="inline" title="We couldn't load your selling settings." body="Check your connection and try again." onRetry={() => { setup.reload(); void windows.refetch(); }} />
      </AppPage>
    );
  }
  if (!setup.settled || !windows.isFetched) return <DeclutterSellSkeleton />;
  const saved = (windows.data ?? []).map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) }));
  const needs = setupNeeds({ hasPickup: !!setup.pickup, hasWindows: saved.length > 0, hasSettings: setup.hasSettings });
  if (anyNeeded(needs)) return <SetupScreen userId={userId} needs={needs} savedWindows={saved} />;
  return <>{children}</>;
}
