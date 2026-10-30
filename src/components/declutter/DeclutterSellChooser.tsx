/**
 * "What do you want to sell?" (owner 2026-10-30): the first step every Sell button opens (the section top bar's
 * "Sell an item", the Create sheet, Browse's "Sell something", the Selling tab's "More ways to sell"). Modelled on
 * Post a job's first step: the same Bodoni question and helper, and the same big cards (the shared ChoiceCard), each
 * with an icon and one line. Each card goes straight on to the flow that already exists:
 *   1. One item: the one-screen Sell flow.
 *   2. Sell a bunch: /declutter/sell?mode=bunch.
 *   3. Moving out sale: Sell a bunch with a move-out date, only while 'declutter_moving_out' is on for the viewer.
 *   4. Give it away free: the one-screen Sell flow with Free on (?free=1).
 *   5. Have a Helpr list it for me: Post a job, pre-filled (?sellForMe=1, src/lib/declutter/sellForMe.ts).
 *   6. Looking for something? Post a Wanted: the Wanted form, only while 'declutter_wanted' is on for the viewer.
 * Under 18 sees the same notice as the Sell flow (the server refuses selling and buying anyway).
 * Guard: src/components/declutter/declutterSellChooser.test.tsx.
 */
import { Boxes, Gift, HandHelping, Images, Package, Search } from "lucide-react";
import AppPage from "@/components/AppPage";
import { ChoiceCard } from "@/components/ui/ChoiceCard";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useFeature } from "@/hooks/useFeature";
import { sellForMePostJobPath } from "@/lib/declutter/sellForMe";
import { SELL_BUNCH_PATH, SELL_FREE_PATH, SELL_MOVE_PATH, SELL_ONE_PATH, WANTED_POST_PATH } from "@/lib/declutter/sellChooser";
import { StepHead } from "./DeclutterSellSteps";
import { DeclutterNotice } from "./declutterUi";

const ICON = "h-5 w-5";

export default function DeclutterSellChooser() {
  const { underAge } = useAgeGate();
  const movingOut = useFeature("declutter_moving_out");
  const wanted = useFeature("declutter_wanted");
  return (
    <AppPage title="Sell" backTo="/declutter?tab=selling" phoneHidesTitle>
      <div className="mx-auto w-full max-w-xl space-y-5" data-sell-chooser="">
        {underAge ? (
          <DeclutterNotice tone="warn" title="You must be 18 or older to sell on Declutter.">
            You can still look around. Selling opens when your birthday on file says you're 18.
          </DeclutterNotice>
        ) : (
          <section className="flex flex-col gap-3" aria-labelledby="sell-step">
            <StepHead title="What do you want to sell?" sub="Pick one. You can come back and choose another." />
            <ChoiceCard data-sell-choice="one" to={SELL_ONE_PATH} icon={<Package className={ICON} />} title="One item" line="Add photos and we write the listing for you." />
            <ChoiceCard data-sell-choice="bunch" to={SELL_BUNCH_PATH} icon={<Images className={ICON} />} title="Sell a bunch" line="Add photos of everything and we write each listing for you to check." />
            {movingOut && (
              <ChoiceCard data-sell-choice="move" to={SELL_MOVE_PATH} icon={<Boxes className={ICON} />} title="Moving out sale" line="Add photos of everything, and your move date groups them as one sale." />
            )}
            <ChoiceCard data-sell-choice="free" to={SELL_FREE_PATH} icon={<Gift className={ICON} />} title="Give it away free" line="Someone nearby picks it up for free." />
            <ChoiceCard data-sell-choice="helpr" to={sellForMePostJobPath()} icon={<HandHelping className={ICON} />} title="Have a Helpr list it for me" line="A local Helpr takes the photos and writes the listings with you." />
            {wanted && (
              <ChoiceCard data-sell-choice="wanted" to={WANTED_POST_PATH} icon={<Search className={ICON} />} title="Looking for something? Post a Wanted" line="Tell sellers near you what you want and what you'd pay." />
            )}
          </section>
        )}
      </div>
    </AppPage>
  );
}
