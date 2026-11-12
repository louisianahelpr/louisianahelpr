/**
 * /declutter/sell?item=<draft id> — a SAVED draft is finished in FIVE steps (boards 31a,
 * 48, 31b, 49, 158; spec v2 §3 "Step-by-step flows"; rows 31, 32, 34, 52, 54,
 * 56, 23, 53). A NEW listing (no ?item=) is ONE screen instead (SellOneScreen, owner 2026-10-29:
 * "ai should always be doing most of the work for declutter listing"). Both share their state and
 * server calls (useSellFlowState) and their field groups (SellFormParts):
 *   1. Show it off: photos, at least 1 up to 12 (DeclutterSellPhotos.tsx),
 *      cleaned of location data before upload (src/lib/declutter/photos.ts).
 *      Claude drafts the details from them (row 32; SellAiDraft.tsx); it also
 *      checks for banned items (row 34), which the server keeps.
 *   2. What is it: title, category, condition, size, notes.
 *   3. Price + the private lowest price (row 56, B3), with the real nightly
 *      drop rule drawn (priceDrop.ts); never a promised schedule.
 *   4. How buyers get it: porch pickup (row 101), the area label (never a
 *      street address), the private pickup address and pickup times (row 52).
 *      Continue SAVES the draft (declutter_update_draft).
 *   5. Ready to list: the preview, ONE tax checkbox stating the four facts
 *      (row 54; owner 2026-10-28; attestItem records all four), List it
 *      (live, or waiting for a review: row 33).
 * Under 18 (row 53) and missing payout setup (row 23) show as plain-English
 * blocks, never as dead buttons; the server refuses both anyway.
 */
import { useState } from "react";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { SuggestCategory } from "@/components/SuggestCategory";
import { photoPublicUrl, type DeliverySize } from "@/lib/declutter/api";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { ChipGroup, ReviewRow, StepHead, dropRunTime } from "./DeclutterSellSteps";
import { KeepUpSwitch } from "./KeepUpRow";
import { AutoFreeRow } from "./AutoFreeRow";
import { CATEGORY_GROUPS, CATEGORY_LABEL, CONDITION_LABEL, DeclutterNotice, SIZE_LABEL } from "./declutterUi";
import { CategoryDrillDown } from "./CategoryDrillDown";
import { DECLUTTER_MIN_PHOTOS } from "@/lib/declutter/photoRules";
import { pickupWindowsProblem } from "./DeclutterPickupTimes";
import PriceHint from "./DeclutterPriceHint";
import { MAX_PHOTOS, SellPhotos } from "./DeclutterSellPhotos";
import { SellAiDraftPanel } from "./SellAiDraft";
import { handoverSummary, wayTitle } from "./SellHandoverChoices";
import { sellStepProblem } from "./sellForm";
import { FieldLabel, SELL_INPUT, SellDropsCard, SellFreeToggle, SellPriceInput, SellTaxBox, SellWaysFields, SellYouGet } from "./SellFormParts";
import { SellOneScreen } from "./SellOneScreen";
import { useSellFlowState } from "./useSellFlowState";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import "@/lib/i18n/enSellForm";
import "@/lib/i18n/enListingParts";
import "@/lib/i18n/enDeclutter";
import type { MsgKey } from "@/lib/i18n/en";
import { t as tr, useLanguage } from "@/lib/i18n/language";

export default function SellFlow() {
  const [params] = useSearchParams();
  const itemId = params.get("item");
  // Owner 2026-10-29: a NEW listing is one screen; only a saved draft keeps the steps.
  if (!itemId) return <SellOneScreen />;
  return <SellSteps itemId={itemId} />;
}

