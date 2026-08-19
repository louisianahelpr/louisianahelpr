import { memo, useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { BellOff, Check } from "lucide-react";
import {
  getMessageAttachmentSignedUrl,
  isImageMime,
} from "@/lib/messageAttachments";
import { report } from "@/lib/errorLogger";
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
  /** Highlighted as the open thread in the desktop list+thread split, so
   *  the inbox tracks which conversation fills the right pane. Defaults to
   *  false — on mobile (screen-swap) no row is ever the persistent active
   *  one. */
  isActive?: boolean;
  /** Multi-select mode — the row shows a leading checkbox, a tap toggles
   *  its selection instead of opening the thread, and the swipe gestures
   *  are suppressed by the list. Defaults to false. */
  selectMode?: boolean;
  /** Whether this row is currently selected (select mode only). */
  selected?: boolean;
  /** Toggle this row's selection (select mode only). */
  onToggleSelect?: () => void;
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
    void getMessageAttachmentSignedUrl(path)
      .then((signed) => {
        if (!cancelled) setUrl(signed);
      })
      .catch((err) => {
        // Leave `url` null — the thumbnail box below already renders as
        // an empty placeholder when `url` is null, so a failed sign-url
        // just falls into that existing state instead of showing a
        // broken-image icon. Still logged so silent failures surface.
        if (cancelled) return;
        report(err, {
          severity: "warning",
          tags: { source: "ConversationRow.LastMessageImageThumb" },
        });
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
 * status chip, and a right cluster holding the unread dot and the
 * far-right relative timestamp.
 *
 * The row carries no per-row ⋮ overflow menu. Everything it used to hold
 * is reachable elsewhere: mute / report / block from the thread header,
 * pin from the right swipe, delete (local archive) from the left swipe
 * and from the list's Select mode.
 */
const ConversationRowBase = ({
  convo: c,
  currentUserId,
  openConvo,
  isActive = false,
  selectMode = false,
  selected = false,
  onToggleSelect,
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
      s === "accepted" ? jobStatusColor("in_progress") : jobStatusColor(s);
    const label = s === "accepted" ? "Awarded" : jobStatusLabel(s);
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
      className="relative w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors"
      onClick={selectMode ? onToggleSelect : undefined}
      role={selectMode ? "button" : undefined}
      aria-pressed={selectMode ? selected : undefined}
      // The row wrapper can't be a real <button> — it CONTAINS buttons (the
      // select checkbox and the open-thread hit area), and nesting
      // interactive controls is invalid. So `role="button"` has to
      // carry its own keyboard contract: focusable, and Enter/Space activate.
      // Browsers only synthesize that for native <button>/<a>.
      tabIndex={selectMode ? 0 : undefined}
      onKeyDown={
        selectMode
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              // Only act when the wrapper ITSELF has focus. The inner native
              // buttons already activate on Enter/Space, and their keydown
              // bubbles up here — without this guard a key press on the
              // checkbox would toggle twice (net no-op).
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                // Space would otherwise scroll the list.
                e.preventDefault();
                onToggleSelect?.();
              }
            }
          : undefined
      }
      style={{
        // Flat iOS-Messages row — no per-row card. The only fill is the
        // calm active tint on the desktop split (this thread is open in the
        // right pane); transparent/inert on mobile (isActive is false).
        // Row separation comes from the inset hairline divider below, not a
        // card edge — so consecutive rows read as one continuous list.
        backgroundColor: isActive ? "hsl(var(--bark) / 0.06)" : "transparent",
        cursor: selectMode ? "pointer" : undefined,
      }}
    >
      {/* Inset bottom hairline — begins at the text column (after the
          avatar), the iOS list convention. Absolute so it never adds row
          height. Hidden on the active (selected) row so its tint reads as
          one clean block. */}
      {!isActive && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 right-0 h-px"
          style={{
            // 0.75rem row padding + 2.75rem avatar (w-11) + 0.625rem gap.
            left: "calc(0.75rem + 2.75rem + 0.625rem)",
            background: "hsl(var(--olivewood) / 0.10)",
          }}
        />
      )}
      {/* Leading selection checkbox — multi-select mode only. Circular,
          44px tap target; filled with bark when checked. */}
      {selectMode && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? "Deselect conversation" : "Select conversation"}
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
          className="shrink-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center self-center"
        >
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
            style={
              selected
                ? { background: "hsl(var(--bark))", border: "1px solid hsl(var(--bark))" }
                : { background: "transparent", border: "1.5px solid hsl(var(--olivewood) / 0.45)" }
            }
          >
            {selected && (
              <Check className="w-3.5 h-3.5" style={{ color: "hsl(var(--parchment))" }} strokeWidth={3} />
            )}
          </span>
        </button>
      )}
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
        onClick={(e) => {
          // In select mode a tap toggles selection instead of opening the
          // thread; stop it bubbling so the row's onClick doesn't re-toggle.
          if (selectMode) { e.stopPropagation(); onToggleSelect?.(); return; }
          openConvo(c);
        }}
        className="flex-1 min-w-0 text-left self-center"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p
                className="font-sans font-semibold truncate text-ds-15"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
              >
                {c.otherUserName}
              </p>
            </div>
            {/* `flex-wrap` + a generous basis on the title, so the annotations
                below it wrap instead of starving it.

                Measured at 375px: this row is 120px wide, and the "CANCELLED"
                chip alone took 76px of it. Every sibling here — status chip,
                mute bell, last-active pill — is `shrink-0`, and `truncate`
                sets the title's automatic minimum size to zero, so the title
                absorbed the entire deficit and collapsed to 38px. "Crawfish
                boil setup and teardown" rendered as "Crawfi…", which does not
                identify a conversation. The annotations were winning space
                from the thing they annotate.

                A basis wider than the row forces the title onto its own line
                when a chip is present, so both stay fully legible; the cost is
                ~14px of height, and only on narrow screens with a chip. */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
              <p
                className="flex-1 min-w-0 basis-[9rem] text-ds-11 truncate font-serif italic"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {c.jobTitle}
              </p>
              {statusChip && (
                // Plain inert label for every status, cancelled included.
                // The chip lives inside the row's open-thread <button>, so a
                // tap anywhere on the row — chip included — opens the thread.
                // (A cancelled thread is still fully readable/replyable, and
                // the thread itself renders a "Job cancelled" system event,
                // so the chip doesn't need to intercept taps to explain it.)
                <span
                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ color: statusChip.color, backgroundColor: statusChip.bg, letterSpacing: "0.08em" }}
                >
                  {statusChip.label}
                </span>
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
                        background: "hsl(var(--live))",
                        boxShadow: "0 0 4px hsl(var(--live) / 0.55)",
                      }}
                    />
                  )}
                  <span
                    className="text-ds-10 font-serif italic"
                    style={{
                      color: lastActiveLabel.isLive
                        ? "hsl(var(--live))"
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
                className="text-ds-12 truncate min-w-0 flex-1"
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
          {/* Right cluster — unread dot, then the relative timestamp.
              The per-row ⋮ overflow menu used to occupy this edge with
              the dot beside it; the menu is gone (every action it held
              lives elsewhere), so the timestamp now sits flush against
              the row's px-3 padding with the dot tucked to its left.
              Both live INSIDE the open-thread button, so the strip the
              kebab vacated still opens the conversation rather than
              becoming a dead gutter. */}
          <span className="shrink-0 self-center flex items-center gap-1.5">
            {hasUnreadFromOther && (
              <span
                aria-label={`${c.unread} unread message${c.unread === 1 ? "" : "s"}`}
                role="status"
                className="shrink-0 w-2 h-2 rounded-full"
                style={{ background: "hsl(var(--burnt-sienna))" }}
              />
            )}
            <span
              className="text-ds-11 whitespace-nowrap"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {when}
            </span>
          </span>
        </div>
      </button>
    </div>
  );
};

export const ConversationRow = memo(ConversationRowBase);
ConversationRow.displayName = "ConversationRow";
