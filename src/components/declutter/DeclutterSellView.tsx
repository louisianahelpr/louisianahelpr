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
import { photoPublicUrl, type DeliverySize } from "@/lib/declutter/api";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { ChipGroup, LISTING_LIFETIME, LISTING_LIFETIME_KEEP_UP, ReviewRow, StepHead, dropRunTime } from "./DeclutterSellSteps";
import { KeepUpSwitch } from "./KeepUpRow";
import { AutoFreeRow } from "./AutoFreeRow";
import { CATEGORY_GROUPS, CATEGORY_LABEL, CONDITION_LABEL, DeclutterNotice, SIZE_LABEL } from "./declutterUi";
import { DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";
import { pickupWindowsProblem } from "./DeclutterPickupTimes";
import PriceHint from "./DeclutterPriceHint";
import { MAX_PHOTOS, SellPhotos } from "./DeclutterSellPhotos";
import { SellAiDraftPanel } from "./SellAiDraft";
import { HANDOVER_CHOICE, handoverSummary } from "./SellHandoverChoices";
import { sellStepProblem } from "./sellForm";
import { FieldLabel, SELL_INPUT, SellDropsCard, SellFreeToggle, SellPriceInput, SellTaxBox, SellWaysFields } from "./SellFormParts";
import { SellOneScreen } from "./SellOneScreen";
import { useSellFlowState } from "./useSellFlowState";

export default function SellFlow() {
  const [params] = useSearchParams();
  const itemId = params.get("item");
  // Owner 2026-10-29: a NEW listing is one screen; only a saved draft keeps the steps.
  if (!itemId) return <SellOneScreen />;
  return <SellSteps itemId={itemId} />;
}

function SellSteps({ itemId }: { itemId: string }) {
  const navigate = useNavigate();
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
      <AppPage title="Sell an item" backTo="/declutter">
        <DeclutterNotice tone="warn" title="You must be 18 or older to sell on Declutter.">
          You can still look around. Selling opens when your birthday on file says you're 18.
        </DeclutterNotice>
      </AppPage>
    );
  }
  if (itemId && item.data && item.data.status !== "draft") {
    return (
      <AppPage title="Sell an item" backTo="/declutter?view=selling">
        <DeclutterNotice title="This item is already listed.">
          <Link to={`/declutter/item/${itemId}`} className="underline">See the listing</Link>
        </DeclutterNotice>
      </AppPage>
    );
  }

  const photoTotal = s.photoTotal;
  // Step 4 also needs pickup times the server takes (1-21, each ending after it starts).
  const stepProblem = sellStepProblem(step, form, photoTotal)
    ?? (step === 4 && savedWays.length === 0 ? "Tick at least one way buyers can get it." : null)
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
    <AppPage title="Sell an item" onBack={back} phoneHidesTitle>
      {/* Board 31a/48/31b/49/158: one question per step, "n of 5" progress (spec §3 "Step-by-step flows"). */}
      <div className="mx-auto w-full max-w-xl space-y-5">
      <div className="flex items-center gap-3" data-sell-progress={step}>
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`h-1 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>
        <span className="text-ds-13 font-semibold text-muted-foreground">{step} of 5</span>
      </div>

      {/* Payouts: only once money is owed (owner 2026-10-27, list first, set up at first sale). */}
      {step === 1 && <SellerPayoutPrompt />}

      {step === 1 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="Show it off" sub={`Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}, up to ${MAX_PHOTOS}. The first one is the cover.`} />
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

      {step === 2 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="What is it?" sub="Plain words work best. Buyers search for what they'd call it." />
          <div className="space-y-2">
            <FieldLabel htmlFor="sell-title" text="Title" />
            <input id="sell-title" className={SELL_INPUT} maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Oak rocking chair" />
          </div>
          <ChipGroup label="Category" options={Object.entries(CATEGORY_LABEL).map(([k, v]) => ({ value: k, label: v }))} groups={CATEGORY_GROUPS} value={form.category} onChange={(v) => set("category", v)} />
          <ChipGroup label="Condition" options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: CONDITION_LABEL[n] }))} value={String(form.conditionStars)} onChange={(v) => set("conditionStars", Number(v))} />
          <ChipGroup label="Size" options={(Object.keys(SIZE_LABEL) as DeliverySize[]).map((k) => ({ value: k, label: SIZE_LABEL[k] }))} value={form.deliverySize} onChange={(v) => set("deliverySize", v as DeliverySize)} />
          <div className="space-y-2">
            <FieldLabel htmlFor="sell-desc" text="Anything else?" extra="(optional)" />
            <textarea id="sell-desc" className={`${SELL_INPUT} h-auto py-3`} rows={4} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Works great. Small scuff on the base." />
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="What's your price?" sub={form.free ? "Someone nearby picks it up for free." : "You keep the whole price."} />
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
          <StepHead title="How can buyers get it?" sub="Choose the ways you're happy with. Buyers only see these." />
          <SellWaysFields s={s} />
        </section>
      )}

      {step === 5 && (
        <section className="space-y-4" aria-labelledby="sell-step">
          <StepHead title="Ready to list?" sub="This is your listing." />
          <div className="rounded-[20px] border border-border bg-card p-4 space-y-2" data-sell-preview="">
            {photos.data?.[0] && (
              <img src={photoPublicUrl(photos.data[0].storage_path)} alt="" className="aspect-[16/10] w-full rounded-2xl object-cover bg-photo-empty" />
            )}
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-ds-17 font-bold text-foreground">{form.title.trim()}</p>
              {(form.free || priceCents) && <p className="shrink-0 text-ds-17 font-bold text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(form.free ? 0 : (priceCents as number))}</p>}
            </div>
            <p className="text-ds-13 text-muted-foreground">
              {[CONDITION_LABEL[form.conditionStars], CATEGORY_LABEL[form.category], form.areaLabel.trim()].filter(Boolean).join(" · ")}
            </p>
            <ul className="flex flex-wrap gap-2 pt-1" aria-label="How buyers get it">
              {savedWays.map((w) => <li key={w} className="rounded-full border border-border px-3 py-1 text-ds-13 font-medium">{HANDOVER_CHOICE[w].title}</li>)}
            </ul>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
            {form.free
              ? <ReviewRow title="Price" body="Free: claimed, never bought. No offers or price drops." onEdit={() => setStep(3)} />
              : <ReviewRow title="Price drops" body={form.drops && priceCents && floorCents && floorCents < priceCents ? `${form.dropPct}% each evening at ${dropRunTime()}, to a whole dollar, never below ${formatPrice(floorCents)}` : "Off: it stays at your price"} onEdit={() => setStep(3)} />}
            <ReviewRow title="Photos" body={`${photosWord(photoCount)} · the first is the cover`} onEdit={() => setStep(1)} />
            <ReviewRow title="How buyers get it" body={handoverSummary(savedWays)} onEdit={() => setStep(4)} />
            {/* Owner 2026-10-28: "it also never said how long it will stay open"; the rule the server runs (Q2461). */}
            <ReviewRow title="How long it stays up" body={keepUp.on ? LISTING_LIFETIME_KEEP_UP : LISTING_LIFETIME} />
          </ul>
          {/* Owner 2026-10-29: "Keep it up until it sells" (saved on the draft at once; the row above follows it). */}
          <KeepUpSwitch keep={keepUp} as="div" rowClassName="flex items-center gap-3 rounded-[20px] border border-border bg-card p-4" />
          {/* OWN-FREE: "make it free after __ days", saved on the draft at once (a free listing has nothing to choose). */}
          {!form.free && <AutoFreeRow itemId={itemId} as="div" rowClassName="flex rounded-[20px] border border-border bg-card p-4" />}
          <SellTaxBox s={s} />
          {photoCount < DECLUTTER_MIN_PHOTOS && <p className="text-ds-14 text-muted-foreground">Add at least {photosWord(DECLUTTER_MIN_PHOTOS)} to list this item.</p>}
        </section>
      )}

      {stepProblem && step < 5 && triedStep === step && <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-testid="sell-form-problem">{stepProblem}</p>}
      {step === 3 && priceCents && (
        <p className="flex items-baseline justify-between text-ds-14 text-foreground" data-sell-keep="">
          You get if it sells today
          <span className="font-bold text-[hsl(var(--burnt-sienna))]">{formatPrice(priceCents)}</span>
        </p>
      )}
      {step < 5 ? (
        <Button type="button" className="w-full rounded-full" disabled={saving} onClick={() => void next()}>
          {step === 4 ? (saving ? "Saving…" : "Save and continue") : "Continue"}
        </Button>
      ) : (
        photoCount >= DECLUTTER_MIN_PHOTOS && (
          <Button type="button" className="w-full rounded-full" disabled={s.publishing} onClick={() => void s.onPublish()}>
            {s.publishing ? "Listing…" : "List it"}
          </Button>
        )
      )}
      </div>
    </AppPage>
  );
}
