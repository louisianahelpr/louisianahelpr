import { MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { UserAvatar } from "@/components/UserAvatar";
import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";

/**
 * Messages and Profile on Home's top row, next to the bell (owner, 2026-10-18,
 * option 1A): a signed-in member's dock gives their two slots to the section
 * tabs (MobileNav `sectionDock`), so this is their one way to each on a phone.
 * Hidden on web-desktop (`dashboard-title-bell`): the rail lists both there.
 */
export function HomeTopPair() {
  const { user, profile } = useCurrentUser();
  const { unreadCount } = useNavUnreadCount(user);
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <span className="dashboard-title-bell flex items-center gap-1.5 sm:gap-2">
      <button
        type="button"
        aria-label={unreadCount > 0 ? `Messages, ${unreadCount} unread` : "Messages"}
        onClick={() => navigate("/messages")}
        className="relative h-11 w-11 rounded-full flex items-center justify-center ctl-tint"
        style={{ color: "hsl(var(--olivewood))" }}
      >
        <MessageSquare className="w-[21px] h-[21px]" strokeWidth={1.8} aria-hidden />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 min-w-[16px] h-4 rounded-full text-ds-10 flex items-center justify-center font-bold px-1"
            style={{ background: "hsl(var(--burnt-sienna))", color: "hsl(var(--parchment))" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label="Profile"
        onClick={() => navigate("/profile")}
        className="h-11 w-11 rounded-full flex items-center justify-center ctl-tint"
      >
        <UserAvatar
          userId={user.id}
          src={profile?.avatar_url}
          name={profile?.full_name}
          pixelSize={48}
          alt=""
          className="w-[28px] h-[28px]"
          style={{ boxShadow: "0 0 0 1.5px hsl(var(--olivewood) / 0.18)" }}
        />
      </button>
    </span>
  );
}
