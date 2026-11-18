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
import "@/lib/i18n/enListingParts";
import { getLang, t } from "@/lib/i18n/language";

/** Sell a bunch's intro; the moving sale gets its own (audit 11-10 F343: the two pages opened word for word alike). */
// Audit 11-10 F339: one short line (it was three long sentences before the seller had done anything). Words: lp.mv.*.
export const bunchIntro = (moving: boolean) => (moving ? t("lp.mv.intro") : t("lp.bv.intro"));

export function BunchMovingSale({ userId, date, setDate, today }: { userId: string; date: string; setDate: (d: string) => void; today: string }) {
  const qc = useQueryClient();
  const myDate = useQuery({ queryKey: ["declutter", "my-move-date", userId], queryFn: fetchMyMoveOutDate });
  const current = myDate.data ?? null;
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
      if (n === 0) setNote(t("lp.mv.noneUp"));
      else setNote(next === null ? t("lp.mv.ended") : n === 1 ? t("lp.mv.changed1") : t("lp.mv.changedN", { n }));
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
      <h2 id="bunch-move" className="text-base font-semibold">{t("lp.mv.head")}</h2>
      <div className="min-w-0">
        <label className="block text-sm font-medium" htmlFor="bunch-move-date">{t("lp.mv.date")} <span className="font-normal text-muted-foreground">{t("lp.mv.optional")}</span></label>
        <DatePickerField id="bunch-move-date" value={date} min={today} onChange={setDate} placeholder={t("lp.mv.pick")} />
      </div>
      <p className="text-xs text-muted-foreground">{t("lp.mv.how")}</p>
      {problem && <p className="text-xs text-destructive-ink" role="status" data-bunch-move-problem="">{problem}</p>}
      {current && date && date !== current && !problem && (
        <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={changing} onClick={() => void change(date)}>
          {changing ? t("lp.mv.changing") : t("lp.mv.change", { date: formatMoveDate(date, getLang() === "es") })}
        </Button>
      )}
      {current && <MovingSaleDetails userId={userId} moveOutOn={current} today={today} />}
      {/* Area 06b L9: hiring help and hauling away moved below the photo step (BunchMovingDayHelp); End the sale stays. */}
      {current && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={changing} onClick={() => setAskEnd(true)}>{t("lp.mv.end")}</Button>
        </div>
      )}
      {note && <p className="text-sm text-foreground" role="status" data-bunch-move-note="">{note}</p>}
      <ConfirmSheet open={askEnd} title={t("lp.mv.endQ")} confirmLabel={t("lp.mv.end")} pending={changing}
        onConfirm={() => { setAskEnd(false); void change(null); }} onClose={() => setAskEnd(false)} testId="move-end-sale">
        {t("lp.mv.endBody")}
      </ConfirmSheet>
    </section>
  );
}

/** A moving-day button whose words wrap (area 06b L9: the Spanish "Contratar a un Helpr…" ran out of the pill). */
const MOVING_DAY_BUTTON = "h-auto min-h-11 max-w-full whitespace-normal rounded-full py-2 text-left";

/**
 * Area 06b L9 (design audit 11-18): "Hire a Helpr for moving day" and "Haul away what's left", shown on the moving sale
 * BELOW the photo step (they sat above step 1, before the seller had listed anything). F343: still shown from the start,
 * with or without a date. The same reads (and keys) as BunchMovingSale, so no new request.
 */
export function BunchMovingDayHelp({ userId, date }: { userId: string; date: string }) {
  const myDate = useQuery({ queryKey: ["declutter", "my-move-date", userId], queryFn: fetchMyMoveOutDate });
  const items = useQuery({ queryKey: ["declutter", "move-items", userId], queryFn: () => fetchMyMoveItems(userId) });
  const current = myDate.data ?? null;
  // D4-6: the listed, unsold sale items "Haul away what's left" pre-fills (Post a job keeps the ones a haul-away takes).
  const haulIds = useMemo(() => (items.data ?? []).filter((i) => i.status === "live" || i.status === "paused").map((i) => i.id), [items.data]);
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4" aria-label={t("lp.mv.hire")} data-bunch-moving-day="">
      <p className="text-sm text-muted-foreground">{t("lp.mv.help")}</p>
      <div className="flex flex-wrap gap-2">
        {/* D4-6: both open a pre-filled job, never a blank Post a job. */}
        <Button asChild variant="outline" size="sm" className={MOVING_DAY_BUTTON}>
          <Link to={movingDayPostJobPath(current ?? date)}>{t("lp.mv.hire")}</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className={MOVING_DAY_BUTTON}>
          <Link to={haulIds.length > 0 ? haulAwayPostJobPath(haulIds) : movingDayPostJobPath(current ?? date)}>{t("lp.mv.haul")}</Link>
        </Button>
      </div>
    </section>
  );
}
