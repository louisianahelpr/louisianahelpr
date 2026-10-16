/**
 * The seller's usual pickup times (spec row 52, B6), one editor for the sell
 * form and moving-out mode. They apply to all the seller's listings
 * (declutter_set_pickup_windows replaces the whole set).
 */
import { Button } from "@/components/ui/button";
import type { PickupWindow } from "@/lib/declutter/api";
import { WEEKDAYS } from "./declutterUi";

export function PickupTimesEditor({ windows, setWindows }: { windows: PickupWindow[]; setWindows: (f: (ws: PickupWindow[]) => PickupWindow[]) => void }) {
  return (
    <>
      <ul className="space-y-2">
        {windows.map((w, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <label className="sr-only" htmlFor={`pw-day-${i}`}>Day</label>
            <select id={`pw-day-${i}`} className="col-span-3 min-w-0 rounded-lg border border-input bg-background px-2 py-2 text-sm" value={w.weekday}
              onChange={(e) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}>
              {WEEKDAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}
            </select>
            <label className="sr-only" htmlFor={`pw-start-${i}`}>From</label>
            <input id={`pw-start-${i}`} type="time" className="w-full min-w-0 rounded-lg border border-input bg-background px-2 py-2 text-sm" value={w.starts}
              onChange={(e) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, starts: e.target.value } : x)))} />
            <span className="text-sm">to</span>
            <label className="sr-only" htmlFor={`pw-end-${i}`}>Until</label>
            <input id={`pw-end-${i}`} type="time" className="w-full min-w-0 rounded-lg border border-input bg-background px-2 py-2 text-sm" value={w.ends}
              onChange={(e) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, ends: e.target.value } : x)))} />
            {windows.length > 1 && (
              <button type="button" className="col-span-3 justify-self-start min-h-11 text-sm underline" onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}>Remove this time</button>
            )}
          </li>
        ))}
      </ul>
      {windows.length < 21 && (
        <Button type="button" variant="outline" size="sm"
          onClick={() => setWindows((ws) => [...ws, { weekday: 0, starts: "17:00", ends: "19:00" }])}>
          Add a time
        </Button>
      )}
    </>
  );
}
