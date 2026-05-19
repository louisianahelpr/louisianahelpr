import { memo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Flag, Ban, Trash2, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Conversation } from "./types";

interface ConversationRowProps {
  convo: Conversation;
  /** Opens this conversation into the chat view. */
  openConvo: (convo: Conversation) => void;
  setReportTarget: Dispatch<SetStateAction<{ type: "message" | "user"; id: string } | null>>;
  setBlockTarget: Dispatch<SetStateAction<{ id: string; name: string } | null>>;
  setDeleteConvoConfirm: Dispatch<SetStateAction<Conversation | null>>;
}

/**
 * ConversationRow — a single row in the virtualized inbox list: avatar,
 * unread badge, job title + status chip, last-message preview, relative
 * timestamp, and the per-row report / block / delete menu.
 *
 * Extracted verbatim from the inline `renderItem` closure in
 * ConversationList so it can be wrapped in React.memo — the inbox list is
 * virtualized, so a parent re-render (pull-to-refresh state, "show all"
 * toggle) would otherwise re-render every visible row. With a stable
 * `openConvo` callback and the state-setter props, unchanged rows skip
 * re-render.
 */
const ConversationRowBase = ({
  convo: c,
  openConvo,
  setReportTarget,
  setBlockTarget,
  setDeleteConvoConfirm,
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
  // Status chip — short label so it fits inline next to the job title.
  // Same color logic as the chat-header status pill.
  const statusChip = c.jobStatus && (() => {
    const s = c.jobStatus;
    if (s === "open") return { label: "Open", color: "hsl(var(--bark))", bg: "hsl(var(--bark) / 0.12)" };
    if (s === "assigned" || s === "in_progress") return { label: "Awarded", color: "hsl(var(--burnt-sienna))", bg: "hsl(var(--burnt-sienna) / 0.12)" };
    if (s === "completed") return { label: "Done", color: "hsl(var(--olivewood) / 0.9)", bg: "hsl(var(--olivewood) / 0.10)" };
    if (s === "cancelled") return { label: "Cancelled", color: "hsl(var(--destructive))", bg: "hsl(var(--destructive) / 0.10)" };
    return null;
  })();
  return (
    <div
      className="w-full text-left p-3 rounded-ds-md liquid-glass hover:shadow-md transition-shadow flex items-center gap-2.5"
    >
      {/* Avatar — uses real photo when available, falls
          back to bark-tinted initials circle. */}
      <div
        className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center overflow-hidden self-center"
        style={{
          background: "hsl(var(--bark) / 0.12)",
          border: "1px solid hsl(var(--bark) / 0.22)",
        }}
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
          <span className="text-ds-13 font-bold" style={{ color: "hsl(var(--bark))" }}>
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
              {c.unread > 0 && (
                <span
                  className="shrink-0 px-1.5 h-4 min-w-[1rem] rounded-full text-[0.65rem] font-bold flex items-center justify-center"
                  style={{
                    background: "hsl(var(--burnt-sienna))",
                    color: "hsl(var(--parchment))",
                  }}
                >
                  {c.unread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p
                className="text-[0.7rem] truncate font-serif italic"
                style={{ color: "hsl(var(--olivewood) / 0.7)" }}
              >
                {c.jobTitle}
              </p>
              {statusChip && (
                <span
                  className="text-[8.5px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ color: statusChip.color, backgroundColor: statusChip.bg, letterSpacing: "0.08em" }}
                >
                  {statusChip.label}
                </span>
              )}
            </div>
            <p
              className="text-[0.78rem] truncate mt-0.5"
              style={{
                color: c.unread > 0 ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.75)",
                fontWeight: c.unread > 0 ? 600 : 400,
              }}
            >
              {c.lastMessage || "—"}
            </p>
          </div>
          <span
            className="text-[0.7rem] shrink-0 self-start whitespace-nowrap"
            style={{ color: "hsl(var(--olivewood) / 0.6)" }}
          >
            {when}
          </span>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1.5 rounded-ds-sm text-muted-foreground hover:bg-secondary transition-colors shrink-0"
            onClick={(e) => e.stopPropagation()}
            aria-label="Conversation options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setReportTarget({ type: "user", id: c.otherUserId })}>
            <Flag className="w-4 h-4 mr-2" /> Report user
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setBlockTarget({ id: c.otherUserId, name: c.otherUserName })}>
            <Ban className="w-4 h-4 mr-2" /> Block user
          </DropdownMenuItem>
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
