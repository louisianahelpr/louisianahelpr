/**
 * A NEW listing on ONE screen (owner 2026-10-29: "ai should always be doing most of the work for declutter
 * listing"). Top to bottom: the photos (Claude runs by itself on the first ones; its cover pick moves first and
 * its photo tip shows in the panel), Claude's listing as a summary card with an "Edit <field>" per row, the price
 * options under Price, "How buyers get it" (one line when the last listing's setup was used), the tax box, and ONE
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
import { Switch } from "@/components/ui/switch";
import { DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";
import { StepHead } from "./DeclutterSellSteps";
import { pickupWindowsProblem, windowsSummary } from "./DeclutterPickupTimes";
import { MAX_PHOTOS, SellPhotos } from "./DeclutterSellPhotos";
import { KEEP_UP_TITLE, keepUpSettingLine } from "./KeepUpRow";
import { AutoFreeChoice } from "./AutoFreeRow";
import { autoFreeOutcomeLine } from "@/lib/declutter/autoFree";
import { SellerPayoutPrompt } from "./SellerPayoutPrompt";
import { SellItForMeEntry } from "./SellItForMe";
import { SellAiDraftPanel } from "./SellAiDraft";
import { handoverSummary } from "./SellHandoverChoices";
import { LastSetupNote } from "./SellLastSetup";
import { DeclutterNotice } from "./declutterUi";
import { dropsOutcomeLine, formProblem } from "./sellForm";
import { SellDropsCard, SellFreeToggle, SellTaxBox, SellWaysFields } from "./SellFormParts";
import { SellSummaryCard, type SummaryField } from "./SellSummaryCard";
import { useSellFlowState, type SellFlow } from "./useSellFlowState";

type Where = "photos" | SummaryField | "drops" | "ways" | "tax";

/** The first thing that blocks Post, top to bottom, and the row it belongs to. */
function postProblem(s: SellFlow): { message: string; at: Where } | null {
  if (s.photoTotal < DECLUTTER_MIN_PHOTOS) return { message: `Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}.`, at: "photos" };
  const f = formProblem(s.form);
  if (f) return { message: f, at: /name/i.test(f) ? "title" : /lowest|drops/i.test(f) ? "drops" : /price/i.test(f) ? "price" : "ways" };
  if (s.savedWays.length === 0) return { message: "Tick at least one way buyers can get it.", at: "ways" };
  const w = pickupWindowsProblem(s.windows);
  if (w) return { message: w, at: "ways" };
  if (!s.attested) return { message: "Tick the box about this item before you list it.", at: "tax" };
  return null;
}

