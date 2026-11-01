/**
 * Porch pickup places, the seller's side (D-NEW14, owner-approved design 2026-10-29): up to 5 places, each with its
 * own weekdays. With at least one saved, SellPorchDays steps aside (the place's days apply) and the buyer picks a
 * place at checkout; with none, porch pickup works exactly as before. Saved as the seller taps Save, per SELLER, like
 * the pickup times, so it applies to all their listings. The server keeps every rule (declutter_save_porch_place).
 * Hidden until the migration is on the server (PGRST202), and on a failed read (said, not silent).
 */
import { type ReactNode, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  deleteMyPorchPlace, fetchItemPickupPlaces, fetchMyPorchPlaces, MAX_PORCH_PLACES, MY_PORCH_PLACES_KEY, PLACE_HOURS_NOT_SAVED, PORCH_PLACES_NOT_DEPLOYED,
  saveMyPorchPlace, type MyPorchPlace, type PickupPlaceHours,
} from "@/lib/declutter/porchPlaces";
import { AddressNeedsExactSpot } from "./AddressNeedsExactSpot";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { fetchMyPickupWindows, type PickupWindow } from "@/lib/declutter/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PickupTimesEditor, pickupWindowsProblem, placeHoursLine } from "./DeclutterPickupTimes";
import { SellerAddressField } from "./SellerAddressField";
import { NO_CITY_IN_ADDRESS } from "./sellForm";
import { useExactAddressPoint } from "./useExactAddressPoint";

/**
 * `saved`: a saved place's own point. Kept while its address is unchanged, so editing its hours moves nothing buyers rely on.
 * `windows`: the place's days and hours (LEAD-PLACE-TIMES, owner 2026-10-31: one Pickup places card, each place with its
 * own days and hours set with the same "Same hours every day / Different each day" control the pickup times used).
 */
type Draft = { id: string | null; label: string; address: string; area: string; windows: PickupWindow[]; saved?: { address: string; lat: number; lng: number } };

const FALLBACK_HOURS: PickupWindow[] = [{ weekday: 6, starts: "09:00", ends: "12:00" }];

/** A new place starts from the seller's usual pickup times (the owner's: 7 AM to 9 PM every day), else Sat 9-12. */
function usualHours(rows: { weekday: number; starts_local: string; ends_local: string }[] | undefined): PickupWindow[] {
  const ws = (rows ?? []).map((r) => ({ weekday: r.weekday, starts: r.starts_local.slice(0, 5), ends: r.ends_local.slice(0, 5) }));
  return ws.length ? ws : FALLBACK_HOURS;
}

/** A saved place's hours, else hours made from its days and the usual times (an older server returned days only). */
function placeHours(p: MyPorchPlace, usual: PickupWindow[]): PickupWindow[] {
  if (p.windows && p.windows.length) return p.windows.map((w) => ({ weekday: w.weekday, starts: w.starts, ends: w.ends }));
  return p.weekdays.flatMap((d) => {
    const that = usual.filter((w) => w.weekday === d);
    return (that.length ? that : [usual[0]]).map((w) => ({ weekday: d, starts: w.starts, ends: w.ends }));
  });
}

/**
 * index.css T2 makes every .bg-card border transparent with !important, and dark drops the shadow that draws the edge
 * in light, so a plain border class paints nothing in dark. These cards sit on another card in Declutter settings, the
 * same colour, where they vanished altogether.
 */
export const PLACE_CARD_EDGE = "dark:!border-border";

/** What the server books: the frozen place's days and hours (declutter_order_is_porch_day, declutter_order_pickup_windows). */
const PLACE_DAYS_RULE = "Buyers come on each place's own days and hours.";

