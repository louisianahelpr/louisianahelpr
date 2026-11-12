/**
 * The item page's ONE pickup block (owner mockup 11-01, Mockups 1 and 2: "Pickup: one block, no repeats"; A3-47):
 *   Porch pickup · New Iberia or Delcambre
 *   Every day 7 AM–9 PM
 *   Meet at a safe spot
 *   Sat 9 AM–12 PM, Sun 1–5 PM · you pick the spot at checkout
 *   Helpr delivery
 *   Exact address after you pay
 * One line per way the seller ticked (checkout's words, HANDOVER_TITLE), its hours under it in one time format
 * (weekHoursLine: days in week order from today). The porch line names the pickup places' cities (else the item's
 * area) and their hours (identical ones once, else "City: hours"); the usual times go under the way they belong to
 * (itemTimesPlan). The address note is said once, last, and only when a way goes to the seller's place (A3-55).
 * The reads and their cache keys are the ones ItemPickupWays / ItemHandoverTimes / ItemPickupDisplay use.
 */
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchGuestSellerFirstName, fetchItemHandovers, fetchSellerCard, type SellerHandover } from "@/lib/declutter/api";
import { formatName } from "@/lib/utils";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchItemPickupWindows } from "@/lib/declutter/handover";
import { weekHoursLine } from "@/lib/declutter/pickupSlots";
import { fetchItemPickupPlaces } from "@/lib/declutter/porchPlaces";
import { noDeliveryWay } from "@/lib/declutter/pickupWords";
import { handoverTitle } from "./handoverCopy";
import "@/lib/i18n/enDeclPanels";
import { t, useLanguage } from "@/lib/i18n/language";
import { itemTimesPlan } from "./ItemHandoverTimes";

const ORDER: SellerHandover[] = ["porch", "meetup", "seller_delivery", "delivery"];

/**
 * When the exact pickup address is shared, said to whoever is reading (audit DC-7: the seller is not the one paying).
 * F049 (UI audit 11-09): a free item's line is a whole sentence naming the giver ("You'll get the exact address if
 * Lexi picks you."); "the giver" only while no first name is known.
 */
function addressNote(free: boolean, isSeller: boolean, giver: string | null): string {
  // Audit 11-10 F359d: a free item has no buyers; the giver picks who gets it.
  if (isSeller) return free ? t("pb.noteFreeSeller") : t("pb.noteSeller");
  return free ? t("pb.noteFree", { giver: giver ?? t("pb.theGiver") }) : t("pb.noteBuyer");
}

/**
 * The giver's first name for a free item's line, from the reads the page already makes (the same keys): a guest's
 * declutter_guest_seller_first_name (DeclutterGuestSeller), a member's seller card (DeclutterSellerCard).
 */
function useGiverFirstName(itemId: string, sellerId: string, guest: boolean, enabled: boolean): string | null {
  const guestName = useQuery({ queryKey: ["declutter", "guest-seller", itemId], queryFn: () => fetchGuestSellerFirstName(itemId), enabled: enabled && guest });
  const card = useQuery({ queryKey: ["declutter", "seller-card", sellerId], queryFn: () => fetchSellerCard(sellerId), enabled: enabled && !guest });
  if (guest) return guestName.data?.trim() || null;
  const name = card.data?.name?.trim();
  return name ? formatName(name).split(" ")[0] : null;
}

