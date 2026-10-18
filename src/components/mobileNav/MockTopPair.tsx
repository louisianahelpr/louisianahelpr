import { MessageSquare } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { UserAvatar } from "@/components/UserAvatar";
import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";

/** MOCK-UP ONLY (option 1A): Messages + Profile at the top of Home. */
export function MockTopPair() {
  const { user, profile } = useCurrentUser();
  const { unreadCount } = useNavUnreadCount(user);
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <span className="flex items-center gap-1.5 lg:hidden">
      <button
        type="button"
        aria-label="Messages"
        onClick={() => navigate("/messages")}
        className="relative h-11 w-11 rounded-full flex items-center justify-center"
        style={{ color: "hsl(var(--olivewood))" }}
      >
        <MessageSquare className="w-[21px] h-[21px]" strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span
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
        aria-current={location.pathname === "/profile" ? "page" : undefined}
        onClick={() => navigate("/profile")}
        className="h-11 w-11 rounded-full flex items-center justify-center"
      >
        <UserAvatar
          userId={user?.id}
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
