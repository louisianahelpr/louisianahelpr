/**
 * Browse's ONE compact row (owner, 2026-10-19): a slim search field with the
 * filter button inside its right edge (the shared SectionSearchRow every Browse wears). The distance choices and where the miles are
 * counted from moved into the slide-up filter sheet, so Browse opens straight
 * onto the items. Any distance is the default (owner, 2026-10-19).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { DISTANCE_CHOICES } from "@/lib/declutter/distance";
import { SectionSearchRow } from "@/components/sections/SectionSearchRow";
import type { DeclutterOrigin } from "./useDeclutterOrigin";

export interface OriginAsk {
  origin: DeclutterOrigin;
  asked: boolean;
  asking: boolean;
  canAskAgain: boolean;
  deviceNote: string | null;
  askDevice: () => void;
}

function originWords(o: OriginAsk): string {
  const { origin } = o;
  if (origin.status === "ready") {
    if (origin.source === "device") return "Miles are counted from where you are.";
    const from = origin.source === "profile" ? "your saved location" : origin.source === "zip" ? "your ZIP code's area" : "your parish's center";
    return `Miles are counted from ${from}.`;
  }
  if (origin.status === "none" && origin.zipOnFile) return "We couldn't find the area for the ZIP code on your profile, so items show without miles for now.";
  return o.asked ? "Add your ZIP code in your profile to see how far each item is." : "Use your location, or add your ZIP code in your profile, to see how far each item is.";
}

export function DeclutterBrowseBar({
  query,
  onQuery,
  maxMiles,
  onMaxMiles,
  ask,
}: {
  query: string;
  onQuery: (q: string) => void;
  maxMiles: number | null;
  onMaxMiles: (m: number | null) => void;
  ask: OriginAsk;
}) {
  const [open, setOpen] = useState(false);
  const located = ask.origin.status === "ready";
  const filtered = located && maxMiles !== null;
  return (
    <>
      <SectionSearchRow
        testId="declutter-browse-bar"
        value={query}
        onChange={onQuery}
        placeholder="Search items"
        filterCount={filtered ? 1 : 0}
        filtersOpen={open}
        onFilters={() => setOpen(true)}
        filtersLabel={filtered ? `Filters, within ${maxMiles} miles` : "Filters"}
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" floor className="max-h-[85dvh] overflow-y-auto overscroll-contain bg-premium-page">
          <SheetHero title="How far away" />
          <div className="mt-2 space-y-3">
            <p className="text-sm text-muted-foreground">{originWords(ask)}</p>
            {located && (
              <SegmentedControl
                ariaLabel="How far away"
                layout="wrap"
                value={maxMiles === null ? "any" : String(maxMiles)}
                onChange={(v) => onMaxMiles(v === "any" ? null : Number(v))}
                options={DISTANCE_CHOICES.map((m) => ({ value: m === null ? "any" : String(m), label: m === null ? "Any distance" : `${m} mi` }))}
              />
            )}
            {ask.asking && <p className="text-xs text-muted-foreground" role="status">Finding you…</p>}
            {ask.deviceNote && <p className="text-xs text-muted-foreground" role="status">{ask.deviceNote}</p>}
            {!(ask.origin.status === "ready" && ask.origin.source === "device") && (!ask.asked || ask.canAskAgain) && (
              <Button type="button" variant="outline" size="sm" onClick={ask.askDevice}>
                {ask.asked ? "Try my location again" : "Use my location"}
              </Button>
            )}
          </div>
          <SheetFooter className="pt-4 pb-4">
            <SheetPrimaryAction onClick={() => setOpen(false)}>Show items</SheetPrimaryAction>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
