/**
 * "Miles from 70501 · Use my location" (DA-10, Declutter audit 10-29): the line above the Browse and Free grids that
 * says where the cards' miles are measured from, with the one way to change it beside it.
 *
 * The audit found the miles came from the profile ZIP (70501, Lafayette) while the device was in Baton Rouge, and
 * both the explanation and "Use my location" sat only inside Filters. The filter sheet keeps its own copy; this line
 * is the visible one. The button follows the sheet's rule (offerAsk): gone while asking and once the device gave a
 * fix, "Try my location again" after a read that did not.
 * Guard: src/components/declutter/declutterMilesFrom.test.tsx.
 */
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { offerAsk, type OriginAsk } from "./DeclutterBrowseBar";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclBrowse";

/** Where the miles on the cards are counted from, in a few words (or why there are none). */
function milesFromWords(ask: OriginAsk): string {
  const { origin } = ask;
  if (origin.status === "ready") {
    if (origin.source === "device") return "Miles from where you are";
    if (origin.source === "zip") return ask.zip ? `Miles from ${ask.zip}` : "Miles from your ZIP code's area";
    if (origin.source === "profile") return "Miles from your saved location";
    return "Miles from your parish's center";
  }
  if (origin.status === "none" && origin.zipOnFile) return "We couldn't place your ZIP code, so no miles yet";
  return "Use your location to see how far items are";
}

export function DeclutterMilesFrom({ ask }: { ask: OriginAsk }) {
  if (ask.origin.status === "pending") return null;
  return (
    <div data-miles-from="" className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p className="flex min-w-0 items-center gap-1.5 text-ds-13 text-muted-foreground">
        <MapPin className="h-4 w-4 shrink-0" aria-hidden />
        <span>{milesFromWords(ask)}</span>
      </p>
      {ask.asking ? (
        <p className="text-ds-13 text-muted-foreground" role="status">Finding you…</p>
      ) : offerAsk(ask) ? (
        // BUY-21 (Declutter buying audit 10-30): a text button, not a big outlined one, so the line and the button share
        // one row at 375 instead of wrapping into two above the cards. Still 44 px tall to tap.
        <Button type="button" variant="link" size="sm" className="shrink-0 px-1 text-ds-13 font-semibold" onClick={ask.askDevice}>
          {ask.asked ? "Try my location again" : "Use my location"}
        </Button>
      ) : null}
      {ask.deviceNote && <p className="w-full text-ds-13 text-muted-foreground" role="status">{ask.deviceNote}</p>}
    </div>
  );
}

/**
 * Owner 11-20 (site polish A4): on desktop Browse, "Use my location" is a compact button beside the search box instead
 * of a full row above the cards. Same rule as the line (offerAsk): gone while asking and once the device gave a fix.
 * Where the miles come from rides in its title, and a device note (denied, timed out) shows above the cards
 * (DeclutterDeviceNote). Guard: src/components/declutter/declutterMilesFrom.test.tsx.
 */
export function DeclutterLocationButton({ ask }: { ask: OriginAsk }) {
  const { t } = useLanguage();
  if (ask.origin.status === "pending") return null;
  if (ask.asking) return <p data-location-finding="" className="shrink-0 px-2 text-ds-13 text-muted-foreground" role="status">{t("decl.loc.finding")}</p>;
  if (!offerAsk(ask)) return null;
  return (
    <Button type="button" variant="outline" size="sm" data-location-button="" className="shrink-0 gap-1.5 rounded-full px-3 text-ds-13" title={milesFromWords(ask)} onClick={ask.askDevice}>
      <MapPin className="h-4 w-4 shrink-0" aria-hidden />
      {ask.asked ? t("decl.loc.tryAgain") : t("decl.loc.use")}
    </Button>
  );
}

/** The device's note after "Use my location" (denied, timed out), as a quiet status line; nothing without one. */
export function DeclutterDeviceNote({ ask }: { ask: OriginAsk }) {
  return ask.deviceNote ? <p data-device-note="" className="text-ds-13 text-muted-foreground" role="status">{ask.deviceNote}</p> : null;
}
