/**
 * Browse's ONE compact row (owner, 2026-10-19): a slim search field with the
 * filter button beside it. The distance choices and where the miles are
 * counted from moved into the slide-up filter sheet, so Browse opens straight
 * onto the items. Any distance is the default (owner, 2026-10-19).
 */
import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { DISTANCE_CHOICES } from "@/lib/declutter/distance";
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
    <div className="flex items-center gap-2" data-testid="declutter-browse-bar">
      <label className="flex-1 min-w-0 flex items-center gap-2 h-10 px-3.5 rounded-full border border-border bg-card text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
        <Search className="w-4 h-4 shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search items"
          aria-label="Search items"
          className="flex-1 min-w-0 bg-transparent text-ds-15 text-foreground placeholder:text-muted-foreground outline-none"
        />
      </label>
      <button
        type="button"
        aria-label={filtered ? `Filters, within ${maxMiles} miles` : "Filters"}
        onClick={() => setOpen(true)}
        className={`btn-press relative shrink-0 w-10 h-10 rounded-full border flex items-center justify-center ${filtered ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"}`}
      >
        <SlidersHorizontal className="w-[18px] h-[18px]" aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" floor className="max-h-[85dvh] overflow-y-auto overscroll-contain bg-premium-page">
          <SheetHero title="How far away" />
          <div className="mt-2 space-y-3 pb-[calc(env(safe-area-inset-bottom)+16px)]">
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
        </SheetContent>
      </Sheet>
    </div>
  );
}
