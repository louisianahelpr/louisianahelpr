import { Plus, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";
import { UserAvatar } from "@/components/UserAvatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { Button } from "@/components/ui/button";
import { PageTitleBar } from "@/components/header/PageTitleBar";

/** The top bar's icon controls, one size and weight: the section "+" and the bell. */
const TOP_BAR_ICON_CLASS = "h-11 w-11 [&>svg]:w-[22px] [&>svg]:h-[22px]";

/**
 * The phone top bar (owner final decisions, 2026-10-19). Right side, in this
 * order: the section's own "+" (sections only), the NOTIFICATIONS bell, the
 * PROFILE avatar at the far right. Left: the logo on Home, the section title
 * elsewhere. Home has no "+". Messages lives in the bottom nav, not here.
 * The "+" is a plain icon button the same size and weight as the bell (owner,
 * 2026-10-19: no longer the loudest thing in the bar; it was a filled olive
 * circle). Guard: src/test/topBarAddMatchesBell.test.ts.
 *
 * ON THE DESKTOP WEBSITE the app's own header already carries the logo and the
 * bell, and the rail carries Profile, so the bar keeps only the section title
 * and its "+"; on Home (no title, no "+") it draws nothing (Q2221: two logos and
 * two bells at 1440). Guard: src/test/desktopTopBarNoDuplicates.test.tsx.
 */
export function AppTopBar({
  title: sectionTitle,
  add: sectionAdd,
  explore = false,
  showProfile = true,
  settings,
  desktopGap = true,
}: {
  /** Omit on Home: the logo shows instead. */
  title?: string;
  add?: { label: string; path: string };
  /**
   * One of Explore's four sections (2026-10-20, mock-up 6 + HELPR-DESIGN-SPEC
   * §3): on a PHONE the bar reads "Explore" (the switcher under it names the
   * section) and carries no "+", because the bottom bar's center "+" creates.
   * The desktop website has no center "+", so there it keeps the section's
   * title and "+". Guard: src/test/centerCreateNav.test.tsx.
   */
  explore?: boolean;
  /** False on You itself (board 18): the bar keeps only the bell, since you are already on your profile. */
  showProfile?: boolean;
  /**
   * The section's settings, as a GEAR right of the "+" (owner, 2026-10-21: Jobs settings moved from a
   * card at the foot of Posted / Working into the header). Same 44px control as the "+" and the bell,
   * on phone and desktop.
   */
  settings?: { label: string; path: string };
  /** False inside PageScaffold's title card (Jobs, Messages), which pads itself. */
  desktopGap?: boolean;
}) {
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const gate = useAgeGate();
  const isWebDesktop = useIsWebDesktop();
  const phoneExplore = explore && !isWebDesktop;
  const title = phoneExplore ? "Explore" : sectionTitle;
  const add = phoneExplore ? undefined : sectionAdd;
  const isPost = add?.path === "/post-job";
  const go = () => add && navigate(add.path);
  if (isWebDesktop && !title && !add && !settings) return null;
  const actions = (add || settings) ? (
    <>
      {add && (
        // The SAME control as the bell beside it: ghost icon Button, 44px,
        // 22px glyph (NotificationPanel's triggerClassName below).
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={add.label}
          data-testid="section-add"
          onClick={isPost ? gate.gate("post", go) : go}
          {...(isPost ? gate.gatedProps("post") : {})}
          className={TOP_BAR_ICON_CLASS}
        >
          <Plus aria-hidden />
        </Button>
      )}
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
  // ONE header row (owner 2026-10-21): on the desktop website the title and the
  // "+" / gear go into the global top bar beside the bell and photo.
  return (
    <PageTitleBar
      title={title ?? ""}
      actions={actions}
      desktopGap={desktopGap}
      phone={
        <header className="app-top-bar flex items-center justify-between gap-2 h-16" data-testid="app-top-bar">
          {title ? (
            <h1 className="min-w-0 truncate text-page-title text-foreground" title={title}>{title}</h1>
          ) : (
            <HelprMark size="sm" emblemOnly to="/home" />
          )}
          <div className="flex items-center gap-1 min-[360px]:gap-1.5 shrink-0">
            {actions}
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
          </div>
        </header>
      }
    />
  );
}
