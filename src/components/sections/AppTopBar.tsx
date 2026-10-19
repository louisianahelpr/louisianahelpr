import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";
import { UserAvatar } from "@/components/UserAvatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { Button } from "@/components/ui/button";

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
  title,
  add,
}: {
  /** Omit on Home: the logo shows instead. */
  title?: string;
  add?: { label: string; path: string };
}) {
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const gate = useAgeGate();
  const isWebDesktop = useIsWebDesktop();
  const isPost = add?.path === "/post-job";
  const go = () => add && navigate(add.path);
  if (isWebDesktop && !title && !add) return null;
  return (
    <header className="app-top-bar flex items-center justify-between gap-2 h-16" data-testid="app-top-bar">
      {title ? (
        <h1 className="min-w-0 truncate text-page-title text-foreground" title={title}>{title}</h1>
      ) : (
        <HelprMark size="sm" emblemOnly to="/home" />
      )}
      <div className="flex items-center gap-1 min-[360px]:gap-1.5 shrink-0">
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
        {!isWebDesktop && (
        <span data-testid="top-bar-bell">
          <NotificationPanel triggerClassName={`${TOP_BAR_ICON_CLASS} [&>span]:top-0.5 [&>span]:-right-0.5`} />
        </span>
        )}
        {user && !isWebDesktop && (
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
  );
}
