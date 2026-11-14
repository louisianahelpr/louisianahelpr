import { lazy, Suspense, useState, type ReactNode } from "react";
import { Plus, Settings } from "lucide-react";
import { mineToDoCount, type SectionMineMenu } from "./sectionMine";
import { useNavigate } from "react-router-dom";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/notificationPanel/NotificationBell";
import { UserAvatar } from "@/components/UserAvatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { Button } from "@/components/ui/button";
import { PageTitleBar } from "@/components/header/PageTitleBar";
import { sectionByKey, type SectionAdd, type SectionKey } from "./sectionsConfig";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import { avatarButtonLabel } from "@/lib/avatarImage";
import { COMPACT_TOP_ROW, TITLE_TOP_ROW } from "@/components/sections/browseHeaderSpacing";

// "My Declutter" (etc.) loads on the photo's first tap, never on the first screen.
const MySectionSheet = lazy(() => import("./MySectionSheet"));

/** The tabs row's icon controls (search, filters, map, gear): 40px ghost squares with a 20px glyph, centred on the 44px tabs. */
const TABS_ROW_ICON_CLASS = "h-10 w-10 shrink-0 self-center btn-press text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] [&>svg]:w-5 [&>svg]:h-5";

/** The soft create look (the light olive tint, the olive glyph) of the desktop "+ Post a job". */
const SECTION_ADD_TINT = "rounded-full shadow-none bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] ctl-tint-on-tint";

/** The section's soft "+ Post a job" (etc.) for the DESKTOP bar; the /jobs loading frame draws the same one so the bar
 *  does not change when the page settles (src/test/sectionLoadingHeaderIsSettled.test.tsx). */
export function SectionAddButton({ section, add: own }: { section: SectionKey; add?: SectionAdd }) {
  const navigate = useNavigate();
  const gate = useAgeGate();
  // DESKTOP WEBSITE ONLY: the section's own "+ Post a job" (etc.) beside the bell, in the LIGHTER green, a soft
  // olive tint, clearly second to the rail's solid "+ Create" (owner 2026-10-28: "add the post a job and post an
  // item or whatever buttons back on the top nav maybe just make it the lighter green"). A phone keeps the
  // bottom bar's center "+" and no "+" here. Guard: src/test/topBarAddMatchesBell.test.tsx.
  const add = own ?? sectionByKey(section).add;
  const isPost = add?.path === "/post-job";
  const go = () => add && navigate(add.path);
  if (!add) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={add.label}
      data-testid="section-add"
      onClick={isPost ? gate.gate("post", go) : go}
      {...(isPost ? gate.gatedProps("post") : {})}
      className={`${SECTION_ADD_TINT} px-4 gap-1.5 font-semibold [&>svg]:w-[18px] [&>svg]:h-[18px]`}
    >
      <Plus aria-hidden />
      {add.cta ?? add.label}
    </Button>
  );
}

/**
 * The phone top bar, ONE pattern on every signed-in page (owner UI audit F148, 2026-11-09): the page title on the left
 * (the logo on Dashboard), the NOTIFICATIONS bell and the PROFILE avatar (You) on the right, and a section's search
 * INSIDE the page, as its own row under the bar. Messages and You are bottom-bar tabs since F146, and creating is the
 * floating pill (SectionCreateFab), so the bar's Messages button and "+" left with the 11-08 search-in-the-bar header.
 * Help is inside You, not on the bar. Guard: src/test/centerCreateNav.test.tsx.
 *
 * The desktop website's section bar carries the section's soft "+ Post a job" / "+ Sell an
 * item" / "+ Open a shop" / "+ Add a property" beside the bell (owner 2026-10-28,
 * reversing the same morning's removal). Guard: src/test/topBarAddMatchesBell.test.tsx.
 *
 * ON THE DESKTOP WEBSITE the app's own header already carries the logo and the
 * bell, and the rail carries Profile, so the bar keeps only the section title;
 * on Home (no title) it draws nothing (Q2221: two logos and two bells at 1440).
 * A section's settings gear is never here: it ends the section's tabs row on
 * every width (SectionSettingsButton; owner 2026-10-28, desktop: "move gear down
 * with the other icons"). Guard: src/test/desktopTopBarNoDuplicates.test.tsx.
 */