export function SellOneScreen() {
  const s = useSellFlowState(null);
  const { user, underAge, form, held, setHeld, photos, uploading, aiAsk, ai, usedLastSetup, savedWays, windows, keepUpWanted, setKeepUpWanted, autoFreeWanted, setAutoFreeWanted } = s;
  const [open, setOpen] = useState<SummaryField | null>(null);
  // null: follow the last setup (folded when it was used, open when there was none).
  const [waysOpen, setWaysOpen] = useState<boolean | null>(null);
  const [tried, setTried] = useState(false);
  // Saved settings fold to one line (owner 2026-10-30); Change opens them, and so does a problem in them.
  const [priceOptionsOpen, setPriceOptionsOpen] = useState(false);

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

  // Saved settings fold only when nothing in them still needs an answer: a seller with no address yet is asked for it.
  const waysFromSaved = (s.saved.hasSettings || s.saved.hasPlaces) && form.areaLabel.trim().length >= 2 && form.pickupAddress.trim().length >= 5 && !pickupWindowsProblem(windows);
  const waysExpanded = waysOpen ?? !(usedLastSetup || waysFromSaved);
  const priceOptionsFolded = s.saved.hasSettings && !priceOptionsOpen;
  const dropsLine = dropsOutcomeLine(form);
  const bad = postProblem(s);
  /** The words for what blocks Post, shown in the row they belong to once Post was tapped. */
  const problemAt = (at: Where): ReactNode =>
    tried && bad?.at === at ? <p role="alert" className="text-ds-13 font-semibold text-destructive-ink" data-testid="sell-form-problem" data-problem-at={at}>{bad.message}</p> : null;
  const post = () => {
    if (bad) {
      setTried(true);
      if (bad.at === "ways") setWaysOpen(true);
      if (bad.at === "drops") setPriceOptionsOpen(true);
      if (bad.at === "title" || bad.at === "price" || bad.at === "drops") setOpen(bad.at === "drops" ? "price" : bad.at);
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

        <section className="space-y-4" aria-labelledby="sell-step" data-sell-row="photos">
          <StepHead title="Show it off" sub={`Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}, up to ${MAX_PHOTOS}. We write the listing from them.`} />
          <SellPhotos
            uploaded={photos.data ?? []}
            held={held}
            onFiles={(f) => void s.onFiles(f)}
            onRemoveUploaded={(photoId) => void s.onRemovePhoto(photoId)}
            onRemoveHeld={(i) => setHeld((h) => h.filter((_, j) => j !== i))}
            uploading={uploading}
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
          problems={{ title: problemAt("title"), price: problemAt("price") }}
          priceExtras={<div className="space-y-3 pt-1">
            <SellFreeToggle s={s} />
            {priceOptionsFolded ? (
              <div className="space-y-1 rounded-[20px] border border-border bg-card p-4" data-saved-price-settings="">
                <p className="text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]">
                  {[dropsLine, keepUpWanted ? KEEP_UP_TITLE : null].filter(Boolean).join(" · ")}
                </p>
                <LastSetupNote saved onChange={() => setPriceOptionsOpen(true)} />
              </div>
            ) : (<>
            {/* DeclutterOfferRules slot (builder 28) */}
            {/* The two switches sit together (owner 2026-10-30: "group all the toggles together"): Lower the price,
                then Keep it up, both ON by default; "make it free after" (a choice, not a switch) comes after them. */}
            <div className="space-y-3" data-sell-switches="">
              {!form.free && <div className="space-y-2" data-sell-row="drops"><SellDropsCard s={s} />{problemAt("drops")}</div>}
              <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-4" data-keep-up={keepUpWanted ? "on" : "off"}>
                <span className="min-w-0 flex-1">
                  <span id="sell-keep-up" className="block text-ds-15 font-semibold">{KEEP_UP_TITLE}</span>
                  <span className="block text-ds-13 text-muted-foreground" data-sell-lifetime="">{keepUpSettingLine(keepUpWanted)}</span>
                </span>
                <Switch aria-labelledby="sell-keep-up" checked={keepUpWanted} onCheckedChange={(v) => setKeepUpWanted(v === true)} />
              </div>
            </div>
            {/* OWN-FREE: "If it doesn't sell, make it free after __ days", Never by default; saved at Post. */}
            {!form.free && <div className="rounded-[20px] border border-border bg-card p-4"><AutoFreeChoice days={autoFreeWanted} onChange={setAutoFreeWanted} /></div>}
            </>)}
          </div>}
        />

        <section className="space-y-4" aria-labelledby="sell-ways-head" data-sell-row="ways">
          <h2 id="sell-ways-head" className="font-display font-moment text-ds-24 font-semibold leading-tight text-foreground">How buyers get it</h2>
          {waysExpanded ? (
            <SellWaysFields s={s} />
          ) : (
            <div className="space-y-1 rounded-[20px] border border-border bg-card p-4" data-ways-summary="">
              <p className="text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]">
                {[handoverSummary(savedWays), form.areaLabel.trim(), windowsSummary(windows)].filter(Boolean).join(" · ")}
              </p>
              {s.saved.pickup && <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]" data-saved-pickup="">{s.saved.pickup.line}</p>}
              <LastSetupNote saved={waysFromSaved} onChange={() => setWaysOpen(true)} />
            </div>
          )}
          {problemAt("ways")}
        </section>

        <div className="space-y-2" data-sell-row="tax"><SellTaxBox s={s} />{problemAt("tax")}</div>

        {/* What will happen, in plain words, before Post (owner 2026-10-30). */}
        {!form.free && dropsLine && (
          <div className="space-y-0.5 text-ds-14 text-foreground" data-sell-outcome="">
            <p className="font-semibold">{dropsLine}</p>
            <p className="text-muted-foreground">{autoFreeOutcomeLine(autoFreeWanted)}</p>
          </div>
        )}
        {tried && bad && <p className="text-ds-13 font-semibold text-destructive-ink" data-testid="sell-form-pointer">Fix what's marked above, then post.</p>}
        <Button type="button" className="w-full rounded-full" disabled={s.publishing || s.saving} onClick={post}>
          {s.publishing ? "Posting…" : "Post it"}
        </Button>
      </div>
    </AppPage>
  );
}
