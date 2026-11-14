/**
 * Design audit A D3 (owner approved 11-08, change 5 of 5): a new member's Dashboard is ONE welcome card with the starting
 * actions, instead of three cards that each say "nothing" ("You're all caught up", "Nothing booked yet.", the
 * checklist). The jobs near them follow it (FirstJobHome's existing jobs-near-you read; no new request).
 *
 * "Post a job" goes through the same age gate as the Create pill (useAgeGate "post", like SectionCreateFab); the ID
 * check stays where it is (at post). "Sell something" shows only while Declutter is live for this member.
 * Owner 11-14 (new members saw Home once and left): "Find work" and "Sell something" are two big tiles, "Post a job" a row
 * under them (with Declutter closed, Post a job is the second tile); the Get started guide and the jobs and items near
 * them follow (NewMemberHome). Guards: src/test/homeWelcomeCard.test.tsx, src/test/newMemberHome1114.test.tsx.
 */
import { Briefcase, Search, Sofa } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GroupRow } from "@/components/sections/StatusBoxes";
import { ListRow } from "@/components/ui/ListRow";
import { useAgeGate } from "@/hooks/useAgeGate";
import { hapticMedium } from "@/lib/haptics";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";
import "@/lib/i18n/enNewMember";
import { useLanguage } from "@/lib/i18n/language";

const ICON = "w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-muted";
/** A big starting action (owner 11-14: "Find work" and "Sell something" as two big buttons, "Post a job" under them). */
const TILE = "liquid-glass !rounded-[20px] !min-h-[112px] !flex-col !items-start !justify-between !gap-3 !px-4 !py-4";

export function WelcomeCard({ sell }: { sell: boolean }) {
  const navigate = useNavigate();
  const gate = useAgeGate();
  const { t } = useLanguage();
  const post = () => { hapticMedium(); navigate("/post-job"); };
  const tile = (key: string, Icon: typeof Search, title: string, meta: string, onClick: () => void) => (
    <ListRow key={key} data-welcome-tile={key} onClick={onClick} className={TILE}>
      <span aria-hidden className={ICON}><Icon className="w-5 h-5 text-primary" /></span>
      <span className="flex flex-col min-w-0">
        <span className="text-ds-16 font-bold text-foreground leading-tight">{title}</span>
        <span className="text-ds-13 text-muted-foreground leading-snug">{meta}</span>
      </span>
    </ListRow>
  );
  return (
    <section data-testid="home-welcome" aria-labelledby="home-welcome-title" className="flex flex-col gap-2">
      <h2 id="home-welcome-title" className="font-moment text-ds-22 leading-tight text-foreground px-1">{t("home.wc.title")}</h2>
      <div className="grid grid-cols-2 gap-2">
        {tile("find", Search, t("home.wc.find"), t("home.wc.findMeta"), () => navigate("/jobs"))}
        {sell
          ? tile("sell", Sofa, t("home.wc.sell"), t("home.wc.sellMeta"), () => navigate(SELL_CHOOSER_PATH))
          : tile("post", Briefcase, t("home.wc.post"), t("home.wc.postMeta"), gate.gate("post", post))}
      </div>
      {sell && (
        <div className="liquid-glass flex flex-col overflow-hidden">
          <GroupRow
            leading={<span aria-hidden className={ICON}><Briefcase className="w-5 h-5 text-primary" /></span>}
            title={t("home.wc.post")}
            meta={t("home.wc.postMeta")}
            onClick={gate.gate("post", post)}
            last
          />
        </div>
      )}
    </section>
  );
}
