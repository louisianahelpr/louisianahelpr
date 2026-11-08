/**
 * "What do you want to sell?" (owner 2026-10-30): the first step every Sell button opens (the section top bar's
 * "Sell an item", the Create sheet, Browse's "Sell something", the Selling tab's "More ways to sell"). Modelled on
 * Post a job's first step: the same Bodoni question and helper, and the same big cards (the shared ChoiceCard), each
 * with an icon and one line. Each card goes straight on to the flow that already exists:
 *   1. One item: the one-screen Sell flow.
 *   2. Sell a bunch: /declutter/sell?mode=bunch.
 *   3. Moving out sale: Sell a bunch with a move-out date, only while 'declutter_moving_out' is on for the viewer.
 *   4. Give it away free: the one-screen Sell flow with Free on (?free=1).
 *   5. Have a Helpr list it for me: what that means (HelprListExplainSheet), then Post a job, pre-filled (?sellForMe=1).
 *   6. Post a Wanted: the Wanted form, only while 'declutter_wanted' is on for the viewer.
 * Under 18 sees the same notice as the Sell flow (the server refuses selling and buying anyway).
 * Guard: src/components/declutter/declutterSellChooser.test.tsx.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, History, Images, Package } from "lucide-react";
import { Link } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { savedSellWork } from "@/lib/declutter/bunchSaved";
import AppPage from "@/components/AppPage";
import { ChoiceCard } from "@/components/ui/ChoiceCard";
import { SPACE } from "@/components/ui/designScale";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { SELL_BUNCH_PATH, SELL_FREE_PATH, SELL_MOVE_PATH, SELL_ONE_PATH, WANTED_POST_PATH } from "@/lib/declutter/sellChooser";
import { StepHead } from "./DeclutterSellSteps";
import { DeclutterNotice } from "./declutterUi";
import { HelprListExplainSheet } from "./HelprListExplainSheet";
import { focusSheetItself } from "./focusSheetItself";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetSecondaryAction } from "@/components/ui/sheet";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

const ICON = "h-5 w-5";
/** A "More ways" link: tertiary text (underlined, 44 px tap height), never a card. */
const MORE_LINK = "inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

/** Both kinds of kept work: which one to go back to (the chooser's one Continue row opens this). */
function KeptWorkSheet({ open, onClose, bunchTo, bunchLine }: { open: boolean; onClose: () => void; bunchTo: string; bunchLine: string }) {
  const webDesktop = useIsWebDesktop();
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-kept-work="">
        <SheetHero title="Continue where you left off" />
        <div className="mt-2 flex flex-col gap-3">
          <ChoiceCard compact data-kept-choice="bunch" to={bunchTo} icon={<Images className={ICON} />} title={bunchTo === SELL_MOVE_PATH ? "Moving out sale" : "Sell a bunch"} line={bunchLine} />
          <ChoiceCard compact data-kept-choice="one" to={SELL_ONE_PATH} icon={<Package className={ICON} />} title="One item" line="Your one item." />
        </div>
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={onClose}>Not now</SheetSecondaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function DeclutterSellChooser() {
  const { underAge } = useAgeGate();
  const movingOut = useFeature("declutter_moving_out");
  const wanted = useFeature("declutter_wanted");
  const [explaining, setExplaining] = useState(false);
  // LEAD-BUNCH-DRAFT-KEEP (owner 10-31): work kept on this device is offered first, so leaving never feels like losing it.
  const { user } = useCurrentUser();
  const kept = useQuery({ queryKey: ["declutter", "saved-sell-work", user?.id], queryFn: () => savedSellWork(user!.id), enabled: !!user?.id, staleTime: 0 });
  const [choosingKept, setChoosingKept] = useState(false);
  const bunchTo = kept.data?.moving ? SELL_MOVE_PATH : SELL_BUNCH_PATH;
  const bunchLine = kept.data?.moving ? "Your moving out sale." : "Your Sell a bunch items.";
  // One kind kept: the row goes straight back to it. Both: it opens KeptWorkSheet to pick one.
  const continueTo = kept.data?.bunch && kept.data.one ? { to: undefined } : kept.data?.bunch ? { to: bunchTo }
    : kept.data?.one ? { to: SELL_ONE_PATH } : null;
  return (
    <AppPage title="Sell" backTo="/declutter?tab=selling" phoneHidesTitle>
      <div className="mx-auto w-full max-w-xl space-y-5" data-sell-chooser="">
        {underAge ? (
          <DeclutterNotice tone="warn" title="You must be 18 or older to sell on Declutter.">
            You can still look around. Selling opens when your birthday on file says you're 18.
          </DeclutterNotice>
        ) : (
          // Owner pick 5 (11-08; lead decision, NOT camera-first because of bulk upload): + Sell opens a SHORT chooser of
          // three: One item (photos first), Several at once (the bunch flow) and Give away free. Moving sale, a Helpr
          // listing it and a Wanted post sit in one small "More ways" row under them (they were three more cards).
          <section className={`flex flex-col ${SPACE.cardGap}`} aria-labelledby="sell-step">
            <StepHead title="Sell something" sub={continueTo ? undefined : "How many things?"} />
            {/* LEAD-BUNCH-DRAFT-KEEP (owner 10-31): kept work is ONE compact row first; both kinds kept, it opens a small choice. */}
            {continueTo && (
              <ChoiceCard slim data-sell-choice="continue" to={continueTo.to} onClick={continueTo.to ? undefined : () => setChoosingKept(true)}
                icon={<History className="h-4 w-4" />} title="Continue where you left off" />
            )}
            <ChoiceCard data-sell-choice="one" to={SELL_ONE_PATH} icon={<Package className={ICON} />} title="One item" line="Photos first; we write the listing." />
            <ChoiceCard data-sell-choice="bunch" to={SELL_BUNCH_PATH} icon={<Images className={ICON} />} title="Several at once" line="Photos of everything; we write each one." />
            <ChoiceCard data-sell-choice="free" to={SELL_FREE_PATH} icon={<Gift className={ICON} />} title="Give away free" line="Someone nearby picks it up." />
            <nav aria-label="More ways" data-sell-other="" className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1 text-ds-13 text-muted-foreground">
              <span className="font-semibold">More ways:</span>
              {movingOut && <Link data-sell-choice="move" to={SELL_MOVE_PATH} className={MORE_LINK}>Moving sale</Link>}
              {movingOut && <span aria-hidden>·</span>}
              <button type="button" data-sell-choice="helpr" onClick={() => setExplaining(true)} className={MORE_LINK}>A Helpr lists it</button>
              {wanted && <span aria-hidden>·</span>}
              {wanted && <Link data-sell-choice="wanted" to={WANTED_POST_PATH} className={MORE_LINK}>Post a Wanted</Link>}
            </nav>
            <HelprListExplainSheet open={explaining} onClose={() => setExplaining(false)} />
            <KeptWorkSheet open={choosingKept} onClose={() => setChoosingKept(false)} bunchTo={bunchTo} bunchLine={bunchLine} />
          </section>
        )}
      </div>
    </AppPage>
  );
}
