/**
 * Declutter top 5 #5 (owner 11-19): bulk actions on Selling. "Select" ticks listings (live or paused), then a bar under
 * the list offers % off, Pause, Put back on sale and Mark sold for all of them. % off is one server call
 * (declutter_bulk_discount: never below each listing's lowest price); the other three are the one-listing actions run
 * once per ticked listing, each with its own checks and notices, and the toast says how many went through.
 *
 * Post-merge check 11-20 (~/.lh-shots/declutter-top5-1120): the tick sits in the row beside the photo (BulkPick takes the
 * row's link as its child), Pause asks first like % off and Mark sold, and the floating "+ Sell" steps aside while the
 * bar is up (it covered the bar's right end).
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DeclutterItem } from "@/lib/declutter/api";
import { markSoldElsewhere, pauseListing, relistListing } from "@/lib/declutter/api";
import { BULK_PERCENTS, bulkDiscount } from "@/lib/declutter/sellerTools";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { HideSectionCreateFab } from "@/components/sections/createFabHidden";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { SectionHeading } from "./DeclutterTabHeads";
import "@/lib/i18n/enDeclTop5";
import { t } from "@/lib/i18n/language";

/** Which listings a bulk action may tick: the ones Manage acts on (for sale or paused). */
export const bulkPickable = (i: Pick<DeclutterItem, "status">) => i.status === "live" || i.status === "paused";

export function useBulkSelect() {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stop = () => { setSelecting(false); setPicked(new Set()); };
  /** Audit 11-20 night #8: after a bulk action some listings refused, only those stay ticked. */
  const keep = (ids: string[]) => setPicked(new Set(ids));
  return { selecting, start: () => setSelecting(true), stop, keep, picked, toggle };
}

/**
 * The row's link with, while selecting, its tick at the left of the photo on the same line (11-20 #3: it sat on a row
 * of its own above the card). Not selecting, or a listing that can't be ticked: the link alone, as before.
 */
export function BulkPick({ item, selecting, picked, onToggle, children }: { item: DeclutterItem; selecting: boolean; picked: boolean; onToggle: () => void; children: ReactNode }) {
  if (!selecting || !bulkPickable(item)) return <>{children}</>;
  return (
    <div className="-ml-3 flex min-w-0 flex-1 items-center" data-bulk-row={item.id}>
      {/* The shared Checkbox; the 44px label around it is the tap target (checkboxesAreEighteenPx). A firmer edge than
          the default so the empty box reads on the dark card (11-20 #3). */}
      <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center" data-bulk-pick={item.id}>
        <Checkbox checked={picked} onCheckedChange={onToggle} aria-label={t("dt5.bulk.pick", { title: item.title })}
          className="border-[hsl(var(--foreground)/0.55)]" />
      </label>
      {children}
    </div>
  );
}

/** Your listings' heading, with Select / Done once two or more listings can be ticked. */
export function BulkHeading({ title, items, bulk }: { title: string; items: DeclutterItem[]; bulk: ReturnType<typeof useBulkSelect> }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <SectionHeading title={title} />
      {items.filter(bulkPickable).length > 1 && (
        <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={bulk.selecting ? bulk.stop : bulk.start} data-bulk-toggle="">
          {bulk.selecting ? t("dt5.bulk.done") : t("dt5.bulk.select")}
        </Button>
      )}
    </div>
  );
}

type Action = "pause" | "resume" | "sold";

/** Runs one listing action over many, one at a time; how many went through. */
export async function runEach(ids: string[], act: (id: string) => Promise<unknown>): Promise<{ done: number; failed: number; failedIds: string[]; firstError: unknown }> {
  let done = 0;
  const failedIds: string[] = [];
  let firstError: unknown = null;
  for (const id of ids) {
    try {
      await act(id);
      done += 1;
    } catch (err) {
      // Each listing keeps its own refusal (a sold or reserved one cannot be paused). Audit 11-20 night #8: the
      // toast says the first reason and the refused listings stay ticked, so the seller sees which and why.
      if (failedIds.length === 0) firstError = err;
      failedIds.push(id);
    }
  }
  return { done, failed: failedIds.length, failedIds, firstError };
}

