/**
 * The seller's settings as rows of the listing summary (owner 2026-11-01, 11:29 and 11:30 AM: the review's settings
 * block "could have been better organized"; "include it with the posting info"). Three labeled rows in the summary
 * card's own row style, Pickup, Price drops and Make it free, under one "From your settings" line whose ONE "Change"
 * goes to Declutter settings. Used by Sell one (inside "Your listing", SellSummaryCard) and by Sell a bunch's list
 * step (DeclutterBunchListStep). No "Uses your settings · Settings" line, no "Pickup at Home" repeat, no lone "Sat".
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { PickupWindow, SellerHandover } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { fetchMyPorchPlaces, MY_PORCH_PLACES_KEY } from "@/lib/declutter/porchPlaces";
import { dollarsToCents } from "@/lib/declutter/money";
import { WEEKDAYS } from "./declutterUi";
import { sameHoursEveryDay, timeLabel } from "./DeclutterPickupTimes";
import { HANDOVER_CHOICE, SELLER_WAYS } from "./SellHandoverChoices";
import { priceChoiceToSave, type FormState } from "./sellForm";

/** The ways under "Pickup": porch pickup is just "Porch" there (the label already says pickup). */
export function waysWords(ways: readonly SellerHandover[]): string {
  return SELLER_WAYS.filter((w) => ways.includes(w)).map((w) => (w === "porch" ? "Porch" : HANDOVER_CHOICE[w].title)).join(", ");
}

/** "Saturdays", "Saturdays and Sundays", "Mondays, Wednesdays and Saturdays", "Every day". */
export function dayWords(days: readonly number[]): string {
  const uniq = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (uniq.length === 7) return "Every day";
  const names = uniq.map((d) => `${WEEKDAYS[d]}s`);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Full day names with the hours, as the item page shows them: "Saturdays 9:00 AM–12:00 PM". Days only when no hours. */
export function daysAndHours(windows: readonly PickupWindow[] | null | undefined, weekdays?: readonly number[] | null): string {
  const ws = (windows ?? []).filter((w) => w && typeof w.starts === "string" && typeof w.ends === "string");
  if (ws.length === 0) return Array.isArray(weekdays) ? dayWords(weekdays) : "";
  const range = (w: PickupWindow) => `${timeLabel(w.starts)}–${timeLabel(w.ends)}`;
  if (sameHoursEveryDay([...ws])) return `${dayWords(ws.map((w) => w.weekday))} ${range(ws[0])}`;
  const byDay = new Map<number, PickupWindow[]>();
  for (const w of [...ws].sort((a, b) => a.weekday - b.weekday || a.starts.localeCompare(b.starts))) byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), w]);
  return [...byDay.entries()].map(([d, list]) => `${dayWords([d])} ${list.map(range).join(", ")}`).join("; ");
}

export type PickupPlaceForRow = { label: string | null; area: string; weekdays?: number[] | null; windows?: PickupWindow[] | null };

/**
 * The Pickup row's lines. One saved place: "Porch · Home, Mid-City, Baton Rouge · Saturdays 9:00 AM–12:00 PM".
 * Several: the ways, then each place on its own line. No saved place: the ways, the area and the usual times.
 */
export function pickupLines({ ways, places, areaLabel, windows }: {
  ways: readonly SellerHandover[];
  places: readonly PickupPlaceForRow[];
  areaLabel: string;
  windows: readonly PickupWindow[];
}): string[] {
  const how = waysWords(ways);
  if (places.length > 0) {
    const each = places.map((p) => [[p.label?.trim(), p.area.trim()].filter(Boolean).join(", "), daysAndHours(p.windows, p.weekdays)].filter(Boolean).join(" · "));
    return places.length === 1 ? [[how, each[0]].filter(Boolean).join(" · ")] : [how, ...each].filter(Boolean);
  }
  const line = [how, areaLabel.trim(), daysAndHours(windows)].filter(Boolean).join(" · ");
  return line ? [line] : [];
}

/** The Pickup row's lines for the signed-in seller, with their saved places (the same read and cache as Settings). */
export function usePickupLines(ways: readonly SellerHandover[], areaLabel: string, windows: readonly PickupWindow[]): string[] {
  const mine = useQuery({ queryKey: MY_PORCH_PLACES_KEY, queryFn: fetchMyPorchPlaces });
  const places = Array.isArray(mine.data) ? [...mine.data].sort((a, b) => a.position - b.position) : [];
  return pickupLines({ ways, places, areaLabel, windows });
}

/** Sell one's Price drops value, from what gets saved (priceChoiceToSave). Null for a free item or before a price. */
export function dropsValue(f: Pick<FormState, "free" | "price" | "floor" | "drops" | "dropPct">): string | null {
  if (f.free || dollarsToCents(f.price) === null) return null;
  const choice = priceChoiceToSave(f);
  if (choice && choice.dropPct === 0) return "Off";
  if (!choice) return `${f.dropPct}% each evening. Set the lowest you'll take.`;
  return `${choice.dropPct}% each evening, lowest ${formatPrice(choice.floorCents)}`;
}

/** Sell a bunch's Price drops value: the lowest is a share of each item's own price. */
export function bunchDropsValue(c: { drops: boolean; dropPct: number; floorPct: number }): string {
  return c.drops ? `${c.dropPct}% each evening, lowest ${c.floorPct}% of each price` : "Off";
}

/** The Make it free value. */
export function makeFreeValue(days: number | null): string {
  return days === null ? "Never" : `After ${days} days`;
}

/** `sellRow`: the Pickup row is where Post's settings problem is said and scrolled to (data-sell-row="settings"). */
function SettingRow({ id, title, children, extra, sellRow }: { id: string; title: string; children: ReactNode; extra?: ReactNode; sellRow?: string }) {
  return (
    <li className="space-y-2 px-4 py-3.5" data-settings-row={id} data-sell-row={sellRow}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-ds-13 font-semibold text-muted-foreground">{title}</p>
          <div className="text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]" data-settings-value="">{children}</div>
        </div>
        {extra}
      </div>
    </li>
  );
}

/**
 * The rows themselves, as <li>s for a summary card's list. `drops`/`makeFree` null: that row is left out (a free item).
 * `dropsControl`: Sell a bunch's own switch for this bunch, beside the value. `problem`: what blocks Post here.
 */
export function SellingSettingsRows({ pickup, drops, makeFree, dropsControl, problem }: {
  pickup: string[];
  drops: string | null;
  makeFree: string | null;
  dropsControl?: ReactNode;
  problem?: ReactNode;
}) {
  return (
    <>
      <li className="flex items-center gap-3 bg-muted/40 px-4 py-1" data-selling-settings="">
        <p className="min-w-0 flex-1 text-ds-14 font-semibold text-foreground">From your settings</p>
        <Button asChild variant="link" size="sm" className="shrink-0 px-2 text-ds-14 font-bold text-[hsl(var(--sage-ink))]">
          <Link to="/declutter/settings" aria-label="Change your selling settings" data-settings-change="">Change</Link>
        </Button>
      </li>
      <SettingRow id="pickup" title="Pickup" sellRow="settings">
        {pickup.length === 0 ? <span className="font-normal text-muted-foreground">Not set yet</span> : pickup.map((l, i) => <p key={i}>{l}</p>)}
        {problem}
      </SettingRow>
      {drops !== null && <SettingRow id="drops" title="Price drops" extra={dropsControl}>{drops}</SettingRow>}
      {makeFree !== null && <SettingRow id="free" title="Make it free">{makeFree}</SettingRow>}
    </>
  );
}
