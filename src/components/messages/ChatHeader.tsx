import { ChevronLeft, ChevronRight, Flag, MoreVertical, Ban, BellOff, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OnlineIndicator } from "@/components/ChatPresence";
import { avatarGradientFor } from "@/lib/avatarGradient";
import { cn } from "@/lib/utils";
import { jobStatusLabel } from "@/lib/statusLabels";
import { jobStatusColor } from "@/lib/statusColors";
import { snoozeRemainingLabel } from "@/lib/threadMutes";
import type { Conversation } from "./types";

interface ChatHeaderProps {
  activeConvo: Conversation;
  isOtherOnline: boolean;
  /** Leave the thread, back to the inbox. */
  onBack: () => void;
  /** Desktop split keeps the inbox permanently visible to the left, so the
   *  back arrow has nowhere to go — hide it there. Defaults to false
   *  (mobile/native always show it). */
  hideBack?: boolean;
  /**
   * True when this is the top-most element against the status bar — i.e.
   * standalone/native, where it sits in AppShell's header slot.
   *
   * An open thread no longer renders the app nav bar above it, so the inset
   * that bar used to absorb is now this header's job. AppShell's wrapper is a
   * transparent positioning shell and deliberately does NOT add it: applying
   * it in both places would double-count the notch gap. False when embedded
   * in the desktop two-pane layout, which isn't against the status bar.
   */
  ownsSafeArea?: boolean;
  /** Open the snooze picker (only invoked when the thread is unmuted). */
  onOpenMuteSheet: () => void;
  /** Toggle mute (used as the fast unmute when already muted). */
  onToggleMute: (convo: Conversation) => void;
  onReportUser: () => void;
  onBlockUser: () => void;
  /** Open the other person's profile — fired by the name pill's chevron. */
  onViewProfile: () => void;
}

/**
 * ChatHeader — the compact header bar of the active conversation: back
 * button, avatar, name + presence/mute marks, job-title + status chip,
 * and the report / options affordances. Extracted verbatim from ChatView
 * (presentational only — every action is threaded down as a callback).
 */
