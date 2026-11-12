/**
 * A NEW listing on ONE screen (owner 2026-10-29: "ai should always be doing most of the work for declutter
 * listing"). Top to bottom: the photos (Claude runs by itself on the first ones; its cover pick moves first and
 * its photo tip shows in the panel), Claude's listing as a summary card with an "Edit <field>" per row, the price
 * Free tick under Price, a few words on what the seller's settings will do (owner 2026-10-30: chosen ahead, in
 * SellerSetup and Settings; one listing's are changed in Manage after it's posted), the tax box, and ONE
 * "Post it" that runs the same list path as a draft's "List it" (useSellFlowState.onPublish). A saved draft
 * (?item=) keeps the step form (DeclutterSellView).
 *
 * What still blocks Post is said only once it is tapped (audit #45): IN the row that needs it (audit DC-2: with
 * drops on and no lowest price it scrolled to Price but printed the words only by the button, off screen), and the
 * screen scrolls to that row. By the button a short pointer says to fix what is marked above.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { DECLUTTER_MIN_PHOTOS } from "@/lib/declutter/photoRules";
import { StepHead } from "./DeclutterSellSteps";
import { MAX_PHOTOS, SellPhotos } from "./DeclutterSellPhotos";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { SellItForMeEntry } from "./SellItForMe";
import { SellAiDraftPanel } from "./SellAiDraft";
import { DeclutterNotice } from "./declutterUi";
import { formProblem } from "./sellForm";
import { dropsValue, makeFreeValue, SellingSettingsRows, usePickupLines } from "./SellingSettingsRows";
import { SellFreeNote, SellOffersToggle, SellTaxBox } from "./SellFormParts";
import { SellProgress, postStepOf } from "./SellProgress";
import { SellSummaryCard, type SummaryField } from "./SellSummaryCard";
import { useSellFlowState, type SellFlow } from "./useSellFlowState";
import { photoPublicUrl } from "@/lib/declutter/api";
import { BuyerPreviewCard } from "./BuyerPreviewCard";
import { DEFAULT_DROP_PCT } from "@/lib/declutter/priceDrop";
import "@/lib/i18n/enSellForm";
import { t as tr, useLanguage } from "@/lib/i18n/language";

type Where = "photos" | SummaryField | "settings" | "tax";

/**
 * The first thing that blocks Post, top to bottom, and the row it belongs to. While the AI is writing, the title and
 * price it is about to fill are not problems yet (audit posting 1030 #7: tapping Post then said "Give the item a name").
 */

function postProblems(s: SellFlow): { message: string; at: Where }[] {
  const out: { message: string; at: Where }[] = [];
  if (s.photoTotal < DECLUTTER_MIN_PHOTOS) out.push({ message: DECLUTTER_MIN_PHOTOS === 1 ? tr("sf.addPhotoOne") : tr("sf.addPhotos", { n: DECLUTTER_MIN_PHOTOS }), at: "photos" });
  const writing = s.ai.state.status === "busy";
  // formProblem says the first thing wrong; each answered in turn, so all of them are marked at once (audit posting 1030 #19).
  let probe = writing ? { ...s.form, title: s.form.title.trim() || "Being written", price: s.form.price || "100", floor: s.form.floor || "1" } : s.form;
  for (let f = formProblem(probe); f; f = formProblem(probe)) {
    const at: Where = /name/i.test(f) ? "title" : /price|lowest|drops/i.test(f) ? "price" : "settings";
    out.push({ message: f, at });
    if (at === "settings") break;
    probe = at === "title" ? { ...probe, title: "Answered" } : { ...probe, price: "100", floor: "1", dropPct: DEFAULT_DROP_PCT };
  }
  if (s.savedWays.length === 0 && !out.some((p) => p.at === "settings")) out.push({ message: tr("sf.chooseWay"), at: "settings" });
  // Nobody buys a give-away (audit 1110 F340): that form names the person picking it up.
  if (!writing && !s.sizeKnown) out.push({ message: tr(s.form.free ? "sf.sizeProblemFree" : "sf.sizeProblem"), at: "size" });
  if (!s.attested) out.push({ message: tr("sf.tickBox"), at: "tax" });
  return out;
}