function SellSteps({ itemId }: { itemId: string }) {
  const navigate = useNavigate();
  useLanguage(); // re-render in the member's language when it changes or loads (F260q)
  const s = useSellFlowState(itemId);
  const { user, underAge, item, photos, form, set, saving, uploading, held, setHeld, aiAsk, ai, keepUp, savedWays, windows, photoCount, priceCents, floorCents, hintAt } = s;
  // Audit #45: Continue is always a live button, so what a step still needs is said once it is tapped, beside it,
  // not printed in advance under a button that looks ready (it read as a disabled future step).
  const [triedStep, setTriedStep] = useState<number | null>(null);
  // Board 31a-158: which of the 5 steps is on screen.
  const [step, setStep] = useState(1);

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
  if (itemId && item.data && item.data.status !== "draft") {
    return (
      <AppPage title={tr("sf.sellAnItem")} backTo="/declutter?view=selling">
        <DeclutterNotice title={tr("sf.ds.alreadyListed")}>
          <Link to={`/declutter/item/${itemId}`} className="underline">{tr("sf.ds.seeListing")}</Link>
        </DeclutterNotice>
      </AppPage>
    );
  }

  const photoTotal = s.photoTotal;
  // Step 4 also needs pickup times the server takes (1-21, each ending after it starts).
  const stepProblem = sellStepProblem(step, form, photoTotal)
    ?? (step === 4 && savedWays.length === 0 ? tr("sf.ds.tickWay") : null)
    ?? (step === 4 ? pickupWindowsProblem(windows) : null);
  const next = async () => {
    if (stepProblem) {
      setTriedStep(step);
      return;
    }
    // Step 4 saves the draft (and uploads the photos held on the device), so step 5 lists a real draft.
    if (step === 4) {
      const saved = await s.saveDetails();
      if (!saved) return;
    }
    setStep((n) => Math.min(5, n + 1));
    window.scrollTo?.({ top: 0 });
  };
  const back = () => (step > 1 ? setStep((n) => n - 1) : navigate("/declutter?tab=selling"));
  return (
    <AppPage title={tr("sf.sellAnItem")} onBack={back} phoneHidesTitle>
      {/* Board 31a/48/31b/49/158: one question per step, "n of 5" progress (spec §3 "Step-by-step flows"). */}
      <div className="mx-auto w-full max-w-xl space-y-5">
      <div className="flex items-center gap-3" data-sell-progress={step}>
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`h-1 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>
        <span className="text-ds-13 font-semibold text-muted-foreground">{tr("sf.ds.stepOf", { step, total: 5 })}</span>
      </div>

      {step === 1 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title={tr("sf.showItOff")} sub={tr(DECLUTTER_MIN_PHOTOS === 1 ? "sf.ds.photosSubOne" : "sf.ds.photosSub", { n: DECLUTTER_MIN_PHOTOS, max: MAX_PHOTOS })} />
          <SellPhotos
            uploaded={photos.data ?? []}
            held={held}
            onFiles={(f) => void s.onFiles(f)}
            onRemoveUploaded={(photoId) => void s.onRemovePhoto(photoId)}
            onRemoveHeld={(i) => setHeld((h) => h.filter((_, j) => j !== i))}
            uploading={uploading}
            aiPanel={aiAsk || ai.state.status !== "idle" ? <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} /> : null}
          />
        </section>
      )}

      {/* Payouts: only once money is owed (owner 2026-10-27, list first, set up at first sale). Audit 11-10 F327: under
          the step, so its late arrival pushes nothing down. */}
      {step === 1 && <SellerPayoutPrompt />}

      {step === 2 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title={tr("sf.ds.whatIsIt")} sub={tr("sf.ds.whatIsItSub")} />
          <div className="space-y-2">
            <FieldLabel htmlFor="sell-title" text={tr("sf.ds.title")} />
            <Input look="card" id="sell-title" maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={tr("sf.ds.titlePh")} />
          </div>
          <CategoryDrillDown label={tr("sf.ds.category")} groups={CATEGORY_GROUPS} value={form.category} onChange={(v) => set("category", v)} />
          {/* I1 (Q1836 a): same link as the one-screen form (SellSummaryCard). */}
          <SuggestCategory area="declutter" />
          <ChipGroup label={tr("sf.ds.condition")} options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: tr(`decl.cond.${n}` as MsgKey) }))} value={String(form.conditionStars)} onChange={(v) => set("conditionStars", Number(v))} />
          <ChipGroup label={tr("sf.ds.size")} options={(Object.keys(SIZE_LABEL) as DeliverySize[]).map((k) => ({ value: k, label: tr(`decl.size.${k}`) }))} value={form.deliverySize} onChange={(v) => set("deliverySize", v as DeliverySize)} />
          <div className="space-y-2">
            <FieldLabel htmlFor="sell-desc" text={tr("sf.ds.anythingElse")} extra={tr("sf.ds.optional")} />
            <Textarea id="sell-desc" className={`${SELL_INPUT} h-auto py-3`} rows={4} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={tr("sf.ds.descPh")} />
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title={tr("sf.ds.priceQ")} sub={tr(form.free ? "sf.ds.priceSubFree" : "sf.ds.priceSub")} />
          <SellFreeToggle s={s} />
          {!form.free && (<>
            <SellPriceInput s={s} />
            <SellDropsCard s={s} />
          </>)}
          {!form.free && <PriceHint
            category={form.category}
            conditionStars={form.conditionStars}
            place="near_you"
            at={hintAt}
          />}
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title={tr("sf.ds.waysQ")} sub={tr("sf.ds.waysSub")} />
          <SellWaysFields s={s} />
        </section>
      )}

      {step === 5 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title={tr("sf.ds.readyQ")} sub={tr("sf.ds.readySub")} />
          <div className="rounded-[20px] border border-border bg-card p-4 space-y-2" data-sell-preview="">
            {photos.data?.[0] && (
              <img src={photoPublicUrl(photos.data[0].storage_path)} alt="" className="aspect-[16/10] w-full rounded-2xl object-cover bg-photo-empty" />
            )}
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-ds-17 font-bold text-foreground">{form.title.trim()}</p>
              {(form.free || priceCents) && <p className="shrink-0 text-ds-17 font-bold text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(form.free ? 0 : (priceCents as number))}</p>}
            </div>
            <p className="text-ds-13 text-muted-foreground">
              {[CONDITION_LABEL[form.conditionStars] ? tr(`decl.cond.${form.conditionStars}` as MsgKey) : "", CATEGORY_LABEL[form.category] ? tr(`decl.cat.${form.category}` as MsgKey) : "", form.areaLabel.trim()].filter(Boolean).join(" · ")}
            </p>
            <ul className="flex flex-wrap gap-2 pt-1" aria-label={tr("sf.ds.howGet")}>
              {savedWays.map((w) => <li key={w} className="rounded-full border border-border px-3 py-1 text-ds-13 font-medium">{wayTitle(w)}</li>)}
            </ul>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
            {form.free
              ? <ReviewRow title={tr("sf.price")} body={tr("sf.ds.freeBody")} onEdit={() => setStep(3)} />
              : <ReviewRow title={tr("sf.ds.drops")} body={form.drops && priceCents && floorCents && floorCents < priceCents ? tr("sf.ds.dropsOn", { pct: form.dropPct, time: dropRunTime(), floor: formatPrice(floorCents) }) : tr("sf.ds.dropsOff")} onEdit={() => setStep(3)} />}
            <ReviewRow title={tr("sf.ds.photos")} body={tr(photoCount === 1 ? "sf.ds.photosBodyOne" : "sf.ds.photosBody", { n: photoCount })} onEdit={() => setStep(1)} />
            <ReviewRow title={tr("sf.ds.howGet")} body={handoverSummary(savedWays)} onEdit={() => setStep(4)} />
            {/* Owner 2026-10-28: "it also never said how long it will stay open"; the rule the server runs (Q2461). */}
            <ReviewRow title={tr("sf.ds.howLong")} body={keepUp.on ? tr("lp.lifeKeepUp") : tr("lp.life")} />
          </ul>
          {/* Owner 2026-10-29: "Keep it up until it sells" (saved on the draft at once; the row above follows it). */}
          <KeepUpSwitch keep={keepUp} as="div" rowClassName="flex items-center gap-3 rounded-[20px] border border-border bg-card p-4" />
          {/* OWN-FREE: "make it free after __ days", saved on the draft at once (a free listing has nothing to choose). */}
          {!form.free && <AutoFreeRow itemId={itemId} as="div" rowClassName="flex rounded-[20px] border border-border bg-card p-4" />}
          <SellTaxBox s={s} />
          {photoCount < DECLUTTER_MIN_PHOTOS && <p className="text-ds-14 text-muted-foreground">{tr(DECLUTTER_MIN_PHOTOS === 1 ? "sf.ds.addToListOne" : "sf.ds.addToList", { n: DECLUTTER_MIN_PHOTOS })}</p>}
        </section>
      )}

      {stepProblem && step < 5 && triedStep === step && <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-testid="sell-form-problem">{stepProblem}</p>}
      {step === 3 && priceCents && (
        <SellYouGet priceCents={priceCents} />
      )}
      {step < 5 ? (
        <Button type="button" className="w-full rounded-full" disabled={saving} onClick={() => void next()}>
          {step === 4 ? (saving ? tr("sf.ds.saving") : tr("sf.ds.saveContinue")) : tr("sf.ds.continue")}
        </Button>
      ) : (
        photoCount >= DECLUTTER_MIN_PHOTOS && (
          <Button type="button" className="w-full rounded-full" disabled={s.publishing} onClick={() => void s.onPublish()}>
            {s.publishing ? tr("sf.ds.listing") : tr("sf.ds.listIt")}
          </Button>
        )
      )}
      </div>
    </AppPage>
  );
}