export function ChatHeader({
  activeConvo,
  isOtherOnline,
  onBack,
  hideBack = false,
  ownsSafeArea = false,
  onOpenMuteSheet,
  onToggleMute,
  onReportUser,
  onBlockUser,
  onViewProfile,
}: ChatHeaderProps) {
  return (
    /* Chat header — compact, vertically centered. Avatar uses
       the other user's photo when available, name is brand-
       display italic, and a small status chip surfaces where
       the job currently stands so both sides have shared
       context without scrolling back. */
    /* iMessage-shaped header: back on the left, the person centered
       (avatar stacked over a tappable name pill), actions on the right.
       Matches the reference the owner supplied.

       The centre column is centred against the HEADER, not against the
       leftover space, so the back button and the action buttons are absolutely
       positioned. Laying them out in normal flow would push the name
       off-centre by however much wider one side happened to be — and the two
       sides are never the same width here.

       The job title + status sit under the name pill, which is exactly where
       iMessage puts its own small grey subtitle ("iMessage · Encrypted"). The
       reference has a slot for this; ours carries the job the thread is about,
       because unlike iMessage a conversation here is always ABOUT something. */
    <div
      className="relative flex flex-col items-center px-2 pb-2 pt-2"
      style={ownsSafeArea ? { paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" } : undefined}
    >
      {!hideBack && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full h-10 w-10 shrink-0 liquid-glass glass-press z-10"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={2.25} />
        </Button>
      )}

      {/* Avatar — larger than the old 36px inline version because it is now
          the header's focal point rather than a bullet before the name. */}
      <div
        className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center shrink-0 overflow-hidden",
          // When no profile photo is set, the warm hashed gradient
          // (keyed off `otherUserId`) replaces the flat bark tint so
          // the chat partner has a stable visual identity.
          !activeConvo.otherUserAvatarUrl &&
            cn("bg-gradient-to-br", avatarGradientFor(activeConvo.otherUserId)),
        )}
        style={{ border: "1px solid hsl(var(--bark) / 0.22)" }}
      >
        {activeConvo.otherUserAvatarUrl ? (
          <img
            loading="lazy"
            decoding="async"
            src={activeConvo.otherUserAvatarUrl}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-ds-15 font-bold drop-shadow-sm" style={{ color: "hsl(var(--ink-deep))" }}>
            {activeConvo.otherUserName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Name pill — tappable, with a trailing chevron, exactly as in the
          reference. It opens the other person's profile, which is the same
          destination the avatar implies. */}
      <button
        type="button"
        onClick={onViewProfile}
        className="mt-1 max-w-full inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full btn-press"
        aria-label={`View ${activeConvo.otherUserName}'s profile`}
      >
        <span
          className="font-display italic font-bold leading-tight truncate text-ds-16"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          {activeConvo.otherUserName}
        </span>
        <OnlineIndicator isOnline={isOtherOnline} />
        {activeConvo.isMuted && (() => {
          const remaining = snoozeRemainingLabel(activeConvo.muteUntil ?? null);
          return (
            <BellOff
              className="w-3 h-3 shrink-0"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              aria-label={remaining ?? "Muted"}
            />
          );
        })()}
        <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.65)" }} />
      </button>

      {/* Subtitle — the job this thread is about. */}
      <div className="flex items-center justify-center gap-1.5 max-w-full px-6">
        <p className="text-ds-11 truncate leading-tight font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {activeConvo.jobTitle}
        </p>
        {activeConvo.jobStatus && (() => {
          const status = activeConvo.jobStatus;
          // Colors come from the canonical `jobStatusColor` map so the chat
          // header pill paints identically to every other status chip.
          // `assigned` isn't in the job_status enum — it's a legacy alias for
          // the offered-not-yet-confirmed window, routed through the
          // sienna-tinted `in_progress` slot so it reads as "in motion".
          const palette =
            status === "assigned" ? jobStatusColor("in_progress") : jobStatusColor(status);
          const label = status === "assigned" ? "Awarded" : jobStatusLabel(status);
          return (
            <span
              className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
              style={{ color: palette.text, backgroundColor: palette.bg, letterSpacing: "0.08em" }}
            >
              {label}
            </span>
          );
        })()}
      </div>

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
      {/* Quick-report shortcut — one-tap surface for the most
          urgent safety action. The same handler is reachable via
          the MoreVertical dropdown ("Report user") for users who
          look there first; the Flag button saves one tap for users
          who need it urgently and scan the header icons. */}
      <button
        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-ds-sm text-muted-foreground hover:bg-secondary transition-colors shrink-0 self-center"
        aria-label="Report user"
        onClick={onReportUser}
      >
        <Flag className="w-4 h-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-ds-sm text-muted-foreground hover:bg-secondary transition-colors shrink-0 self-center"
            aria-label="Conversation options"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Mute / unmute — top item so the most-frequent action
              is one tap. When unmuted, opens the snooze picker
              ("1h / 8h / until tomorrow 8 AM / forever"). When
              already muted, this collapses to a fast unmute. */}
          {activeConvo.isMuted ? (
            <DropdownMenuItem onClick={() => onToggleMute(activeConvo)}>
              <Bell className="w-4 h-4 mr-2" /> Unmute notifications
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onOpenMuteSheet}>
              <BellOff className="w-4 h-4 mr-2" /> Mute notifications…
            </DropdownMenuItem>
          )}
          <div role="separator" className="my-1 h-px bg-border" />
          <DropdownMenuItem onClick={onReportUser}>
            <Flag className="w-4 h-4 mr-2" /> Report user
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onBlockUser}>
            <Ban className="w-4 h-4 mr-2" /> Block user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </div>
  );
}