/** "A or B" / "A, B or C". */
function orList(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} ${t("pb.or")} ${xs[xs.length - 1]}`;
}

/**
 * F120 (UI audit 11-09, lead OK): the page's top line already names the item's area, so the pickup line names a town
 * only where it differs: "" when the only town is the item's area, " · also Delcambre" when the places add towns to
 * it, " · Delcambre" when none is the item's area.
 */
export function townsWords(cities: string[], areaLabel: string): string {
  const same = (c: string) => c.trim().toLowerCase() === areaLabel.trim().toLowerCase();
  const others = cities.filter((c) => c && !same(c));
  if (others.length === 0) return "";
  return cities.some(same) ? ` · ${t("pb.also")} ${orList(others)}` : ` · ${orList(others)}`;
}

export function ItemPickupBlock({ itemId, sellerId, guest, porchOk, areaLabel, free, isSeller, showAddressNote, readTimes }: {
  itemId: string; sellerId: string; guest: boolean; porchOk: boolean; areaLabel: string; free: boolean; isSeller: boolean;
  /** DA-6: the member who already bought or claimed it gets no "after you pay" words. */
  showAddressNote: boolean;
  /** Times and places are read only for a signed-in member while the item is for sale (the server answers nothing else). */
  readTimes: boolean;
}) {
  useLanguage();
  const ways = useQuery({ queryKey: ["declutter", "item-handovers", itemId], queryFn: () => fetchItemHandovers(itemId) });
  const giver = useGiverFirstName(itemId, sellerId, guest, free && !isSeller && showAddressNote);
  const places = useQuery({ queryKey: ["declutter", "item-pickup-places", itemId], queryFn: () => fetchItemPickupPlaces(itemId), enabled: readTimes, retryOnMount: false });
  const hasPlaces = !readTimes ? false : places.isPending ? null : Array.isArray(places.data) && places.data.length > 0;
  const plan = itemTimesPlan(ways.data, hasPlaces);
  const usual = useQuery({
    queryKey: ["declutter", "item-pickup-windows", itemId],
    queryFn: () => fetchItemPickupWindows(itemId),
    enabled: readTimes && !!plan.usual,
  });
  const way = noDeliveryWay(ways.data);
  const heading = t(way === "none" ? "pb.delivery" : way === "meetup" ? "pb.meetup" : "pb.pickup");

  // A3-47 (owner mockup 11-01): one line per way, its hours under it, the address note once at the end.
  const ticked = Array.isArray(ways.data) ? ORDER.filter((w) => ways.data!.includes(w)) : null;
  const placeList = plan.places && Array.isArray(places.data) ? places.data : [];
  const cities = placeList.length > 0 ? [...new Set(placeList.map((p) => p.area).filter(Boolean))] : [areaLabel];
  const usualLine = usual.data ? weekHoursLine(usual.data) : "";
  // The porch places' hours: identical ones once, otherwise "City: hours" each.
  const hourLines = placeList.map((p) => ({ area: p.area, hours: weekHoursLine(p.windows, p.weekdays) })).filter((h) => h.hours);
  const distinct = [...new Set(hourLines.map((h) => h.hours))];
  const placeHours = distinct.length === 1 ? distinct[0] : hourLines.map((h) => `${h.area}: ${h.hours}`).join("; ");
  const pickupUsual = plan.usual === "Pickup times" || plan.usual === "Pickup and meetup times" ? usualLine : "";
  const rows: { way: string; title: string; hours: string }[] = [];
  const porch = ticked === null ? porchOk : ticked.includes("porch");
  const towns = townsWords(cities, areaLabel);
  if (porch) rows.push({ way: "porch", title: `${handoverTitle("porch")}${towns}`, hours: placeHours || pickupUsual });
  if (ticked === null && !porchOk) rows.push({ way: "pickup_home", title: `${handoverTitle("pickup_home")}${towns}`, hours: pickupUsual });
  if (ticked?.includes("meetup")) {
    const meetHours = plan.usual === "Meetup times" || plan.usual === "Pickup and meetup times" ? usualLine : "";
    rows.push({ way: "meetup", title: handoverTitle("meetup"), hours: [meetHours, t("pb.pickSpot")].filter(Boolean).join(" · ") });
  }
  for (const w of ["seller_delivery", "delivery"] as const) if (ticked?.includes(w)) rows.push({ way: w, title: handoverTitle(w), hours: "" });
  // Said once, last, and only for a way that goes to the seller's place (never under delivery: A3-55).
  const note = showAddressNote && rows.some((r) => r.way === "porch" || r.way === "pickup_home") ? addressNote(free, isSeller, giver) : "";
  const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

  return (
    <section className="space-y-0.5" aria-labelledby="declutter-pickup" data-item-pickup-block="">
      <h2 id="declutter-pickup" className="text-base font-semibold">{heading}</h2>
      {ticked !== null && ticked.length === 0 ? (
        <p className="text-sm" data-pickup-ways="">{t("pb.noWays")}</p>
      ) : (
        <ul className="space-y-1.5" data-pickup-ways="">
          {rows.map((r) => (
            <li key={r.way} data-pickup-way={r.way}>
              <p className="text-ds-15 [overflow-wrap:anywhere]">{r.title}</p>
              {r.hours && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" data-item-pickup-hours={r.way}>{cap(r.hours)}</p>}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="pt-1 text-sm text-muted-foreground" data-item-address-note="">{cap(note)}</p>}
      {readTimes && places.isError && (
        <ErrorState variant="inline" title={t("pb.placesError")} body={declutterErrorMessage(places.error)} onRetry={() => void places.refetch()} />
      )}
      {readTimes && usual.isError && (
        <ErrorState variant="inline" title={t("pb.timesError")} body={declutterErrorMessage(usual.error)} onRetry={() => void usual.refetch()} />
      )}
    </section>
  );
}
