/**
 * HOME'S MORE ROWS (owner polish 11-20: "fill the empty space with useful rows"). Two small blocks for Home's main
 * column, under Coming up:
 *   - "Recent messages": the last 3 conversations, each opening its thread. The SAME query (key and loader) the
 *     Messages inbox and the dock's long-press preview use (useRecentConversationsPreview), so the caches are shared:
 *     opening Messages after Home paints from this read, and back. Nothing drawn with no conversation or on a failed read.
 *   - "Your active listings and jobs": the member's own open posted jobs and live Declutter listings, from the reads
 *     Home already made (useHomeSummary's `active`); no request of its own. Nothing drawn with none.
 * Loaded on its own (HomeDashboard lazy()), only once the page has settled, never with Home's first screen (/home's
 * critical-path budget). Guard: src/test/homeMoreRows1120.test.tsx.
 */
import { useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { MessageCircle, Briefcase, Sofa } from "lucide-react";
import { GroupRow, GroupSection } from "@/components/sections/StatusBoxes";
import { useRecentConversationsPreview } from "@/components/mobileNav/useRecentConversationsPreview";
import { conversationLink } from "@/lib/teamThread";
import { formatPrice } from "@/lib/declutter/formatPrice";
import { useMemo } from "react";
import { deriveHomeActive, type HomeActiveItem, type HomeActiveSource } from "./homeActive";
import "@/lib/i18n/enHome";
import "@/lib/i18n/enHomeMore";
import "@/lib/i18n/enNewMember";
import { useLanguage } from "@/lib/i18n/language";

/** How many of each block's rows Home shows; See all opens the rest. */
const HOME_MORE_SHOWN = 3;

const LEAD = "w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-muted overflow-hidden";
/** Phone polish C #17 (11-25): a section icon stands alone, 20px, no grey circle (an avatar keeps LEAD's round well). */
const ICON_LEAD = "w-6 h-6 shrink-0 flex items-center justify-center";

export function RecentMessagesRows({ user }: { user: User | null | undefined }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { recent } = useRecentConversationsPreview(user, true);
  const rows = (recent ?? []).slice(0, HOME_MORE_SHOWN);
  if (rows.length === 0) return null;
  return (
    <div data-home-recent-messages="">
      <GroupSection title={t("home.more.messages")} onSeeAll={() => navigate("/messages")} seeAllLabel={t("home.ns.seeAll")}>
        {rows.map((c, i) => (
          <GroupRow
            key={`${c.jobId}_${c.otherUserId}`}
            leading={
              <span aria-hidden className={LEAD}>
                {c.otherUserAvatarUrl
                  ? <img loading="lazy" decoding="async" src={c.otherUserAvatarUrl} alt="" className="h-full w-full object-cover" />
                  : <MessageCircle className="w-5 h-5 text-primary" />}
              </span>
            }
            title={<span className={c.unread > 0 ? "font-bold" : undefined}>{c.otherUserName}</span>}
            meta={c.lastMessage || c.jobTitle}
            right={c.unread > 0 ? <span data-home-message-unread="" role="img" aria-label={t("home.more.unread")} className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" /> : undefined}
            onClick={() => navigate(conversationLink(c))}
            last={i === rows.length - 1}
          />
        ))}
      </GroupSection>
    </div>
  );
}

export function ActiveRows({ active }: { active: readonly HomeActiveItem[] }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const rows = active.slice(0, HOME_MORE_SHOWN);
  if (rows.length === 0) return null;
  const jobsOnly = rows.every((r) => r.kind === "job");
  return (
    <div data-home-active="">
      <GroupSection
        title={t("home.more.active")}
        onSeeAll={active.length > rows.length ? () => navigate(jobsOnly ? "/jobs?tab=posted" : "/declutter?tab=selling") : undefined}
        seeAllLabel={t("home.ns.seeAll")}
      >
        {rows.map((r, i) => {
          const Icon = r.kind === "job" ? Briefcase : Sofa;
          const meta = r.kind === "job"
            ? (r.applicants > 0 ? (r.applicants === 1 ? t("home.more.applicant1") : t("home.more.applicantsN", { n: r.applicants })) : t("home.more.jobOpen"))
            : `${r.priceCents === 0 ? t("home.ns.free") : formatPrice(r.priceCents)} · ${t("home.more.listed")}`;
          return (
            <GroupRow
              key={r.id}
              leading={<span aria-hidden data-home-active-kind={r.kind} className={ICON_LEAD}><Icon className="w-5 h-5 text-primary" /></span>}
              title={r.title}
              meta={meta}
              onClick={() => navigate(r.to)}
              last={i === rows.length - 1}
            />
          );
        })}
      </GroupSection>
    </div>
  );
}

/** Both blocks, under Coming up (HomeDashboard lazy-loads this as one chunk). */
// The list is derived HERE, in this lazy chunk, from the reads useHomeSummary hands over (`activeFrom`), so the
// derivation never rides Home's first load (/home's critical-path budget, 11-20).
export default function HomeMoreRows({ user, from }: { user: User | null | undefined; from?: HomeActiveSource }) {
  const active = useMemo(() => (from ? deriveHomeActive(from.postedJobs, from.pendingApplicantCounts, from.items) : []), [from]);
  return (
    <div data-home-more="" className="flex flex-col gap-section empty:hidden">
      <RecentMessagesRows user={user} />
      <ActiveRows active={active} />
    </div>
  );
}
