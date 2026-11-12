/**
 * Sell a bunch: "List all my drafts" (audit finding 1). A seller whose items were saved as drafts (the setup fee was
 * due, a phone locked mid-run) had to open each one. This lists them together through publishMany, the same three calls
 * as one listing, after the same four confirmations; each refusal is named. While the setup fee is due only the free
 * drafts are offered (the server asks no fee at price 0); a priced one would be refused, and its refusal would stop the
 * rest (publishMany), so those wait. Drafts still on the Check-each-item list stay with that list (exclude). Each is named
 * with a tick (audit 10-30, finding 14); one with no photos is linked, not listed: it would spend a photo check, then be refused.
 * The page has one set of statements: with items on the list they sit in its last step and count here too; only with no
 * list is the tick here.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchPhotos } from "@/lib/declutter/api";
import { publishMany, type PublishOutcome } from "@/lib/declutter/moves";
import { myItemsQuery } from "./myItemsQuery";
import { TaxStatementsCheck } from "./declutterUi";
import "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

export function BunchDraftsSection({ userId, exclude, busy, feeDue, onBusy, attested, setAttested, listStepShown, onPricedOffered }: { userId: string; exclude: ReadonlySet<string>; busy: boolean; feeDue: boolean; onBusy: (on: boolean) => void; attested: boolean; setAttested: (on: boolean) => void; listStepShown: boolean; onPricedOffered: (on: boolean) => void }) {
  const qc = useQueryClient();
  const mine = useQuery(myItemsQuery(userId));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [results, setResults] = useState<{ title: string; outcome: PublishOutcome }[] | null>(null);
  const saved = (mine.data ?? []).filter((i) => i.status === "draft" && !exclude.has(i.id));
  const drafts = feeDue ? saved.filter((i) => i.current_price_cents === 0) : saved;
  const waiting = saved.length - drafts.length;
  // The one tick covers these too, so a priced draft on offer means the page shows the four statements.
  const anyPriced = drafts.some((d) => d.current_price_cents > 0);
  useEffect(() => onPricedOffered(anyPriced), [anyPriced, onPricedOffered]);
  const ids = drafts.map((d) => d.id);
  const photos = useQuery({ queryKey: ["declutter", "draft-photos", ids.join(",")], queryFn: () => fetchPhotos(ids), enabled: ids.length > 0 });
  const withPhotos = new Set((photos.data ?? []).map((p) => p.item_id));
  // Until the count is read (or if it can't be), nothing is held back: the server still refuses a draft with no photos.
  const noPhotos = (id: string) => photos.isSuccess && !withPhotos.has(id);
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(() => new Set());
  const going = drafts.filter((d) => !noPhotos(d.id) && !leftOut.has(d.id));

  async function listAll() {
    setProblem(null);
    if (!attested) {
      setProblem(listStepShown ? t("lp.dr.tickBelow") : t("lp.dr.tick"));
      document.getElementById(listStepShown ? "bunch-tax" : "bunch-drafts-tax")?.focus();
      return;
    }
    const titles = new Map(going.map((d) => [d.id, d.title]));
    onBusy(true);
    setProgress({ done: 0, total: going.length });
    try {
      const out = await publishMany(going.map((d) => d.id), (done, total) => setProgress({ done, total }));
      setResults(out.map((outcome) => ({ title: titles.get(outcome.id) ?? t("lp.rs.anItem"), outcome })));
    } catch (err) {
      // Not silent: publishMany returns each refusal, so this is a fault around it; shown beside the button.
      setProblem(declutterErrorMessage(err));
    } finally {
      setProgress(null);
      onBusy(false);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  const failed = (results ?? []).filter((r) => "error" in r.outcome);
  const listed = (results?.length ?? 0) - failed.length;
  if (drafts.length === 0 && !results) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="bunch-drafts" data-bunch-drafts="">
      <h2 id="bunch-drafts" className="text-base font-semibold">{t("lp.dr.head")}</h2>
      {drafts.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {t(feeDue ? (drafts.length === 1 ? "lp.dr.haveFree1" : "lp.dr.haveFreeN") : drafts.length === 1 ? "lp.dr.have1" : "lp.dr.haveN", { n: drafts.length })}{" "}
            {t("lp.dr.together")} {t(listStepShown ? "lp.dr.oneTickBelow" : "lp.dr.oneTick")}
            {waiting > 0 && ` ${waiting === 1 ? t("lp.dr.waits1") : t("lp.dr.waitsN", { n: waiting })}`}
          </p>
          <ul className="space-y-1" data-bunch-drafts-list="">
            {drafts.map((d) => (
              <li key={d.id} className="flex min-h-11 items-center gap-3 text-sm">
                {noPhotos(d.id) ? (
                  <>
                    <span className="min-w-0 flex-1 break-words">{d.title}</span>
                    <Link className="shrink-0 underline" to={`/declutter/sell?item=${d.id}`} aria-label={t("lp.dr.addAria", { name: d.title })}>{t("lp.bv.addPhotos")}</Link>
                  </>
                ) : (
                  <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                    <Checkbox checked={!leftOut.has(d.id)} onCheckedChange={(v) => setLeftOut((s) => { const n = new Set(s); if (v === true) n.delete(d.id); else n.add(d.id); return n; })} />
                    <span className="min-w-0 break-words">{d.title}</span>
                  </label>
                )}
              </li>
            ))}
          </ul>
          {!listStepShown && <TaxStatementsCheck id="bunch-drafts-tax" checked={attested} onChange={setAttested} />}
          {problem && <p className="text-sm text-destructive-ink" role="alert">{problem}</p>}
          <Button type="button" className="rounded-full" disabled={busy || going.length === 0} onClick={() => void listAll()}>
            {progress ? t("lp.dr.listing", { at: Math.min(progress.done + 1, progress.total), n: progress.total }) : going.length === drafts.length ? (feeDue ? t("lp.dr.listFree") : t("lp.dr.listAll")) : going.length === 1 ? t("lp.dr.list1") : t("lp.dr.listN", { n: going.length })}
          </Button>
        </>
      )}
      {results && (
        <div className="space-y-1 text-sm" data-bunch-drafts-done="">
          {listed > 0 && <p>{t("lp.dr.listed", { n: listed })}</p>}
          {failed.map((f, i) => (
            <p key={i}><span className="font-semibold">{f.title}</span> {t("lp.rs.notListed")} {declutterErrorMessage((f.outcome as { error: unknown }).error)}</p>
          ))}
        </div>
      )}
    </section>
  );
}
