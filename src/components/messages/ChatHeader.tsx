import { useId } from "react";
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
  /** Open the other person's profile — fired by the identity block. */
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
  // The identity button's accessible NAME is fixed ("View <person>'s
  // profile"), which means an aria-label wipes out its text content for a
  // screen reader — including the job line that now lives inside it. Wiring
  // that line up as the button's description keeps it announced.
  const subtitleId = useId();

  return (
    /* Standard messaging-app header, one row deep: back button, then the
       avatar, then the person's name with the job this thread is about
       directly underneath it, then the safety actions pinned right.

       This replaced a centre-stacked variant (avatar alone on its own line,
       name under it, job under that) — four bands of chrome before the first
       message, measured at 129px tall. Everything is in normal flow now:
       nothing is centred against the header, so nothing needs absolute
       positioning to escape a lopsided column, and the whole bar collapses to
       one 60px row — 69px of thread given back.

       The job title carries the context iMessage doesn't need — a
       conversation here is always ABOUT something — so it takes the subtitle
       slot under the name rather than a row of its own. */
    <div
      className="flex items-center gap-1 px-2 py-1.5"
      style={ownsSafeArea ? { paddingTop: "calc(var(--safe-area-top, 0px) + 0.375rem)" } : undefined}
    >
      {!hideBack && (
        <Button
          variant="ghost"
          size="icon"
          /* Deliberately a BARE chevron — the `liquid-glass glass-press` pair
             that used to be here painted a solid white 40px disc with a
             hairline border and a drop shadow, giving a plain "go back"
             control more visual weight than the name it sits next to. Same
             call already made for `BackButton`, `SheetContent`'s close, and
             `DialogContent`'s close: the header paints its own ground, so the
             disc bought nothing but chrome. `rounded-md` now only shapes the
             focus ring.

             The h-10/w-10 box stays: it is the tap target, not the paint. The
             global `button { min-height/min-width: 44px }` rule in index.css
             floors the hit box at 44px regardless of what is drawn inside. */
          className="rounded-md h-10 w-10 shrink-0"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={2.25} />
        </Button>
      )}

      {/* Identity block — avatar + name + job title, all one tappable control
          opening the other person's profile (the destination the avatar
          already implies). Everything inside is phrasing content: a <button>
          may not legally contain <div>/<p>, and it may not contain the page
          heading either — the thread's <h1> is carried separately, sr-only,
          by ChatView.

          `min-w-0` down the inner chain (column, then each text span) is what
          lets the two `truncate` lines actually clip rather than shove the
          flag and overflow buttons off the right edge at 320px — a flex child
          floors at its content width until you say otherwise. On the button
          itself the global `button { min-width: 44px }` tap-target rule in
          index.css outranks `min-w-0` (0,3,1 beats 0,1,0), so the block
          shrinks to 44px and no further, which is the behaviour we want
          anyway. Measured at 320/375/1440: one line each, zero overflow. */}
      <button
        type="button"
        onClick={onViewProfile}
        aria-label={`View ${activeConvo.otherUserName}'s profile`}
        aria-describedby={subtitleId}
        className="min-w-0 flex-1 flex items-center gap-2 py-1 pr-1 rounded-ds-sm text-left btn-press"
      >
        <span
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden",
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
        </span>

        <span className="min-w-0 flex-1 flex flex-col">
          {/* Name line — name, presence/mute marks, then the chevron that
              signals this whole block is a link to the profile. */}
          <span className="flex items-center gap-0.5 w-full min-w-0">
            <span
              className="font-display italic font-bold leading-tight truncate min-w-0 text-ds-16"
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
          </span>

          {/* Subtitle — the job this thread is about, sharing the avatar's
              right-hand column so it reads as one identity block. */}
          <span id={subtitleId} className="flex items-center gap-1.5 w-full min-w-0">
            <span className="text-ds-11 truncate min-w-0 leading-tight font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {activeConvo.jobTitle}
            </span>
            {activeConvo.jobStatus && (() => {
              const status = activeConvo.jobStatus;
              // Colors come from the canonical `jobStatusColor` map so the chat
              // header pill paints identically to every other status chip.
              // `assigned` isn't in the job_status enum — it's a legacy alias for
              // the offered-not-yet-confirmed window, routed through the
              // sienna-tinted `in_progress` slot so it reads as "in motion".
              const palette =
                status === "accepted" ? jobStatusColor("in_progress") : jobStatusColor(status);
              const label = status === "accepted" ? "Awarded" : jobStatusLabel(status);
              return (
                <span
                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ color: palette.text, backgroundColor: palette.bg, letterSpacing: "0.08em" }}
                >
                  {label}
                </span>
              );
            })()}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-0.5 shrink-0">
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
