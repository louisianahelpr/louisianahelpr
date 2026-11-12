/**
 * Design audit A D3 (owner approved 11-08, change 5 of 5): a new member's Dashboard is ONE welcome card with the starting
 * actions, instead of three cards that each say "nothing" ("You're all caught up", "Nothing booked yet.", the
 * checklist). The jobs near them follow it (FirstJobHome's existing jobs-near-you read; no new request).
 *
 * "Post a job" goes through the same age gate as the Create pill (useAgeGate "post", like SectionCreateFab); the ID
 * check stays where it is (at post). "Sell something" shows only while Declutter is live for this member.
 * Guard: src/test/homeWelcomeCard.test.tsx.
 */
import { Briefcase, Search, Sofa } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GroupRow } from "@/components/sections/StatusBoxes";
import { useAgeGate } from "@/hooks/useAgeGate";
import { hapticMedium } from "@/lib/haptics";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";
import "@/lib/i18n/enHome";
import { useLanguage } from "@/lib/i18n/language";

const ICON = "w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-muted";

export function WelcomeCard({ sell }: { sell: boolean }) {
  const navigate = useNavigate();
  const gate = useAgeGate();
  const { t } = useLanguage();
  const post = () => { hapticMedium(); navigate("/post-job"); };
  return (
    <section data-testid="home-welcome" aria-labelledby="home-welcome-title" className="flex flex-col gap-2">
      <h2 id="home-welcome-title" className="font-moment text-ds-22 leading-tight text-foreground px-1">{t("home.wc.title")}</h2>
      <div className="liquid-glass flex flex-col overflow-hidden">
        <GroupRow
          leading={<span aria-hidden className={ICON}><Briefcase className="w-5 h-5 text-primary" /></span>}
          title={t("home.wc.post")}
          meta={t("home.wc.postMeta")}
          onClick={gate.gate("post", post)}
        />
        <GroupRow
          leading={<span aria-hidden className={ICON}><Search className="w-5 h-5 text-primary" /></span>}
          title={t("home.wc.find")}
          meta={t("home.wc.findMeta")}
          onClick={() => navigate("/jobs")}
          last={!sell}
        />
        {sell && (
          <GroupRow
            leading={<span aria-hidden className={ICON}><Sofa className="w-5 h-5 text-primary" /></span>}
            title={t("home.wc.sell")}
            meta={t("home.wc.sellMeta")}
            onClick={() => navigate(SELL_CHOOSER_PATH)}
            last
          />
        )}
      </div>
    </section>
  );
}
