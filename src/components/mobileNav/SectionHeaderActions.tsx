import { useNavigate } from "react-router-dom";
import { MessageSquare, Plus } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import { UserAvatar } from "@/components/UserAvatar";
import { prefetchRoute } from "@/lib/routePrefetch";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useAgeGate } from "@/hooks/useAgeGate";
import { SECTION_NAV, type SectionKey } from "@/components/mobileNav/sectionNav";

/**
 * The trailing cluster of every SECTION header (owner, 2026-10-18, G1: "+ pill
 * and Messages in the same spot" on every section): a labeled '+ <action>'
 * pill, the section's Messages button, then you (the avatar opens Profile, G3).
 * There is NO '+' in the bottom bar; posting lives here.
 *
 * Messages opens the inbox filtered to this section (`/messages?section=`).
 * Every control is at least 44px (min-h-11 / h-11 w-11).
 *
 * `post` overrides the section's default pill (Shops: "Open a shop" when the
 * member has none); `post={null}` hides it.
 */
export function SectionHeaderActions({
  section,
  post,
  placement = "page",
}: {
  section: SectionKey;
  post?: { label: string; onClick: () => void; disabled?: boolean } | null;
  /** "topbar": DesktopTopNav's copy (Messages + you, no pill). On the desktop
   *  website a page header shows only its pill, so the two never repeat. */
  placement?: "page" | "topbar";
}) {
  const isWebDesktop = useIsWebDesktop();
  const showPersonal = placement === "topbar" || !isWebDesktop;
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const { unreadCount } = useNavUnreadCount(user);
  const def = SECTION_NAV.find((s) => s.key === section)!;
  // Q1586(c): posting a job greys out under 18; a tap says why.
  const { gate } = useAgeGate();
  const go = (path: string) => () => navigate(path);
  const pill =
    post === null
      ? null
      : post ??
        (def.post
          ? { label: def.post.label, onClick: def.key === "jobs" ? gate("post", go(def.post.path)) : go(def.post.path), disabled: false }
          : null);
  const inbox = section === "home" ? "/messages" : `/messages?section=${section}`;
  return (
    <div className="flex items-center gap-1.5 shrink-0" data-section-actions={section}>
      {pill && (
        <button
          type="button"
          onClick={pill.onClick}
          disabled={pill.disabled}
          className="inline-flex min-h-11 items-center gap-1 rounded-full px-3.5 text-ds-14 font-semibold whitespace-nowrap transition-transform active:scale-[0.97] disabled:opacity-60"
          style={{ backgroundColor: "hsl(var(--brand))", color: "hsl(var(--brand-foreground))" }}
        >
          <Plus className="h-4 w-4" strokeWidth={2.75} aria-hidden />
          {pill.label}
        </button>
      )}
      {showPersonal && (
      <>
      <button
        type="button"
        onClick={() => navigate(inbox)}
        onMouseEnter={() => prefetchRoute("/messages")}
        aria-label={
          section === "home"
            ? `Messages${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`
            : `${def.label} messages`
        }
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full ctl-tint"
        style={{ color: "hsl(var(--ink-deep))" }}
      >
        <MessageSquare className="h-5 w-5" strokeWidth={2} aria-hidden />
        {section === "home" && unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-ds-10 font-bold"
            style={{ background: "hsl(var(--burnt-sienna))", color: "hsl(var(--parchment))" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => navigate("/profile")}
        onMouseEnter={() => prefetchRoute("/profile")}
        aria-label="Your profile"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full"
      >
        <UserAvatar
          userId={user?.id}
          src={profile?.avatar_url ?? null}
          name={profile?.full_name ?? null}
          pixelSize={32}
          className="h-8 w-8"
          alt=""
        />
      </button>
      </>
      )}
    </div>
  );
}

export default SectionHeaderActions;
