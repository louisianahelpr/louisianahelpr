import { memo, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Flag, Ban, Trash2, MoreVertical, BellOff, Bell, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { hapticLight } from "@/lib/haptics";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getMessageAttachmentSignedUrl,
  isImageMime,
} from "@/lib/messageAttachments";
import { jobStatusLabel } from "@/lib/statusLabels";
import { jobStatusColor } from "@/lib/statusColors";
import { avatarGradientFor } from "@/lib/avatarGradient";
import { cn } from "@/lib/utils";
import type { Conversation } from "./types";

interface ConversationRowProps {
  convo: Conversation;
  /** Logged-in user id — used to detect when the last message was sent by
      the current user, which triggers the iMessage-style "You: " prefix. */
  currentUserId: string | null;
  /** Opens this conversation into the chat view. */
  openConvo: (convo: Conversation) => void;
  setReportTarget: Dispatch<SetStateAction<{ type: "message" | "user"; id: string } | null>>;
  setBlockTarget: Dispatch<SetStateAction<{ id: string; name: string } | null>>;
  setDeleteConvoConfirm: Dispatch<SetStateAction<Conversation | null>>;
  /** Toggle the muted state of this thread for the current user.
   *  Legacy path — used as the fast unmute action when the thread is
   *  already muted; the row's "Mute" action prefers `onOpenMuteSheet`. */
  onToggleMute: (convo: Conversation) => void;
  /** Open the snooze picker (MuteSheet) targeted at this conversation. */
  onOpenMuteSheet: (convo: Conversation) => void;
  /** Pinned to the top of the inbox for the current session. Drives the
   *  pin-or-unpin menu item (and is forwarded by the list to the swipe
   *  wrapper so the right-swipe trail reads as "Unpin" on pinned rows). */
  isPinned: boolean;
  /** Toggle the pinned state for this conversation. */
  onTogglePin: () => void;
}

/**
 * Tiny 32×32 image preview for the conversation-row "Photo" case.
 *
 * `messages.attachment_url` stores a storage path, not a URL — but the
 * parent (`loadConversations` in Messages.tsx) now batches the signed-URL
 * resolution into a single `createSignedUrls` call and passes the URL in
 * via `preResolvedUrl`. We only fall back to a per-row fetch when that
 * batched URL is absent (legacy callers or a race where the batch errored
 * on just this path) — eliminating the old N+1 across image-last-message
 * conversations in the inbox.
 */
function LastMessageImageThumb({
  path,
  preResolvedUrl,
}: {
  path: string;
  preResolvedUrl?: string | null;
}) {
  // Seed from the parent-batched URL when present — no fetch at all in
  // the common case. We keep the per-row fetch as a fallback so removing
  // a thread from the batch (or a partial failure) still renders.
  const [url, setUrl] = useState<string | null>(preResolvedUrl ?? null);
  useEffect(() => {
    // If the parent supplied a URL, use it as-is (sync prop changes too,
    // since `loadConversations` may re-run with a refreshed batch).
    if (preResolvedUrl !== undefined && preResolvedUrl !== null) {
      setUrl(preResolvedUrl);
      return;
    }
    // Only pay for a per-row round-trip when the batch didn't cover us.
    let cancelled = false;
    void getMessageAttachmentSignedUrl(path).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => { cancelled = true; };
  }, [path, preResolvedUrl]);
  return (
    <div
      className="shrink-0 w-8 h-8 rounded-ds-sm overflow-hidden"
      style={{
        background: "hsl(var(--ivory-sand) / 0.6)",
        border: "0.5px solid hsl(var(--olivewood) / 0.18)",
      }}
      aria-hidden="true"
    >
      {url ? (
        <img
          loading="lazy"
          decoding="async"
          src={url}
          alt=""
          className="w-full h-full object-cover"
        />
      ) : null}
    </div>
  );
}

/**
 * ConversationRow — a single row in the virtualized inbox list: avatar,
 * iMessage-style preview ("You: " prefix when you sent it, photo
 * thumbnail when the last message was an image attachment), job title +
 * status chip, relative timestamp, far-right unread dot, and the per-
 * row report / block / delete menu.
 */
