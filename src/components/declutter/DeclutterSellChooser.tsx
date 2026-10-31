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

const ICON = "h-5 w-5";

export default function DeclutterSellChooser() {
  const { underAge } = useAgeGate();
  const movingOut = useFeature("declutter_moving_out");
  const wanted = useFeature("declutter_wanted");
  const [explaining, setExplaining] = useState(false);
  // LEAD-BUNCH-DRAFT-KEEP (owner 10-31): work kept on this device is offered first, so leaving never feels like losing it.
  const { user } = useCurrentUser();
  const kept = useQuery({ queryKey: ["declutter", "saved-sell-work", user?.id], queryFn: () => savedSellWork(user!.id), enabled: !!user?.id, staleTime: 0 });
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
          <section className="flex flex-col gap-3 [&_[data-sell-choice]:not([data-compact])]:!min-h-[80px]" aria-labelledby="sell-step">
            <StepHead title="What would you like to do?" sub="Pick one. You can come back for another." />
            {kept.data?.bunch && (
              <ChoiceCard compact data-sell-choice="continue-bunch" to={kept.data.moving ? SELL_MOVE_PATH : SELL_BUNCH_PATH} icon={<History className={ICON} />} title="Continue where you left off" line={kept.data.moving ? "Your moving out sale, kept here." : "Your Sell a bunch items, kept here."} />
            )}
            {kept.data?.one && (
              <ChoiceCard compact data-sell-choice="continue-one" to={SELL_ONE_PATH} icon={<History className={ICON} />} title="Continue your listing" line="Your one item, kept here." />
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
          </section>
        )}
      </div>
    </AppPage>
  );
}
