import { Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";
import { UserAvatar } from "@/components/UserAvatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { Button } from "@/components/ui/button";
import { PageTitleBar } from "@/components/header/PageTitleBar";
import { ExploreSwitcher } from "./ExploreSwitcher";
import type { SectionKey } from "./sectionsConfig";

/** The top bar's icon controls, one size and weight: the section gear and the bell. */
const TOP_BAR_ICON_CLASS = "h-11 w-11 [&>svg]:w-[22px] [&>svg]:h-[22px]";

/**
 * The phone top bar (owner final decisions, 2026-10-19). Right side: the
 * NOTIFICATIONS bell, then the PROFILE avatar at the far right. Left: the logo
 * on Home, the section title elsewhere. Messages lives in the bottom nav.
 *
 * NO SECTION "+" ANYWHERE (owner, 2026-10-28, desktop: "do we need the post a
 * job since the create is to post etc?"): creating lives in ONE place, the left
 * rail's "+ Create" on the desktop website and the bottom bar's center "+" on a
 * phone. Guard: src/test/topBarAddMatchesBell.test.ts.
 *
 * ON THE DESKTOP WEBSITE the app's own header already carries the logo and the
 * bell, and the rail carries Profile, so the bar keeps only the section title;
 * on Home (no title) it draws nothing (Q2221: two logos and two bells at 1440).
 * Guard: src/test/desktopTopBarNoDuplicates.test.tsx.
 */
export function AppTopBar({
  title: sectionTitle,
  explore = false,
  section,
  showProfile = true,
  settings,
  desktopGap = true,
}: {
  /** Omit on Home: the logo shows instead. */
  title?: string;
  /**
   * One of Explore's four sections (2026-10-20, mock-up 6 + HELPR-DESIGN-SPEC
   * §3): on a PHONE the bar reads "Explore" (the switcher under it names the
   * section). The desktop website keeps the section's title. Guard:
   * src/test/centerCreateNav.test.tsx.
   */
  explore?: boolean;
  /**
   * The Explore section this bar heads (owner, 2026-10-22, the Explore header): on a PHONE the bar is the four
   * section chips (ExploreSwitcher) on one line with the bell and the photo, and no visible title (the section's
   * name stays the page's one h1, for a screen reader). The section's gear moves to its tabs row (SectionTabs `end`).
   */
  section?: SectionKey;
  /** False on You itself (board 18): the bar keeps only the bell, since you are already on your profile. */
  showProfile?: boolean;
  /**
   * The section's settings, as a GEAR (owner, 2026-10-21: Jobs settings moved from a card at the foot
   * of Posted / Working into the header). Same 44px control as the bell.
   */
  settings?: { label: string; path: string };
  /** False inside PageScaffold's title card (Jobs, Messages), which pads itself. */
  desktopGap?: boolean;
}) {
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const isWebDesktop = useIsWebDesktop();
  const phoneExplore = explore && !isWebDesktop;
  const chipsRow = phoneExplore && !!section;
  const title = chipsRow ? sectionTitle : phoneExplore ? "Explore" : sectionTitle;
  if (isWebDesktop && !title && !settings) return null;
  const actions = settings ? (
    <>
      {settings && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={settings.label}
          data-testid="section-settings"
          onClick={() => navigate(settings.path)}
          className={TOP_BAR_ICON_CLASS}
        >
          <Settings aria-hidden />
        </Button>
      )}
    </>
  ) : null;
  // The bell and the photo: the same two controls on every phone bar.
  const personal = (
    <>
      {!isWebDesktop && (
      <span data-testid="top-bar-bell">
        <NotificationPanel triggerClassName="h-11 w-11 [&>svg]:w-[22px] [&>svg]:h-[22px] [&>span]:top-0.5 [&>span]:-right-0.5" />
      </span>
      )}
      {user && !isWebDesktop && showProfile && (
        <button
          type="button"
          aria-label="Profile"
          data-testid="top-bar-profile"
          onClick={() => navigate("/profile")}
          className="btn-press h-10 w-10 rounded-full flex items-center justify-center"
        >
          <UserAvatar userId={user.id} src={profile?.avatar_url} name={profile?.full_name} pixelSize={72} alt="" className="w-9 h-9" />
        </button>
      )}
    </>
  );
  // ONE header row (owner 2026-10-21): on the desktop website the title and the
  // gear go into the global top bar beside the bell and photo.
  return (
    <PageTitleBar
      title={title ?? ""}
      actions={actions}
      desktopGap={desktopGap}
      phone={
        !(chipsRow && section) ? (
        <header className="app-top-bar flex items-center justify-between gap-2 h-16" data-testid="app-top-bar">
          {title ? (
            <h1 className="min-w-0 truncate text-page-title text-foreground" title={title}>{title}</h1>
          ) : (
            <HelprMark size="sm" emblemOnly to="/home" />
          )}
          <div className="flex items-center gap-1 min-[360px]:gap-1.5 shrink-0">
            {actions}
            {personal}
          </div>
        </header>
        ) : (
          // THE EXPLORE HEADER'S TOP ROW (owner, 2026-10-22): no "Explore" title; the section chips on one line with
          // the bell and the photo, 48px (the chips' own height). Guard: src/test/exploreHeaderSteady.test.ts.
          <header className="app-top-bar explore-top-row flex items-center gap-1 h-12" data-testid="app-top-bar">
            <h1 className="sr-only">{title}</h1>
            <div className="min-w-0 flex-1">
              <ExploreSwitcher current={section} />
            </div>
            <div className="flex items-center gap-1 shrink-0">{personal}</div>
          </header>
        )
      }
    />
  );
}

/**
 * The section's settings gear where the Explore header's chips row has no room for it (owner, 2026-10-22): the end
 * of the section's tabs row, on a phone. The same 44px ghost control as the bar's own gear.
 */
export function SectionSettingsButton({ settings }: { settings: { label: string; path: string } }) {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={settings.label}
      data-testid="section-settings"
      onClick={() => navigate(settings.path, { replace: false })}
      className={`${TOP_BAR_ICON_CLASS} shrink-0`}
    >
      <Settings aria-hidden />
    </Button>
  );
}
