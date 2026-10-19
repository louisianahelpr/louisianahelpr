import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";
import { UserAvatar } from "@/components/UserAvatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";

/**
 * The phone top bar (owner final decisions, 2026-10-19). Right side, in this
 * order: the section's own "+" (sections only), the NOTIFICATIONS bell, the
 * PROFILE avatar at the far right. Left: the logo on Home, the section title
 * elsewhere. Home has no "+". Messages lives in the bottom nav, not here.
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
  const isPost = add?.path === "/post-job";
  const go = () => add && navigate(add.path);
  return (
    <header className="app-top-bar flex items-center justify-between gap-2 h-16" data-testid="app-top-bar">
      {title ? (
        <h1 className="min-w-0 truncate text-page-title text-foreground" title={title}>{title}</h1>
      ) : (
        <HelprMark size="sm" emblemOnly to="/home" />
      )}
      <div className="flex items-center gap-1 min-[360px]:gap-1.5 shrink-0">
        {add && (
          <button
            type="button"
            aria-label={add.label}
            data-testid="section-add"
            onClick={isPost ? gate.gate("post", go) : go}
            {...(isPost ? gate.gatedProps("post") : {})}
            className="btn-press w-10 h-10 rounded-full btn-grad-primary !text-[hsl(var(--parchment))] flex items-center justify-center"
          >
            <Plus className="w-[22px] h-[22px]" strokeWidth={2.4} aria-hidden />
          </button>
        )}
        <span data-testid="top-bar-bell">
          <NotificationPanel triggerClassName="h-11 w-11 [&>svg]:w-[22px] [&>svg]:h-[22px] [&>span]:top-0.5 [&>span]:-right-0.5" />
        </span>
        {user && (
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
