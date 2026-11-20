/**
 * Declutter top 5 #5 (owner 11-19): bulk actions on Selling. "Select" ticks listings (live or paused), then a bar under
 * the list offers % off, Pause, Put back on sale and Mark sold for all of them. % off is one server call
 * (declutter_bulk_discount: never below each listing's lowest price); the other three are the one-listing actions run
 * once per ticked listing, each with its own checks and notices, and the toast says how many went through.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DeclutterItem } from "@/lib/declutter/api";
import { markSoldElsewhere, pauseListing, relistListing } from "@/lib/declutter/api";
import { BULK_PERCENTS, bulkDiscount } from "@/lib/declutter/sellerTools";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleChip } from "@/components/ui/ToggleChip";
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
  return { selecting, start: () => setSelecting(true), stop, picked, toggle };
}

export function BulkPick({ item, picked, onToggle }: { item: DeclutterItem; picked: boolean; onToggle: () => void }) {
  if (!bulkPickable(item)) return null;
  return (
    // The shared Checkbox; the 44px label row around it is the tap target (checkboxesAreEighteenPx).
    <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center" data-bulk-pick={item.id}>
      <Checkbox checked={picked} onCheckedChange={onToggle} aria-label={t("dt5.bulk.pick", { title: item.title })} />
    </label>
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
export async function runEach(ids: string[], act: (id: string) => Promise<unknown>): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await act(id);
      done += 1;
    } catch (err) {
      // Each listing keeps its own refusal (a sold or reserved one cannot be paused); the toast counts them.
      failed += 1;
      void err;
    }
  }
  return { done, failed };
}

export function BulkBar({ items, picked, onDone }: { items: DeclutterItem[]; picked: Set<string>; onDone: () => void }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<"discount" | "sold" | null>(null);
  const [pct, setPct] = useState<number>(15);
  const chosen = items.filter((i) => picked.has(i.id) && bulkPickable(i));
  const live = chosen.filter((i) => i.status === "live").map((i) => i.id);
  const paused = chosen.filter((i) => i.status === "paused").map((i) => i.id);
  const finish = (done: number, total: number, failed: number) => {
    toast(failed > 0 ? `${t("dt5.bulk.doneN", { n: done, total })} ${t("dt5.bulk.someFailed", { n: failed })}` : t("dt5.bulk.doneN", { n: done, total }));
    void qc.invalidateQueries({ queryKey: ["declutter"] });
    setAsking(null);
    onDone();
  };
  const each = useMutation({
    mutationFn: async (a: Action) => {
      const ids = a === "pause" ? live : a === "resume" ? paused : chosen.map((i) => i.id);
      const act = a === "pause" ? pauseListing : a === "resume" ? relistListing : markSoldElsewhere;
      return { ...(await runEach(ids, act)), total: ids.length };
    },
    onSuccess: (r) => finish(r.done, r.total, r.failed),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const discount = useMutation({
    mutationFn: () => bulkDiscount(chosen.map((i) => i.id), pct),
    onSuccess: (n) => finish(n, chosen.length, 0),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const busy = each.isPending || discount.isPending;
  if (chosen.length === 0) return null;
  return (
    <div className="sticky bottom-2 z-10 space-y-2 rounded-[20px] border border-border bg-card p-3 shadow-sm" role="group" aria-label={t("dt5.bulk.countN", { n: chosen.length })} data-bulk-bar="">
      <p className="text-ds-13 font-semibold">{chosen.length === 1 ? t("dt5.bulk.count1") : t("dt5.bulk.countN", { n: chosen.length })}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setAsking("discount")} data-bulk-action="discount">{t("dt5.bulk.discount")}</Button>
        {live.length > 0 && <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => each.mutate("pause")} data-bulk-action="pause">{t("dt5.bulk.pause")}</Button>}
        {paused.length > 0 && <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => each.mutate("resume")} data-bulk-action="resume">{t("dt5.bulk.resume")}</Button>}
        <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => setAsking("sold")} data-bulk-action="sold">{t("dt5.bulk.sold")}</Button>
      </div>
      <ConfirmSheet open={asking === "discount"} plain title={t("dt5.bulk.discountTitle", { n: chosen.length })} confirmLabel={t("dt5.bulk.discountConfirm")}
        pending={discount.isPending} onConfirm={() => discount.mutate()} onClose={() => setAsking(null)} testId="declutter-bulk-discount">
        <span className="block space-y-3">
          <span className="block">{t("dt5.bulk.discountBody")}</span>
          <span role="group" aria-label={t("dt5.bulk.discount")} className="flex flex-wrap gap-2">
            {BULK_PERCENTS.map((p) => <ToggleChip key={p} pressed={pct === p} onClick={() => setPct(p)} data-bulk-pct={p}>{t("dt5.bulk.pctOff", { pct: p })}</ToggleChip>)}
          </span>
        </span>
      </ConfirmSheet>
      <ConfirmSheet open={asking === "sold"} destructive title={t("dt5.bulk.soldTitle", { n: chosen.length })} confirmLabel={t("dt5.bulk.sold")}
        pending={each.isPending} onConfirm={() => each.mutate("sold")} onClose={() => setAsking(null)} testId="declutter-bulk-sold">
        {t("dt5.bulk.soldBody")}
      </ConfirmSheet>
    </div>
  );
}
