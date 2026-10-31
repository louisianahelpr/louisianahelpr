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
import { Boxes, Gift, HandHelping, History, Images, Package, Search } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { savedSellWork } from "@/lib/declutter/bunchSaved";
import AppPage from "@/components/AppPage";
import { ChoiceCard } from "@/components/ui/ChoiceCard";
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
          // Audit 10-30 #17 / POST-H17: the cards are shorter here and the two under "Other ways" (neither is a way to sell it
          // yourself) are compact rows, so all six reach a 375x812 screen (measured b18 10-31: Wanted's top was at 859px).
          <section className="flex flex-col gap-2.5 [&_[data-sell-choice]:not([data-compact])]:!min-h-[80px] [&_[data-sell-choice]:not([data-compact])]:!py-3" aria-labelledby="sell-step">
            {/* LEAD chooser fit (10-31): kept work is ONE compact row in place of the helper line, so every choice still
                reaches a 375x812 screen (two Continue cards put Wanted's bottom at 980px). Both kinds kept: it opens a
                small choice. */}
            <StepHead title="What would you like to do?" sub={continueTo ? undefined : "Pick one. You can come back for another."} />
            {continueTo && (
              <ChoiceCard slim data-sell-choice="continue" to={continueTo.to} onClick={continueTo.to ? undefined : () => setChoosingKept(true)}
                icon={<History className="h-4 w-4" />} title="Continue where you left off" />
            )}
            <ChoiceCard data-sell-choice="one" to={SELL_ONE_PATH} icon={<Package className={ICON} />} title="One item" line="Add photos and we write the listing for you." />
            <ChoiceCard data-sell-choice="bunch" to={SELL_BUNCH_PATH} icon={<Images className={ICON} />} title="Sell a bunch" line="Add photos of everything. We write each listing." />
            {movingOut && (
              <ChoiceCard data-sell-choice="move" to={SELL_MOVE_PATH} icon={<Boxes className={ICON} />} title="Moving out sale" line="Your move date groups everything as one sale." />
            )}
            <ChoiceCard data-sell-choice="free" to={SELL_FREE_PATH} icon={<Gift className={ICON} />} title="Give it away free" line="Someone nearby picks it up for free." />
            <h3 className="pt-1 text-ds-13 font-semibold text-muted-foreground" data-sell-other="">Other ways</h3>
            <ChoiceCard compact data-sell-choice="helpr" onClick={() => setExplaining(true)} icon={<HandHelping className={ICON} />} title="Have a Helpr list it for me" line="A Helpr photographs and lists it." />
            {wanted && (
              <ChoiceCard compact data-sell-choice="wanted" to={WANTED_POST_PATH} icon={<Search className={ICON} />} title="Post a Wanted" line="Tell sellers what you're after." />
            )}
            <HelprListExplainSheet open={explaining} onClose={() => setExplaining(false)} />
            <KeptWorkSheet open={choosingKept} onClose={() => setChoosingKept(false)} bunchTo={bunchTo} bunchLine={bunchLine} />
          </section>
        )}
      </div>
    </AppPage>
  );
}
