import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";

// One slot = one switch column cell. Renders a skeleton pill while the
// initial fetch is in flight (instead of an invisible-but-technically-
// there switch behind opacity-0, which is what made the toggles look
// "unresponsive" during the blank load period), and — once loaded —
// an inline spinner scoped to THIS switch while it's the one being
// saved, rather than one global spinner floating in an unrelated spot.
//
// MODULE-LEVEL on purpose. This used to be declared inside
// NotificationPreferences' render body, which makes it a brand-new component
// type on every render: React cannot match the old <SwitchSlot> to the new
// one, so it unmounts every switch and mounts fresh ones each time state
// changes. Toggling a switch sets state twice (optimistic value, then the
// saving spinner), so the very switch the user was on was destroyed and
// rebuilt — and the browser dropped focus to <body> (audit, 2026-09-12:
// "focus drops to body after toggling the push master switch").
// `loaded` and `savingKey` therefore arrive as props instead of closures.
// Audit 11-10 F476: a switch is 51x31px, under the 44px tap guide, and the Notifications screen stacks ~50 of them
// in tight rows, so a thumb can hit the neighbour. The visible pill stays 31px (the column header and the
// loading silhouette match it); the TAP area is the switch plus a 7px pseudo-element band above and below
// (45px tall), and the slot itself is 44px tall so rows cannot pack switches closer than that.
export const SWITCH_TAP_AREA_CLASS = "relative before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']";

export const SwitchSlot = ({
  checked, onCheckedChange, disabled, ariaLabel, savingId, title, loaded, savingKey,
}: {
  checked: boolean; onCheckedChange: () => void; disabled: boolean; ariaLabel: string; savingId: string; title?: string;
  loaded: boolean; savingKey: string | null;
}) => (
  <div className="w-[51px] min-h-11 flex items-center justify-center relative" title={title}>
    {loaded ? (
      <>
        <Switch className={SWITCH_TAP_AREA_CLASS} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={ariaLabel} />
        {savingKey === savingId && (
          <Loader2
            className="w-3 h-3 animate-spin absolute -top-1.5 -right-0.5 z-10 pointer-events-none"
            style={{ color: "hsl(var(--olivewood))" }}
            aria-label="Saving"
          />
        )}
      </>
    ) : (
      /* Same silhouette as the real control — track AND thumb, at the
         off position — so the column reads as "switches, not ready yet"
         rather than a row of flat grey lozenges. The knobless pill this
         replaced looked like a broken control on a slow connection: on a
         throttled load the whole column sat as uniform grey blobs for
         seconds, and nothing about a blob says "switch". */
      <div
        className="h-[31px] w-[51px] rounded-full animate-pulse border-2 border-transparent flex items-center"
        style={{ background: "hsl(var(--ink-deep) / 0.18)" }}
        aria-hidden
      >
        <div className="h-[27px] w-[27px] rounded-full bg-white/70" />
      </div>
    )}
  </div>
);
