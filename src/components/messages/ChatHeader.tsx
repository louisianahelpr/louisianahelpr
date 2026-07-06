import { ArrowLeft, Flag, MoreVertical, Ban, BellOff, Bell } from "lucide-react";
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
  /** Open the snooze picker (only invoked when the thread is unmuted). */
  onOpenMuteSheet: () => void;
  /** Toggle mute (used as the fast unmute when already muted). */
  onToggleMute: (convo: Conversation) => void;
  onReportUser: () => void;
  onBlockUser: () => void;
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
  onOpenMuteSheet,
  onToggleMute,
  onReportUser,
  onBlockUser,
}: ChatHeaderProps) {
  return (
    /* Chat header — compact, vertically centered. Avatar uses
       the other user's photo when available, name is brand-
       display italic, and a small status chip surfaces where
       the job currently stands so both sides have shared
       context without scrolling back. */
    <div className="flex items-center gap-2.5 py-2 -mx-4 px-4 border-b border-border bg-card">
      {!hideBack && (
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full h-11 w-11 shrink-0 self-center"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
      )}
      <div
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center shrink-0 self-center overflow-hidden",
          // When no profile photo is set, the warm hashed gradient
          // (keyed off `otherUserId`) replaces the flat bark tint so
          // the chat partner has a stable visual identity. The
          // `<img>` overlay covers the gradient when a photo is set.
          !activeConvo.otherUserAvatarUrl &&
            cn("bg-gradient-to-br", avatarGradientFor(activeConvo.otherUserId)),
        )}
        style={{
          border: "1px solid hsl(var(--bark) / 0.22)",
        }}
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
          <span
            className="text-ds-13 font-bold drop-shadow-sm"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {activeConvo.otherUserName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden self-center">
        <p
          className="font-display italic font-bold leading-tight truncate flex items-center gap-1.5"
          style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          <span className="truncate">{activeConvo.otherUserName}</span>
          <OnlineIndicator isOnline={isOtherOnline} />
          {/* Muted bell — quiet visual mark that notifications are
              silenced for this thread. The aria-label upgrades to
              include the snooze TTL when the mute is time-bound
              ("Muted for 8h") so screen readers don't just say
              "muted" for a one-hour snooze. */}
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
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-ds-11 truncate leading-tight font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {activeConvo.jobTitle}
          </p>
          {activeConvo.jobStatus && (() => {
            const status = activeConvo.jobStatus;
            // Colors come from the canonical `jobStatusColor` map
            // (see `src/lib/statusColors.ts`) so the chat header
            // pill paints identically to every other status chip
            // in the app. Labels come from `jobStatusLabel` (#46).
            //
            // `assigned` isn't in the job_status enum — it's a
            // legacy conversation alias for the offered-not-yet-
            // confirmed window. Keep its bespoke "Awarded" copy
            // and route its color through the sienna-tinted
            // `in_progress` slot so it reads as "in motion".
            const palette =
              status === "assigned"
                ? jobStatusColor("in_progress")
                : jobStatusColor(status);
            const label =
              status === "assigned" ? "Awarded" : jobStatusLabel(status);
            return (
              <span
                className="text-[9px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                style={{ color: palette.text, backgroundColor: palette.bg, letterSpacing: "0.08em" }}
              >
                {label}
              </span>
            );
          })()}
        </div>
      </div>
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
  );
}