const ConversationRowBase = ({
  convo: c,
  currentUserId,
  openConvo,
  setReportTarget,
  setBlockTarget,
  setDeleteConvoConfirm,
  onToggleMute,
  onOpenMuteSheet,
  isPinned,
  onTogglePin,
}: ConversationRowProps) => {
  // Relative time so the list reads as "active", not as a stack of
  // full dates.
  const ageMs = Date.now() - new Date(c.lastAt).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  const ageHr = Math.floor(ageMin / 60);
  const ageDay = Math.floor(ageHr / 24);
  const when =
    ageMin < 1 ? "now" :
    ageMin < 60 ? `${ageMin}m` :
    ageHr < 24 ? `${ageHr}h` :
    ageDay < 7 ? `${ageDay}d` :
    new Date(c.lastAt).toLocaleDateString([], { month: "short", day: "numeric" });
  // Status chip — inline next to the job title. Labels come from the
  // canonical `jobStatusLabel` (#46); colors come from the canonical
  // `jobStatusColor` map (`src/lib/statusColors.ts`). Same state, same
  // chip everywhere it appears — chat header, this row, activity card,
  // earnings list. No bespoke per-surface palette.
  //
  // `assigned` isn't in the job_status enum — it's a legacy
  // conversation-row alias for the offered-not-yet-confirmed window.
  // Keep its bespoke "Awarded" copy and route its color through the
  // sienna-tinted `in_progress` slot so it reads as "in motion".
  const statusChip = c.jobStatus && (() => {
    const s = c.jobStatus;
    const allowed: Record<string, true> = {
      open: true, accepted: true, in_progress: true, completed: true,
      cancelled: true, revision_requested: true, disputed: true, assigned: true,
    };
    if (!allowed[s]) return null;
    const palette =
      s === "assigned" ? jobStatusColor("in_progress") : jobStatusColor(s);
    const label = s === "assigned" ? "Awarded" : jobStatusLabel(s);
    return { label, color: palette.text, bg: palette.bg };
  })();

  // Rich-preview derivations.
  // - `sentByMe`: did the current user send the last message? Drives the
  //   muted-italic "You: " prefix (iMessage convention) so the participant
  //   sees at a glance whether they sent or received last.
  // - `lastIsImage`: was the last message an image attachment? Renders a
  //   32×32 thumbnail to the left of the preview and swaps the text body
  //   for "Photo" (no emoji — house brand voice).
  // - `hasUnreadFromOther`: there's an inbound message we haven't read
  //   yet. Drives the 8px sienna dot pinned to the far-right of the row.
  const sentByMe = !!currentUserId && c.lastMessageSenderId === currentUserId;
  const lastIsImage =
    !!c.lastMessageAttachmentPath && isImageMime(c.lastMessageAttachmentMime);
  const hasUnreadFromOther = c.unread > 0;
  const previewBody = lastIsImage
    ? "Photo"
    : (c.lastMessage || "—");

  // Live-presence label — quiet trust signal that lets a poster see a
  // helpr is online *right now* (drives the green "Active now" dot).
  //
  // We intentionally only surface the LIVE state and never a numeric
  // "Xm/Xh/Xd ago" presence age: the far-right `when` already shows a
  // relative last-message time, and a second relative-vs-absolute age
  // sitting beside it read as two conflicting timestamps for one moment
  // ("6h ago" presence next to "May 30" last-message). One timestamp per
  // row — `when` — plus the live dot, no stale presence age.
  // Pulled from the batched `get_user_last_active` RPC in `loadConversations`.
  const lastActiveLabel = (() => {
    if (!c.otherUserLastActiveAt) return null;
    const at = new Date(c.otherUserLastActiveAt);
    const ms = Date.now() - at.getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const m = Math.floor(ms / 60_000);
    if (m < 10) return { text: "Active now", isLive: true };
    return null;
  })();
  return (
    <div
      className="w-full text-left p-3 rounded-ds-md liquid-glass hover:shadow-md transition-shadow flex items-center gap-2.5"
      style={{
        // liquid-glass alone (0.42 white) is near-invisible on the
        // ~0.97-white conversations panel, so each thread blurred into the
        // next. A near-opaque card surface + a stronger hairline border and
        // lift give every thread a clearly readable, separated edge.
        backgroundColor: "hsl(var(--card))",
        border: "1px solid hsl(var(--olivewood) / 0.22)",
        boxShadow: "0 1px 2px hsl(var(--olivewood) / 0.08), 0 6px 16px -4px hsl(var(--olivewood) / 0.12)",
      }}
    >
      {/* Avatar — uses real photo when available, otherwise a per-person
          deterministic warm gradient (hashed off the other user's id) so
          threads read as visually distinct at a glance rather than a stack
          of identical bark circles. */}
      <div
        className={cn(
          "shrink-0 w-11 h-11 rounded-full flex items-center justify-center overflow-hidden self-center bg-gradient-to-br",
          !c.otherUserAvatarUrl && avatarGradientFor(c.otherUserId),
        )}
        style={{ border: "1px solid hsl(var(--olivewood) / 0.20)" }}
      >
        {c.otherUserAvatarUrl ? (
          <img
            loading="lazy"
            decoding="async"
            src={c.otherUserAvatarUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-ds-13 font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
            {c.otherUserName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <button
        onClick={() => openConvo(c)}
        className="flex-1 min-w-0 text-left self-center"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p
                className="font-display italic font-bold truncate"
                style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
              >
                {c.otherUserName}
              </p>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p
                className="text-[0.7rem] truncate font-serif italic"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {c.jobTitle}
              </p>
              {statusChip && (
                // For a cancelled job the chip becomes a tap target: tapping
                // it explains *what* happened (the row's main tap still opens
                // the thread — the badge `stopPropagation`s so the two don't
                // collide). The hit area is padded to ≥44px for touch even
                // though the visible chip stays compact. Non-cancelled
                // statuses stay a plain inert label.
                c.jobStatus === "cancelled" ? (
                  // The chip is rendered as a `role="button"` span (NOT a
                  // <button>) because it lives inside the row's main
                  // open-thread <button> — nested <button>s are invalid
                  // HTML. The span's onClick stops propagation so tapping
                  // the badge reveals the cancellation detail without also
                  // opening the thread. The hit area is padded to ≥44px for
                  // touch even though the visible chip stays compact.
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      hapticLight();
                      // Conversation rows don't carry the cancellation
                      // reason/timestamp (not in the inbox fetch), so we
                      // surface the status + job title — enough to answer
                      // "which one and what happened" at a glance.
                      toast("This job was cancelled.", {
                        description: c.jobTitle,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        hapticLight();
                        toast("This job was cancelled.", {
                          description: c.jobTitle,
                        });
                      }
                    }}
                    aria-label={`This job was cancelled: ${c.jobTitle}. Tap for details.`}
                    className="-my-3 py-3 px-1 inline-flex items-center shrink-0 btn-press cursor-pointer"
                  >
                    <span
                      className="text-[8.5px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                      style={{ color: statusChip.color, backgroundColor: statusChip.bg, letterSpacing: "0.08em" }}
                    >
                      {statusChip.label}
                    </span>
                  </span>
                ) : (
                  <span
                    className="text-[8.5px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ color: statusChip.color, backgroundColor: statusChip.bg, letterSpacing: "0.08em" }}
                  >
                    {statusChip.label}
                  </span>
                )
              )}
              {/* Muted bell-slash — quiet visual mark that this thread
                  has notifications off for the current user. iMessage
                  convention: small icon next to the title/subtitle row,
                  not a full pill, so a muted row reads as "still here,
                  just quiet". */}
              {c.isMuted && (
                <BellOff
                  className="w-3 h-3 shrink-0"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  aria-label="Muted"
                />
              )}
              {/* Last-active pill — quiet trust signal so a poster knows
                  whether the helpr is online right now. Live presence
                  ("Active now") flips the dot to sage-green; older labels
                  drop the dot and read as a muted timestamp. Hidden
                  beyond 7d so a stale signal can't masquerade as live. */}
              {lastActiveLabel && (
                <span
                  aria-label={`Last active ${lastActiveLabel.text}`}
                  className="inline-flex items-center gap-1 shrink-0"
                >
                  {lastActiveLabel.isLive && (
                    <span
                      aria-hidden="true"
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: "hsl(155 60% 40%)",
                        boxShadow: "0 0 4px hsl(155 60% 40% / 0.55)",
                      }}
                    />
                  )}
                  <span
                    className="text-[0.62rem] font-serif italic"
                    style={{
                      color: lastActiveLabel.isLive
                        ? "hsl(155 35% 30%)"
                        : "hsl(var(--olivewood) / 0.8)",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {lastActiveLabel.text}
                  </span>
                </span>
              )}
            </div>
            {/* iMessage-style rich preview row. The image thumbnail (when
                present) sits to the LEFT of the text. The "You: " prefix
                is muted/italic so it doesn't compete with the actual
                content. Bold-ish weight when there's an unread inbound
                message, regular otherwise. */}
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              {lastIsImage && c.lastMessageAttachmentPath && (
                <LastMessageImageThumb
                  path={c.lastMessageAttachmentPath}
                  preResolvedUrl={c.lastMessageAttachmentSignedUrl}
                />
              )}
              <p
                className="text-[0.78rem] truncate min-w-0 flex-1"
                style={{
                  color: hasUnreadFromOther ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.8)",
                  fontWeight: hasUnreadFromOther ? 600 : 400,
                }}
              >
                {sentByMe && (
                  <span
                    className="italic mr-1"
                    style={{ color: "hsl(var(--olivewood) / 0.8)", fontWeight: 400 }}
                  >
                    You:
                  </span>
                )}
                {previewBody}
              </p>
            </div>
          </div>
          <span
            className="text-[0.7rem] shrink-0 self-center whitespace-nowrap"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {when}
          </span>
        </div>
      </button>
      {/* Far-right unread dot — iMessage-style. Shown only when there's
          an unread inbound message; absent on fully-read threads so the
          row stays visually calm. */}
      {hasUnreadFromOther && (
        <span
          aria-label={`${c.unread} unread message${c.unread === 1 ? "" : "s"}`}
          role="status"
          className="shrink-0 w-2 h-2 rounded-full self-center"
          style={{ background: "hsl(var(--burnt-sienna))" }}
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-ds-sm text-muted-foreground hover:bg-secondary transition-colors shrink-0"
            onClick={(e) => e.stopPropagation()}
            aria-label="Conversation options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Mute / unmute — first item so the most-frequent action is
              easiest to reach. When unmuted, opens the snooze picker so
              "1h / 8h / until tomorrow 8 AM / forever" is one tap deep.
              When already muted, this collapses to a fast unmute (the
              picker has its own "Turn back on" path if a user wants to
              extend a snooze instead). */}
          {c.isMuted ? (
            <DropdownMenuItem onClick={() => onToggleMute(c)}>
              <Bell className="w-4 h-4 mr-2" /> Unmute notifications
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => onOpenMuteSheet(c)}>
              <BellOff className="w-4 h-4 mr-2" /> Mute notifications…
            </DropdownMenuItem>
          )}
          {/* Pin / Unpin — session-scoped pin to keep frequent threads
              at the top of the inbox. Same action as the right-swipe
              gesture, surfaced in the menu for discoverability. */}
          <DropdownMenuItem onClick={onTogglePin}>
            {isPinned ? (
              <>
                <PinOff className="w-4 h-4 mr-2" /> Unpin from top
              </>
            ) : (
              <>
                <Pin className="w-4 h-4 mr-2" /> Pin to top
              </>
            )}
          </DropdownMenuItem>
          <div role="separator" className="my-1 h-px bg-border" />
          <DropdownMenuItem onClick={() => setReportTarget({ type: "user", id: c.otherUserId })}>
            <Flag className="w-4 h-4 mr-2" /> Report user
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setBlockTarget({ id: c.otherUserId, name: c.otherUserName })}>
            <Ban className="w-4 h-4 mr-2" /> Block user
          </DropdownMenuItem>
          {/* Divider separates the destructive "Delete conversation"
              action from the report/block items above so it doesn't
              read as a third item of the same weight. */}
          <div role="separator" className="my-1 h-px bg-border" />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteConvoConfirm(c)}>
            <Trash2 className="w-4 h-4 mr-2" /> Delete conversation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export const ConversationRow = memo(ConversationRowBase);
ConversationRow.displayName = "ConversationRow";