export function BulkBar({ items, picked, onDone, onKeep }: { items: DeclutterItem[]; picked: Set<string>; onDone: () => void; onKeep?: (failedIds: string[]) => void }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<"discount" | "sold" | "pause" | "resume" | null>(null);
  const [pct, setPct] = useState<number>(15);
  const chosen = items.filter((i) => picked.has(i.id) && bulkPickable(i));
  const live = chosen.filter((i) => i.status === "live").map((i) => i.id);
  const paused = chosen.filter((i) => i.status === "paused").map((i) => i.id);
  const finish = (done: number, total: number, failedIds: string[] = [], firstError: unknown = null) => {
    const failed = failedIds.length;
    toast(failed > 0 ? `${t("dt5.bulk.doneN", { n: done, total })} ${t("dt5.bulk.failedWhy", { n: failed, why: declutterErrorMessage(firstError) })}` : t("dt5.bulk.doneN", { n: done, total }));
    void qc.invalidateQueries({ queryKey: ["declutter"] });
    setAsking(null);
    if (failed > 0 && onKeep) onKeep(failedIds);
    else onDone();
  };
  const each = useMutation({
    mutationFn: async (a: Action) => {
      const ids = a === "pause" ? live : a === "resume" ? paused : chosen.map((i) => i.id);
      const act = a === "pause" ? pauseListing : a === "resume" ? relistListing : markSoldElsewhere;
      return { ...(await runEach(ids, act)), total: ids.length };
    },
    onSuccess: (r) => finish(r.done, r.total, r.failedIds, r.firstError),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const discount = useMutation({
    mutationFn: () => bulkDiscount(chosen.map((i) => i.id), pct),
    onSuccess: (n) => finish(n, chosen.length),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const busy = each.isPending || discount.isPending;
  if (chosen.length === 0) return null;
  return (
    // VERIFY 11-20 (low): on dark, bg-card with shadow-sm had no edge, so the list seemed to run under "2 selected". The
    // bar floats over the list, so it wears the elevated surface (--popover: the sheet tone, lifted on dark, the card
    // tone on light) and the sheet rung of the elevation ladder, with its border.
    <div className="sticky bottom-2 z-10 space-y-2 rounded-[20px] border border-border bg-popover p-3 shadow-[var(--shadow-elevated)]" role="group" aria-label={chosen.length === 1 ? t("dt5.bulk.count1") : t("dt5.bulk.countN", { n: chosen.length })} data-bulk-bar="">
      <HideSectionCreateFab />
      <p className="text-ds-13 font-semibold">{chosen.length === 1 ? t("dt5.bulk.count1") : t("dt5.bulk.countN", { n: chosen.length })}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setAsking("discount")} data-bulk-action="discount">{t("dt5.bulk.discount")}</Button>
        {live.length > 0 && <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setAsking("pause")} data-bulk-action="pause">{t("dt5.bulk.pause")}</Button>}
        {paused.length > 0 && <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setAsking("resume")} data-bulk-action="resume">{t("dt5.bulk.resume")}</Button>}
        <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setAsking("sold")} data-bulk-action="sold">{t("dt5.bulk.sold")}</Button>
      </div>
      <ConfirmSheet pair open={asking === "discount"} plain title={chosen.length === 1 ? t("dt5.bulk.discountTitle1") : t("dt5.bulk.discountTitle", { n: chosen.length })} confirmLabel={t("dt5.bulk.discountConfirm")}
        pending={discount.isPending} onConfirm={() => discount.mutate()} onClose={() => setAsking(null)} testId="declutter-bulk-discount">
        <span className="block space-y-3">
          <span className="block">{t("dt5.bulk.discountBody")}</span>
          <span role="group" aria-label={t("dt5.bulk.discount")} className="flex flex-wrap gap-2">
            {BULK_PERCENTS.map((p) => <ToggleChip key={p} pressed={pct === p} onClick={() => setPct(p)} data-bulk-pct={p}>{t("dt5.bulk.pctOff", { pct: p })}</ToggleChip>)}
          </span>
        </span>
      </ConfirmSheet>
      <ConfirmSheet pair open={asking === "sold"} destructive title={chosen.length === 1 ? t("dt5.bulk.soldTitle1") : t("dt5.bulk.soldTitle", { n: chosen.length })} confirmLabel={t("dt5.bulk.sold")}
        pending={each.isPending} onConfirm={() => each.mutate("sold")} onClose={() => setAsking(null)} testId="declutter-bulk-sold">
        {t("dt5.bulk.soldBody")}
      </ConfirmSheet>
      <ConfirmSheet pair open={asking === "pause"} plain title={live.length === 1 ? t("dt5.bulk.pauseTitle1") : t("dt5.bulk.pauseTitle", { n: live.length })}
        confirmLabel={t("dt5.bulk.pause")} pending={each.isPending} onConfirm={() => each.mutate("pause")} onClose={() => setAsking(null)} testId="declutter-bulk-pause">
        {t("dt5.bulk.pauseBody")}
      </ConfirmSheet>
      <ConfirmSheet pair open={asking === "resume"} plain title={paused.length === 1 ? t("dt5.bulk.resumeTitle1") : t("dt5.bulk.resumeTitle", { n: paused.length })}
        confirmLabel={t("dt5.bulk.resume")} pending={each.isPending} onConfirm={() => each.mutate("resume")} onClose={() => setAsking(null)} testId="declutter-bulk-resume">
        {t("dt5.bulk.resumeBody")}
      </ConfirmSheet>
    </div>
  );
}