/** The words over the places. `free`: nobody pays. `helprOnly`: porch is unticked, so only Helpr delivery reads them. */
function placesWords(count: number, free: boolean, helprOnly: boolean): string {
  if (free) {
    return count > 0
      ? "The person who gets it picks one of these and sees its address once they confirm. This applies to all your listings."
      : `Keep things in more than one place? Save up to ${MAX_PORCH_PLACES}, each with its own days and hours. The person who gets it picks one and sees its address once they confirm.`;
  }
  if (helprOnly) {
    return count > 0
      ? "A buyer choosing Helpr delivery picks one of these, and the Helpr picks it up there. This applies to all your listings."
      : `Keep things in more than one place? Save up to ${MAX_PORCH_PLACES}. A buyer choosing Helpr delivery picks one, and the Helpr picks it up there.`;
  }
  return count > 0
    ? "Buyers pick one of these. They only get its address after paying. This applies to all your listings."
    : `Keep things in more than one place? Save up to ${MAX_PORCH_PLACES}, each with its own days and hours. Buyers pick one and only get its address after paying.`;
}

function PlaceForm({ initial, onDone, free }: { initial: Draft; onDone: () => void; free: boolean }) {
  const qc = useQueryClient();
  const uid = useId();
  const [d, setD] = useState(initial);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const place = useExactAddressPoint();
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const address = d.address.trim();
      // A place whose address didn't change keeps its point and area. Anything else needs an exact point: a pick from
      // the list, an exact lookup, or "I'm at this address". A town or street match stops at the note under the box.
      const point = d.saved && d.saved.address.trim() === address ? d.saved : await place.locate(address);
      if (!d.area.trim()) throw new Error("no_city_in_address");
      return saveMyPorchPlace({ id: d.id, label: d.label.trim(), address, area: d.area.trim(), lat: point.lat, lng: point.lng, weekdays, windows: d.windows });
    },
    onMutate: () => setProblem(null),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: MY_PORCH_PLACES_KEY });
      // Review 2026-10-31: an older server took the days alone; never report the hours as saved.
      if (!r.hoursSaved) toast.error(PLACE_HOURS_NOT_SAVED);
      onDone();
    },
    onError: (err) => {
      const code = err instanceof Error ? err.message : "";
      // The note under the address says what to do, with "I'm at this address".
      if (code === "address_not_exact") return;
      setProblem(code === "no_city_in_address" ? NO_CITY_IN_ADDRESS : declutterErrorMessage(err));
    },
  });
  const hoursProblem = pickupWindowsProblem(d.windows);
  const ready = d.label.trim().length > 0 && d.address.trim().length >= 5 && !hoursProblem;
  const weekdays = [...new Set(d.windows.map((w) => w.weekday))].sort((a, b) => a - b);
  return (
    <div className={`space-y-3 rounded-[16px] border border-border bg-card p-4 ${PLACE_CARD_EDGE}`} data-porch-place-form="">
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-label`} className="block text-ds-14 font-semibold text-foreground">Name</label>
        <Input id={`${uid}-label`} maxLength={40} value={d.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Home, Mom's house" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-address`} className="block text-ds-14 font-semibold text-foreground">Address</label>
        <SellerAddressField id={`${uid}-address`} ariaLabel="Address" value={d.address} place={place}
          onChange={(address, area) => { set({ address, area: d.saved && d.saved.address.trim() === address.trim() ? initial.area : area }); setProblem(null); }} />
        <AddressNeedsExactSpot typedAddress={d.address} inexact={place.inexact} locating={place.locating} shareMyLocation={place.shareMyLocation} />
        <p className="text-ds-13 text-muted-foreground">{free ? "Private. Only the person who picks this place sees it." : "Private. Only the buyer who pays and picks this place sees it."}</p>
      </div>
      <div className="space-y-1.5" role="group" aria-label="Days and hours at this place" data-place-hours="">
        <p className="text-ds-14 font-semibold text-foreground">Days and hours at this place</p>
        <PickupTimesEditor windows={d.windows} setWindows={(f) => setD((x) => ({ ...x, windows: f(x.windows) }))} />
      </div>
      {problem && <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-place-problem="">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="rounded-full" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save place"}
        </Button>
        <Button type="button" variant="outline" className="rounded-full" disabled={save.isPending} onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

const PLACE_ICON_BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PlaceRow({ place, onEdit }: { place: MyPorchPlace; onEdit: () => void }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteMyPorchPlace(place.id),
    onSuccess: () => {
      setAsking(false);
      void qc.invalidateQueries({ queryKey: MY_PORCH_PLACES_KEY });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <li className={`space-y-2 rounded-[16px] border border-border bg-card p-4 ${PLACE_CARD_EDGE}`} data-porch-place="">
      {/* LEAD-PLACE-ICONS (owner 2026-10-31): Edit and Remove are icon buttons on the right, level with the name. */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]">{place.label}</p>
          <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">{place.address}</p>
          <p className="text-ds-13 text-muted-foreground" data-place-hours-line="">{placeHoursLine(place.windows, place.weekdays)}</p>
        </div>
        <div className="-mr-2 -mt-2.5 flex shrink-0" data-place-actions="">
          <button type="button" className={PLACE_ICON_BUTTON} onClick={onEdit} aria-label={`Edit ${place.label}`}>
            <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <button type="button" className={`${PLACE_ICON_BUTTON} hover:text-destructive-ink`} onClick={() => setAsking(true)} aria-label={`Remove ${place.label}`}>
            <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
      </div>
      <ConfirmSheet open={asking} onClose={() => setAsking(false)} title={`Remove ${place.label}?`}
        confirmLabel={remove.isPending ? "Removing…" : "Remove place"} cancelLabel="Keep it" pending={remove.isPending}
        onConfirm={() => remove.mutate()}>
        Buyers can't pick it anymore. Orders already placed still use it.
      </ConfirmSheet>
    </li>
  );
}

/** Whether this seller has saved places: the sell form then says which address a buyer gets. False while it reads. */
export function useHasPorchPlaces(): boolean {
  const mine = useQuery({ queryKey: MY_PORCH_PLACES_KEY, queryFn: fetchMyPorchPlaces });
  return Array.isArray(mine.data) && mine.data.length > 0;
}

/**
 * The sell form's words once the seller has saved places, placed above the listing's own area and address. The server
 * rule (declutter_start_checkout, declutter_checkout_free, declutter_item_address): porch pickup and Helpr delivery use
 * the place the buyer picks; a listing's own address applies to any other way, or once no place is saved.
 */
export function SavedPlacesComeFirst({ free }: { free: boolean }) {
  return (
    <p className="rounded-[14px] border border-border bg-card px-3 py-2.5 text-ds-13 text-foreground" data-saved-places-first="">
      {free
        ? "You have saved pickup places, so the person who gets this picks one and gets that address, not the one below."
        : "You have saved pickup places. A buyer choosing porch pickup or Helpr delivery picks one and gets that address, not the one below."}
    </p>
  );
}

/** `card`: in Declutter settings it sits among the setting cards, so it brings its own (and none while there is nothing to show). */
export function SellPorchPlaces({ card = false, free = false, helprOnly = false }: { card?: boolean; free?: boolean; helprOnly?: boolean }) {
  const mine = useQuery({ queryKey: MY_PORCH_PLACES_KEY, queryFn: fetchMyPorchPlaces });
  const { user } = useCurrentUser();
  const usualRead = useQuery({ queryKey: ["declutter", "windows", user?.id], queryFn: () => fetchMyPickupWindows(user!.id), enabled: !!user });
  const usual = usualHours(usualRead.data);
  // null: no form open; a draft: adding (id null) or editing that place.
  const [draft, setDraft] = useState<Draft | null>(null);
  if (mine.data === PORCH_PLACES_NOT_DEPLOYED) return null;
  const inCard = (body: ReactNode) => (card
    ? <section className="rounded-2xl border border-border bg-card px-4 py-3" aria-label="Pickup places" data-porch-places-card="">{body}</section>
    : body);
  // In settings a row holds the place, as its neighbours do, so Your delivery and Bundle discount are not pushed down from nothing.
  if (mine.isLoading) {
    return card ? inCard(<><span className="block text-sm font-semibold">Pickup places</span><span className="block text-xs text-muted-foreground">Loading…</span></>) : null;
  }
  if (mine.isError) return inCard(<ErrorState variant="inline" title="We couldn't load your pickup places." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />);
  const places = mine.data ?? [];
  return inCard(
    <div className="space-y-2" data-porch-places="">
      <p className="text-ds-14 font-semibold text-foreground">Pickup places</p>
      <p className="text-ds-13 text-muted-foreground">{placesWords(places.length, free, helprOnly)}</p>
      {places.length > 0 && <p className="text-ds-13 text-muted-foreground" data-place-days-rule="">{PLACE_DAYS_RULE}</p>}
      {places.length > 0 && (
        <ul className="grid gap-2 lg:grid-cols-2">
          {places.map((p) => <PlaceRow key={p.id} place={p} onEdit={() => setDraft({ id: p.id, label: p.label, address: p.address, area: p.area, windows: placeHours(p, usual), saved: { address: p.address, lat: p.lat, lng: p.lng } })} />)}
        </ul>
      )}
      {draft
        ? <PlaceForm key={draft.id ?? "new"} initial={draft} free={free} onDone={() => setDraft(null)} />
        : places.length < MAX_PORCH_PLACES && (usualRead.isError
          // Review 2026-10-31: a failed read of the usual times is said, with a retry, never a silent Sat 9-12.
          ? <ErrorState variant="inline" title="We couldn't load your usual pickup times." body={declutterErrorMessage(usualRead.error)} onRetry={() => void usualRead.refetch()} />
          : (
            <Button type="button" variant="outline" className="rounded-full" disabled={usualRead.isLoading} aria-busy={usualRead.isLoading || undefined}
              onClick={() => setDraft({ id: null, label: "", address: "", area: "", windows: usual })}>
              {usualRead.isLoading ? "Loading your times…" : "Add a pickup place"}
            </Button>
          ))}
    </div>,
  );
}

/** Each place on its own line with its own days and hours (LEAD-POST-PLACES, owner 2026-10-31: "both must show"). No address. */
/** `cityOnly`: the item page (LEAD-ITEM-PAGE-LAYOUT, owner 2026-10-31): buyers see the city, never the place's own label. */
export function PickupPlacesHoursList({ places, cityOnly = false }: { places: PickupPlaceHours[]; cityOnly?: boolean }) {
  if (places.length === 0) return null;
  return (
    <ul className="space-y-1" data-pickup-places-hours="">
      {places.map((p, i) => (
        <li key={`${p.label}-${i}`} className="text-ds-13 [overflow-wrap:anywhere]" data-pickup-place-hours="">
          <span className="font-semibold text-foreground">{cityOnly || !p.label ? p.area : [p.label, p.area].filter(Boolean).join(" · ")}</span>
          <span className="block text-muted-foreground">{placeHoursLine(p.windows, p.weekdays)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The posting summary's places: every saved place, not just the listing's own area (null while none are saved). */
export function MyPickupPlacesSummary() {
  const mine = useQuery({ queryKey: MY_PORCH_PLACES_KEY, queryFn: fetchMyPorchPlaces });
  if (!Array.isArray(mine.data) || mine.data.length === 0) return null;
  return <PickupPlacesHoursList places={mine.data} />;
}

/** The item page's places (declutter_item_pickup_places): city, days and hours (the label only to the seller); nothing before it is on the server. */
export function ItemPickupPlaces({ itemId }: { itemId: string }) {
  // retryOnMount false: ItemHandoverTimes mounts this BECAUSE the shared read failed. Refetching on mount put the query
  // back to pending (no data yet), which unmounted this, and the next failure mounted it again: an endless request loop
  // (#3889, 44,033 requests in one test). Retry is the button's.
  const read = useQuery({ queryKey: ["declutter", "item-pickup-places", itemId], queryFn: () => fetchItemPickupPlaces(itemId), retryOnMount: false });
  // Review 2026-10-31: a failed read says so, with a retry, instead of dropping the places silently.
  if (read.isError) {
    return <ErrorState variant="inline" title="We couldn't load the pickup places." body={declutterErrorMessage(read.error)} onRetry={() => void read.refetch()} />;
  }
  if (!Array.isArray(read.data) || read.data.length === 0) return null;
  return (
    <div className="space-y-1 pt-1" data-item-pickup-places="">
      <p className="text-sm font-semibold">{read.data.length === 1 ? "Pickup place" : "Pickup places"}</p>
      <PickupPlacesHoursList places={read.data} cityOnly />
    </div>
  );
}