export function AppTopBar({
  title: sectionTitle,
  explore = false,
  section,
  showProfile = true,
  desktopGap = true,
  search,
  mine,
  showAdd = true,
  add,
}: {
  /** Omit on Dashboard: the logo shows instead. */
  title?: string;
  /**
   * Marks one of the four section screens. Since the nav redesign (owner 2026-11-06) it changes nothing on its own:
   * the phone bar shows the section's own title (the bottom bar switches sections, so the Explore chips row left).
   */
  explore?: boolean;
  /** The section this bar heads: on the desktop website it draws the section's soft "+ Post a job" (etc.). */
  section?: SectionKey;
  /** False on You itself (board 18): the bar keeps only the bell, since you are already on your profile. */
  showProfile?: boolean;
  /** False inside PageScaffold's title card (Jobs, Messages), which pads itself. */
  desktopGap?: boolean;
  /**
   * The section's search (F148, 11-09): on a phone, a full-width row UNDER the bar (it was the bar itself, owner
   * 11-08). `null` (Dashboard) or omitted: no search row. Guard: src/test/centerCreateNav.test.tsx.
   */
  search?: ReactNode;
  /** The section's "My …" menu, opened from the photo (which wears a dot while any row has a to-do). */
  mine?: SectionMineMenu;
  /** False while the section is closed to this member (SectionScreen's showAdd): no "+ Open a shop" on the desktop bar. */
  showAdd?: boolean;
  /** This member's own add action when it differs from the section's (SectionCreateFab's `add`). */
  add?: SectionAdd;
}) {
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const isWebDesktop = useIsWebDesktop();
  const [mineOpen, setMineOpen] = useState(false);
  const [mineAsked, setMineAsked] = useState(false);
  const mineToDo = mineToDoCount(mine);
  const { t: tr } = useLanguage();
  // Nav redesign (owner 2026-11-06): the phone's section bars name their section; the Explore chips row left with
  // Explore (the bottom bar switches sections now). `explore` and `section` stay for the desktop bar.
  void explore;
  const title = sectionTitle;
  if (isWebDesktop && !title) return null;
  const actions = isWebDesktop && showAdd && section && sectionByKey(section).add ? <SectionAddButton section={section} add={add} /> : undefined;
  // The phone bar's right side (F148): the bell, then You. Help is INTO You (You > Help, one tap).
  const personal = (
    <>
      {/* AUD31-74: a guest (Declutter Browse is open to them) has no notifications: no bell, as no photo. */}
      {user && !isWebDesktop && (
      <span data-testid="top-bar-bell">
        <NotificationPanel triggerClassName="h-11 w-11 [&>svg]:w-[22px] [&>svg]:h-[22px] [&>span]:top-0.5 [&>span]:-right-0.5" />
      </span>
      )}
      {user && !isWebDesktop && showProfile && (
        <Button
          type="button"
          variant="ghost"
          size="iconCompact"
          // The initials the photo shows when it has no picture are part of the name (axe label-content-name-mismatch, WCAG 2.5.3).
          aria-label={avatarButtonLabel(mine ? (mineToDo > 0 ? `${mine.title}, ${mineToDo} to do` : mine.title) : tr("nav.profile"), profile?.full_name)}
          {...(mine ? { "aria-haspopup": "dialog" as const, "aria-expanded": mineOpen } : {})}
          data-testid="top-bar-profile"
          onClick={() => { if (mine) { setMineAsked(true); setMineOpen(true); } else navigate("/profile"); }}
          className="relative"
        >
          <UserAvatar userId={user.id} src={profile?.avatar_url} name={profile?.full_name} pixelSize={72} alt="" className="w-9 h-9" />
          {mineToDo > 0 && <span data-top-bar-badge="mine" aria-hidden className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background" style={{ background: "hsl(var(--alert))" }} />}
        </Button>
      )}
    </>
  );
  const mineSheet = mine && mineAsked && (
    <Suspense fallback={null}><MySectionSheet menu={mine} open={mineOpen} onOpenChange={setMineOpen} /></Suspense>
  );
  // ONE header row (owner 2026-10-21): on the desktop website the title goes into
  // the global top bar beside the bell and photo.
  // THE COMPACT TOP (owner 11-14, Depop / Vinted iPhone screenshots: "make our top part more like theirs so we can
  // have more space"): on a phone a page with a search draws ONE row, the search (flex-1) with the bell and the photo
  // inline on its right, 8px under the safe area; the page's name stays as a visually hidden h1 (the bottom bar already
  // says which tab you are on). A page with no search (You, a closed section) keeps its visible title row, 56px.
  // Guard: src/test/compactTopRow.test.tsx.
  return (
    <PageTitleBar
      title={title ?? ""}
      actions={actions}
      desktopGap={desktopGap}
      phone={
        search ? (
          <header className={COMPACT_TOP_ROW} data-testid="app-top-bar" data-compact-top="">
            {title && <h1 className="sr-only">{title}</h1>}
            <div data-testid="app-top-bar-search" className="min-w-0 flex-1">{search}</div>
            <div className="flex items-center shrink-0">
              {personal}
            </div>
            {mineSheet}
          </header>
        ) : (
          <header className={TITLE_TOP_ROW} data-testid="app-top-bar">
            {title ? (
              <h1 className="min-w-0 truncate text-page-title text-foreground" title={title}>{title}</h1>
            ) : (
              <HelprMark size="sm" emblemOnly to="/home" />
            )}
            <div className="flex items-center shrink-0 gap-1">
              {personal}
            </div>
            {mineSheet}
          </header>
        )
      }
    />
  );
}

/**
 * The section's settings GEAR (owner, 2026-10-21: Jobs settings moved from a card at the foot of Posted / Working into
 * the header): the LAST control at the right end of the section's tabs row, on every tab and every width (phone, owner
 * 2026-10-22: the chips row has no room; desktop, owner 2026-10-28: "move gear down with the other icons"), so it
 * never jumps between tabs. The same 40px ghost square as the row's search, filters and map.
 * Guard: src/test/profileIsAccountMoneyHelp.test.tsx.
 */
export function SectionSettingsButton({ settings }: { settings: { label: string; labelKey?: MsgKey; path: string } }) {
  const navigate = useNavigate();
  const { t: tr } = useLanguage();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={settings.labelKey ? tr(settings.labelKey) : settings.label}
      data-testid="section-settings"
      onClick={() => navigate(settings.path, { replace: false })}
      className={TABS_ROW_ICON_CLASS}
    >
      <Settings aria-hidden />
    </Button>
  );
}
