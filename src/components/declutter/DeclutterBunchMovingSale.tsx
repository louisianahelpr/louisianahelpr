/**
 * The moving sale on Sell a bunch (lead 2026-10-30, one flow: the room scan and the Move page are retired). An optional
 * move-out date: with it, what is listed here joins the seller's moving sale, shown together on their profile with the
 * date; without it, they are ordinary listings. A seller who already has a sale changes its date, names it, ends it,
 * or hires help for moving day here. Nothing closes when the date passes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatePickerField } from "@/components/DatePickerField";
import { Button } from "@/components/ui/button";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { haulAwayPostJobPath } from "@/lib/declutter/haulAwayLink";
import { movingDayPostJobPath } from "@/lib/declutter/movingDayJob";
import { fetchMyMoveItems, fetchMyMoveOutDate, formatMoveDate, moveDateProblem, setMoveOutDate } from "@/lib/declutter/moves";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { MovingSaleDetails } from "./DeclutterMovingSaleDetails";

export function BunchMovingSale({ userId, date, setDate, today }: { userId: string; date: string; setDate: (d: string) => void; today: string }) {
  const qc = useQueryClient();
  const myDate = useQuery({ queryKey: ["declutter", "my-move-date", userId], queryFn: fetchMyMoveOutDate });
  const items = useQuery({ queryKey: ["declutter", "move-items", userId], queryFn: () => fetchMyMoveItems(userId) });
  const current = myDate.data ?? null;
  // D4-6: the listed, unsold sale items "Haul away what's left" pre-fills (Post a job keeps the ones a haul-away takes).
  const haulIds = useMemo(() => (items.data ?? []).filter((i) => i.status === "live" || i.status === "paused").map((i) => i.id), [items.data]);
  const [note, setNote] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [askEnd, setAskEnd] = useState(false);

  // A seller with a sale adds to it, on its date.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !myDate.isSuccess) return;
    prefilled.current = true;
    if (myDate.data && !date) setDate(myDate.data);
  }, [myDate.isSuccess, myDate.data, date, setDate]);

  const problem = date ? moveDateProblem(date, today) : null;

  async function change(next: string | null) {
    setChanging(true);
    setNote(null);
    try {
      const n = await setMoveOutDate(next);
      if (n === 0) setNote("None of your moving-sale items are still up, so nothing changed.");
      else setNote(next === null ? "Moving sale ended. Your items stay up as ordinary listings." : `Move-out date changed on ${n} ${n === 1 ? "item" : "items"}.`);
      if (next === null) setDate("");
    } catch (err) {
      // Not silent: the refusal is shown beside these buttons, and the sale stays as it was.
      setNote(declutterErrorMessage(err));
    } finally {
      setChanging(false);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="bunch-move" data-bunch-move="">
      <h2 id="bunch-move" className="text-base font-semibold">Your move</h2>
      <div className="min-w-0">
        <label className="block text-sm font-medium" htmlFor="bunch-move-date">Move-out date <span className="font-normal text-muted-foreground">(optional)</span></label>
        <DatePickerField id="bunch-move-date" value={date} min={today} onChange={setDate} placeholder="Pick a date" />
      </div>
      <p className="text-xs text-muted-foreground">With a date, what you list here shows together as one moving sale on your profile, and buyers see the date. Without one, they're ordinary listings. Either way nothing is taken down when the date passes.</p>
      {problem && <p className="text-xs text-destructive-ink" role="status" data-bunch-move-problem="">{problem}</p>}
      {current && date && date !== current && !problem && (
        <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={changing} onClick={() => void change(date)}>
          {changing ? "Changing…" : `Change the date on my moving-sale items to ${formatMoveDate(date)}`}
        </Button>
      )}
      {current && <MovingSaleDetails userId={userId} moveOutOn={current} today={today} />}
      {(current || date) && (
        <div className="space-y-2 border-t border-border pt-3" data-bunch-moving-day="">
          <p className="text-sm text-muted-foreground">Need a hand carrying things out, or a truck for whatever doesn't sell? Hire a Helpr for the job.</p>
          <div className="flex flex-wrap gap-2">
            {/* D4-6: both open a pre-filled job, never a blank Post a job. */}
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link to={movingDayPostJobPath(current ?? date)}>Hire a Helpr for moving day</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link to={haulIds.length > 0 ? haulAwayPostJobPath(haulIds) : movingDayPostJobPath(current ?? date)}>Haul away what's left</Link>
            </Button>
            {current && (
              <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={changing} onClick={() => setAskEnd(true)}>End the moving sale</Button>
            )}
          </div>
        </div>
      )}
      {note && <p className="text-sm text-foreground" role="status" data-bunch-move-note="">{note}</p>}
      <ConfirmSheet open={askEnd} title="End the moving sale?" confirmLabel="End the moving sale" pending={changing}
        onConfirm={() => { setAskEnd(false); void change(null); }} onClose={() => setAskEnd(false)} testId="move-end-sale">
        Your items stay up as ordinary listings.
      </ConfirmSheet>
    </section>
  );
}
