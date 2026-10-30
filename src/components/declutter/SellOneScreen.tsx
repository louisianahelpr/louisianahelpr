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
import { useState, type ReactNode } from "react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";
import { StepHead } from "./DeclutterSellSteps";
import { windowsSummary } from "./DeclutterPickupTimes";
import { MAX_PHOTOS, SellPhotos } from "./DeclutterSellPhotos";
import { autoFreeOutcomeLine } from "@/lib/declutter/autoFree";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { SellItForMeEntry } from "./SellItForMe";
import { SellAiDraftPanel } from "./SellAiDraft";
import { handoverSummary } from "./SellHandoverChoices";
import { UsesSettingsNote } from "./SellLastSetup";
import { DeclutterNotice } from "./declutterUi";
import { dropsOutcomeLine, formProblem } from "./sellForm";
import { SellFreeToggle, SellTaxBox } from "./SellFormParts";
import { SellSummaryCard, type SummaryField } from "./SellSummaryCard";
import { useSellFlowState, type SellFlow } from "./useSellFlowState";

type Where = "photos" | SummaryField | "settings" | "tax";

/** The first thing that blocks Post, top to bottom, and the row it belongs to. */
function postProblem(s: SellFlow): { message: string; at: Where } | null {
  if (s.photoTotal < DECLUTTER_MIN_PHOTOS) return { message: `Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}.`, at: "photos" };
  const f = formProblem(s.form);
  if (f) return { message: f, at: /name/i.test(f) ? "title" : /price|lowest|drops/i.test(f) ? "price" : "settings" };
  if (s.savedWays.length === 0) return { message: "Choose a way buyers can get it in Settings.", at: "settings" };
  if (!s.sizeKnown) return { message: "Pick a size, so buyers know what it takes to move it.", at: "size" };
  if (!s.attested) return { message: "Tick the box about this item before you list it.", at: "tax" };
  return null;
}

/** Start over (a listing brought back from this device): a fresh form, with the seller's saved settings read again. */
export function SellOneScreen() {
  const [run, setRun] = useState(0);
  return <SellOneForm key={run} onStartOver={() => setRun((r) => r + 1)} />;
}

function SellOneForm({ onStartOver }: { onStartOver: () => void }) {
  const s = useSellFlowState(null);
  const { user, underAge, form, held, setHeld, photos, uploading, aiAsk, ai, savedWays, windows, autoFreeWanted } = s;
  const [open, setOpen] = useState<SummaryField | null>(null);
  const [tried, setTried] = useState(false);

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

  const dropsLine = dropsOutcomeLine(form);
  const bad = postProblem(s);
  /** The words for what blocks Post, shown in the row they belong to once Post was tapped. */
  const problemAt = (at: Where): ReactNode =>
    tried && bad?.at === at ? <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-testid="sell-form-problem" data-problem-at={at}>{bad.message}</p> : null;
  const post = () => {
    if (bad) {
      setTried(true);
      if (bad.at === "title" || bad.at === "price" || bad.at === "size") setOpen(bad.at);
      requestAnimationFrame(() => document.querySelector(`[data-sell-row="${bad.at}"]`)?.scrollIntoView?.({ block: "center" }));
      return;
    }
    void s.onPublish();
  };

  return (
    <AppPage title="Sell an item" backTo="/declutter?tab=selling" phoneHidesTitle>
      <div className="mx-auto w-full max-w-xl space-y-6" data-sell-one-screen="">
        {/* Payouts: only once money is owed (owner 2026-10-27, list first, set up at first sale). */}
        <SellerPayoutPrompt />

        {s.keptWork.restored && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[20px] border border-border bg-card p-4" data-sell-kept="">
            <p className="min-w-0 flex-1 text-ds-14 font-semibold text-foreground">We kept your listing from last time.</p>
            <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => void s.keptWork.finish().then(onStartOver)}>Start over</Button>
          </div>
        )}
        {s.keptWork.note && <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-sell-not-kept="">{s.keptWork.note}</p>}

        <section className="space-y-4" aria-labelledby="sell-step" data-sell-row="photos">
          <StepHead title="Show it off" sub={`Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}, up to ${MAX_PHOTOS}. We write the listing from them.`} />
          <SellPhotos
            uploaded={photos.data ?? []}
            held={held}
            onFiles={(f) => void s.onFiles(f)}
            onRemoveUploaded={(photoId) => void s.onRemovePhoto(photoId)}
            onRemoveHeld={(i) => setHeld((h) => h.filter((_, j) => j !== i))}
            uploading={uploading}
            heldFailed={s.failedHeld > 0}
            refusedNote={s.refusedNote}
            aiPanel={aiAsk || ai.state.status !== "idle" ? <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} oneScreen /> : null}
          />
          {/* "Sell it for me" (owner 2026-10-19): a new listing only, never on a draft already started. */}
          <SellItForMeEntry />
          {problemAt("photos")}
        </section>

        <SellSummaryCard
          s={s}
          open={open}
          setOpen={setOpen}
          problems={{ title: problemAt("title"), price: problemAt("price"), size: problemAt("size") }}
          priceExtras={<div className="space-y-3 pt-1"><SellFreeToggle s={s} /></div>}
        />

        <div className="space-y-2" data-sell-row="tax"><SellTaxBox s={s} />{problemAt("tax")}</div>

        {/* What will happen, in plain words, before Post; the choices themselves are made ahead (owner 2026-10-30). */}
        <div className="space-y-1" data-sell-outcome="" data-sell-row="settings">
          <p className="text-ds-14 text-foreground [overflow-wrap:anywhere]">
            {[handoverSummary(savedWays), form.areaLabel.trim(), windowsSummary(windows)].filter(Boolean).join(" · ")}
          </p>
          {s.saved.pickup && <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]" data-saved-pickup="">{s.saved.pickup.line}</p>}
          {!form.free && dropsLine && <p className="text-ds-14 font-semibold text-foreground">{dropsLine}</p>}
          {!form.free && <p className="text-ds-13 text-muted-foreground">{autoFreeOutcomeLine(autoFreeWanted)}</p>}
          <UsesSettingsNote />
          {problemAt("settings")}
        </div>
        {s.failedHeld > 0 && (
          <div role="alert" className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-photo-trouble="">
            <p className="text-ds-15 font-semibold text-foreground">{s.failedHeld === 1 ? "1 photo didn't upload" : `${s.failedHeld} photos didn't upload`}. Your listing isn't up yet.</p>
            {s.photoFailure && <p className="text-ds-14 text-muted-foreground [overflow-wrap:anywhere]">{s.photoFailure}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" className="rounded-full" onClick={() => void s.onPublish()}>Try again</Button>
              {s.photoCount > 0 && (
                <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => void s.onPublish({ withoutFailed: true })}>
                  Post with {s.photoCount === 1 ? "1 photo" : `${s.photoCount} photos`}
                </Button>
              )}
            </div>
          </div>
        )}
        {tried && bad && <p className="text-ds-13 font-semibold text-destructive-ink" data-testid="sell-form-pointer">Fix what's marked above, then post.</p>}
        <Button type="button" className="w-full rounded-full" disabled={s.publishing || s.saving} onClick={post}>
          {s.publishing ? (s.postStep ?? "Posting…") : "Post it"}
        </Button>
        <p role="status" className="sr-only" data-post-step="">{s.publishing ? s.postStep : ""}</p>
      </div>
    </AppPage>
  );
}
