import { Ban, Copy, Flag, Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { hapticLight } from "@/lib/haptics";
import type { Message } from "./types";
import { TAPBACKS } from "./useMessageReactions";

interface MessageActionSheetProps {
  /** Message under inspection — null keeps the sheet closed. */
  message: Message | null;
  /** True when the message was sent by the viewer (Delete vs Report). */
  mine: boolean;
  /** Close handler — the parent owns the open/close state. */
  onClose: () => void;
  /** Open the existing report dialog for an inbound message. */
  onReport: (id: string) => void;
  /** Open the existing BlockUserDialog for the thread's other participant.
   *  Same handler the ChatHeader ⋮ menu uses — this sheet only surfaces a
   *  second entry point so a user reacting to one bad message doesn't have
   *  to back out to the header to block. Inbound messages only. */
  onBlock: () => void;
  /** Open the existing delete confirm for the viewer's own message. */
  onDelete: (id: string) => void;
  /** Apply/change/clear the viewer's tapback. Tapping the active one clears it. */
  onReact?: (messageId: string, emoji: string) => void;
  /** The viewer's current tapback on this message, for the selected state. */
  myReaction?: string | null;
  /** Start a reply that quotes this message. */
  onReply?: (message: Message) => void;
}

/** Photo and location messages encode a URL + emoji prefix, so their raw
 *  `content` is not human-meaningful to copy. Only offer Copy for plain
 *  text. */
const isPlainText = (content: string | null | undefined): content is string =>
  !!content && !content.startsWith("📷 ") && !content.startsWith("📍 Location:");

/**
 * Bottom action sheet for a long-press on a chat bubble. Surfaces the
 * actions a viewer can take on a message without the affordances having
 * to live inline on every row: Copy (plain-text only), plus Report +
 * Block (inbound) or Delete (own).
 *
 * Open/close is fully controlled by the parent — passing `message=null`
 * closes the sheet. Reuses the `@/components/ui/sheet` primitive so
 * dismissal, focus trap, and a11y come for free, matching
 * JobQuickActionSheet.
 */
export function MessageActionSheet({
  message,
  mine,
  onClose,
  onReport,
  onBlock,
  onDelete,
  onReact,
  myReaction,
  onReply,
}: MessageActionSheetProps) {
  if (!message) return null;

  const canCopy = isPlainText(message.content);

  const handleCopy = async () => {
    void hapticLight();
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && message.content) {
        await navigator.clipboard.writeText(message.content);
      }
    } catch {
      toast.error("Couldn't copy that message.");
    }
    onClose();
  };

  const handleReport = () => {
    onReport(message.id);
    onClose();
  };

  const handleBlock = () => {
    onBlock();
    // Close BEFORE the block dialog opens so the sheet isn't stacked
    // underneath it (same ordering as handleDelete).
    onClose();
  };

  const handleDelete = () => {
    onDelete(message.id);
    // Close BEFORE the confirm dialog opens so the user doesn't see two
    // surfaces stacked on top of each other.
    onClose();
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="border-t-0 px-4 pt-3 pb-[calc(var(--safe-area-bottom,0px)_+_1rem)]">
        {/* SheetHero is the canonical sheet header (the Sheet-side twin of
            DialogHero). This block used to compose the eyebrow → title parts
            inline because SheetHero did not exist yet; hand-copying the tokens
            is what let four sheets drift to four different title sizes. */}
        <SheetHero className="pl-1 pb-2" title="What Next?" />
        {/* Tapbacks — the row sits ABOVE the action list because it is the
            thing people reach for most, and because a horizontal emoji strip
            reads as a different KIND of control than the stacked destructive
            actions below it. Tapping the one already applied clears it, so the
            same control both sets and unsets (iMessage behaviour). */}
        {onReact && (
          <div className="flex items-center justify-between gap-1 px-1 pb-3 mb-1" style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.12)" }}>
            {TAPBACKS.map((emoji) => {
              const active = myReaction === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-label={active ? `Remove ${emoji} reaction` : `React with ${emoji}`}
                  aria-pressed={active}
                  onClick={() => { onReact(message.id, emoji); onClose(); }}
                  className="h-11 w-11 rounded-full inline-flex items-center justify-center text-ds-22 leading-none transition-transform active:scale-90"
                  style={active ? { background: "hsl(var(--bark) / 0.16)", outline: "1.5px solid hsl(var(--bark) / 0.45)" } : undefined}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        )}
        <div className="grid grid-cols-1 gap-1.5">
          {onReply && (
            <ActionRow
              icon={<Reply className="w-5 h-5" strokeWidth={2} />}
              label="Reply"
              onClick={() => { hapticLight(); onReply(message); onClose(); }}
            />
          )}
          {canCopy && (
            <ActionRow
              icon={<Copy className="w-5 h-5" strokeWidth={2} />}
              label="Copy"
              onClick={handleCopy}
            />
          )}
          {mine ? (
            <ActionRow
              icon={<Trash2 className="w-5 h-5" strokeWidth={2} />}
              label="Delete"
              onClick={handleDelete}
              tone="danger"
            />
          ) : (
            /* Inbound message — the two safety actions, in the same order
               and with the same weight as the ChatHeader ⋮ menu ("Report
               user" then "Block user"). Block is wired to the identical
               `setBlockTarget` → BlockUserDialog path the header uses; no
               blocking logic is duplicated here. */
            <>
              <ActionRow
                icon={<Flag className="w-5 h-5" strokeWidth={2} />}
                label="Report"
                onClick={handleReport}
                tone="danger"
              />
              <ActionRow
                icon={<Ban className="w-5 h-5" strokeWidth={2} />}
                label="Block"
                onClick={handleBlock}
                tone="danger"
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  const isDanger = tone === "danger";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-3 rounded-ds-md min-h-[48px] text-left active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      style={{
        color: isDanger ? "hsl(var(--destructive))" : "hsl(var(--ink-deep))",
      }}
    >
      <span
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full"
        style={{
          background: isDanger
            ? "hsl(var(--destructive) / 0.08)"
            : "hsl(var(--bark) / 0.08)",
          color: isDanger ? "hsl(var(--destructive))" : "hsl(var(--bark))",
        }}
      >
        {icon}
      </span>
      <span className="font-sans font-semibold text-ds-13">{label}</span>
    </button>
  );
}