/** What buyers will see, just above Post (audit posting 1030 #18): the cover, the title and the price. */
function BuyerPreview({ s }: { s: SellFlow }) {
  const cover = s.photos.data?.[0];
  const heldCover = cover ? null : s.held[0];
  const url = useMemo(() => (heldCover ? URL.createObjectURL(heldCover) : null), [heldCover]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const title = s.form.title.trim();
  if (!title || (!cover && !heldCover)) return null;
  const src = cover ? photoPublicUrl(cover.storage_path) : url;
  // Only a stored photo or a local blob: preview (CodeQL js/xss-through-dom; the PhotoProof pattern).
  return <BuyerPreviewCard src={src && (cover || src.startsWith("blob:")) ? src : null} title={title} cents={s.form.free ? 0 : (s.priceCents || null)} />;
}

/** Start over (a listing brought back from this device): a fresh form, with the seller's saved settings read again. */
export function SellOneScreen() {
  const [run, setRun] = useState(0);
  return <SellOneForm key={run} onStartOver={() => setRun((r) => r + 1)} />;
}

function SellOneForm({ onStartOver }: { onStartOver: () => void }) {
  const s = useSellFlowState(null);
  useLanguage(); // re-render in the member's language when it changes or loads (F260q)
  const { user, underAge, form, held, setHeld, photos, uploading, aiAsk, ai, savedWays, windows, autoFreeWanted } = s;
  // LEAD-POST-PLACES (owner 2026-10-31): with saved places, each shows with its own days and hours, not one area.
  const pickup = usePickupLines(savedWays, form.areaLabel, windows);
  const [open, setOpen] = useState<SummaryField | null>(null);
  const [tried, setTried] = useState(false);
  // Post was tapped while the AI was still writing: it posts by itself when that finishes, unless something is missing.
  const [postWhenWritten, setPostWhenWritten] = useState(false);
  const writing = ai.state.status === "busy";
  const postNow = useRef<() => void>(() => {});
  useEffect(() => {
    if (!postWhenWritten || writing) return;
    // After this commit's own effects: the lowest price follows the AI's price in one (useSellerDefaultsPrefill).
    const t = setTimeout(() => {
      setPostWhenWritten(false);
      postNow.current();
    }, 0);
    return () => clearTimeout(t);
  }, [postWhenWritten, writing]);

  if (!user) return null;
  if (underAge) {
    return (
      <AppPage title={tr("sf.sellAnItem")} backTo="/declutter">
        <DeclutterNotice tone="warn" title={tr("sf.underAgeTitle")}>
          {tr("sf.underAgeBody")}
        </DeclutterNotice>
      </AppPage>
    );
  }

  const problems = postProblems(s);
  const bad = problems[0] ?? null;
  /** The words for what blocks Post, shown in the row they belong to once Post was tapped. */
  const problemAt = (at: Where): ReactNode => {
    const here = tried ? problems.find((p) => p.at === at) : null;
    return here ? <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-testid="sell-form-problem" data-problem-at={at}>{here.message}</p> : null;
  };
  const post = () => {
    if (bad) {
      setTried(true);
      if (bad.at === "title" || bad.at === "price" || bad.at === "size") setOpen(bad.at);
      requestAnimationFrame(() => document.querySelector(`[data-sell-row="${bad.at}"]`)?.scrollIntoView?.({ block: "center" }));
      return;
    }
    if (writing) {
      setTried(false);
      setPostWhenWritten(true);
      return;
    }
    void s.onPublish();
  };
  postNow.current = post;

  return (
    // Audit 11-10 F341: a giveaway keeps its title on a phone too, so the first heading there is not just "Show it off".
    <AppPage title={tr(form.free ? "sf.giveItAway" : "sf.sellAnItem")} backTo="/declutter?tab=selling" phoneHidesTitle={!form.free}>
      <div className="mx-auto w-full max-w-xl space-y-6" data-sell-one-screen="">
        {s.keptWork.restored && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[20px] border border-border bg-card p-4" data-sell-kept="">
            <p className="min-w-0 flex-1 text-ds-14 font-semibold text-foreground">{tr("sf.kept")}</p>
            <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => void s.keptWork.finish().then(onStartOver)}>{tr("sf.startOver")}</Button>
          </div>
        )}
        {s.keptWork.note && <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-sell-not-kept="">{s.keptWork.note}</p>}

        <section className="space-y-4" aria-labelledby="sell-step" data-sell-row="photos">
          <StepHead title={tr("sf.showItOff")} sub={tr(DECLUTTER_MIN_PHOTOS === 1 ? "sf.photosSubOne" : "sf.photosSub", { n: DECLUTTER_MIN_PHOTOS, max: MAX_PHOTOS })} />
          <SellPhotos
            uploaded={photos.data ?? []}
            held={held}
            onFiles={(f) => void s.onFiles(f)}
            onRemoveUploaded={(photoId) => void s.onRemovePhoto(photoId)}
            onRemoveHeld={(i) => setHeld((h) => h.filter((_, j) => j !== i))}
            uploading={uploading}
            heldFailed={s.failedHeld > 0}
            refusedNote={s.refusedNote}
            onMakeCover={s.makeCover}
            onReorderHeld={s.reorderHeld}
            coverUndo={s.coverUndo ? s.undoCover : null}
            free={form.free}
            tipDone={ai.state.status === "done" || s.keptWork.restored}
            aiPanel={aiAsk || ai.state.status !== "idle" ? <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} oneScreen free={form.free} /> : null}
          />
          {/* "Sell it for me" (owner 2026-10-19): a new listing only, never on a draft already started. */}
          {!form.free && ai.state.status !== "done" && !s.keptWork.restored && <SellItForMeEntry />}
          {problemAt("photos")}
        </section>

        <SellSummaryCard
          s={s}
          open={open}
          setOpen={setOpen}
          problems={{ title: problemAt("title"), price: problemAt("price"), size: problemAt("size") }}
          // LEAD-FREE-MOVE (owner 2026-10-31): "Give it away free" is a choice on the sell chooser's first screen
          // (?free=1), not a tick on the Price row; a free listing's row says what free means and offers "Charge for it".
          // LEAD-OFFERS-CHOICE part (2): a priced listing's row has its own Accept offers switch.
          priceExtras={form.free ? <div className="pt-1"><SellFreeNote /></div> : <div className="pt-1"><SellOffersToggle s={s} /></div>}
          // What will happen, before Post (owner 2026-11-01): the seller's settings as rows of this card, one Change to
          // Settings. The choices themselves are made ahead (owner 2026-10-30).
          settingsRows={(
            <SellingSettingsRows
              pickup={pickup}
              drops={form.free ? null : dropsValue(form)}
              makeFree={form.free ? null : makeFreeValue(autoFreeWanted)}
              problem={problemAt("settings")}
            />
          )}
        />

        <div className="space-y-2" data-sell-row="tax"><SellTaxBox s={s} />{problemAt("tax")}</div>

        <BuyerPreview s={s} />
        {s.failedHeld > 0 && (
          <div role="alert" className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-photo-trouble="">
            <p className="text-ds-15 font-semibold text-foreground">{s.failedHeld === 1 ? tr("sf.onePhotoFailed") : tr("sf.photosFailed", { n: s.failedHeld })}. {tr("sf.notUpYet")}</p>
            {s.photoFailure && <p className="text-ds-14 text-muted-foreground [overflow-wrap:anywhere]">{s.photoFailure}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" className="rounded-full" onClick={() => void s.onPublish()}>{tr("sf.tryAgain")}</Button>
              {s.photoCount > 0 && (
                <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => void s.onPublish({ withoutFailed: true })}>
                  {s.photoCount === 1 ? tr("sf.postWithOne") : tr("sf.postWith", { n: s.photoCount })}
                </Button>
              )}
            </div>
          </div>
        )}
        {/* LEAD-POST-SLOW (owner 2026-10-31: "Post it does nothing"): the pointer by the button names what blocks Post, so a
            tap whose marked row is out of sight is never a tap that did nothing. */}
        {tried && bad && <p className="text-ds-13 font-semibold text-destructive-ink" data-testid="sell-form-pointer">{tr("sf.notPosted", { problem: bad.message })}</p>}
        {postWhenWritten && (
          <div className="flex flex-wrap items-center justify-between gap-2" role="status" data-post-when-written="">
            <p className="min-w-0 flex-1 text-ds-14 text-foreground">{tr("sf.stillWriting")}</p>
            <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setPostWhenWritten(false)}>{tr("sf.dontPostYet")}</Button>
          </div>
        )}
        {/* Owner 2026-11-01: while it goes up, a clear in-progress view (Uploading photos -> Checking -> Live), not only a
            greyed button; the done view after is unchanged. */}
        {s.publishing && <SellProgress title={tr("sf.posting")} rows={[{ name: form.title.trim() || tr("sf.yourItem"), step: postStepOf(s.postStep) }]} note={s.postStep ? `${s.postStep}. ${tr("sf.keepOpen")}` : tr("sf.keepOpen")} />}
        <Button type="button" className="w-full rounded-full" disabled={s.publishing || s.saving || postWhenWritten} onClick={post}>
          {s.publishing ? (s.postStep ?? tr("sf.postingShort")) : tr("sf.postIt")}
        </Button>
        <p role="status" className="sr-only" data-post-step="">{s.publishing ? s.postStep : ""}</p>
        {/* Payouts: only once money is owed (owner 2026-10-27, list first, set up at first sale); never on a give-away,
            which earns nothing (audit 1110 F340). Audit 11-10 F327: under Post it, not over the form: it arrives after
            its reads and pushed the whole form down (layout shift 0.169). */}
        {!form.free && <SellerPayoutPrompt />}
      </div>
    </AppPage>
  );
}
