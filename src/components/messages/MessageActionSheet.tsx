import { Copy, Flag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { hapticLight } from "@/lib/haptics";
import type { Message } from "./types";

interface MessageActionSheetProps {
  /** Message under inspection — null keeps the sheet closed. */
  message: Message | null;
  /** True when the message was sent by the viewer (Delete vs Report). */
  mine: boolean;
  /** Close handler — the parent owns the open/close state. */
  onClose: () => void;
  /** Open the existing report dialog for an inbound message. */
  onReport: (id: string) => void;
  /** Open the existing delete confirm for the viewer's own message. */
  onDelete: (id: string) => void;
}

/** Photo and location messages encode a URL + emoji prefix, so their raw
 *  `content` is not human-meaningful to copy. Only offer Copy for plain
 *  text. */
const isPlainText = (content: string | null | undefined): content is string =>
  !!content && !content.startsWith("📷 ") && !content.startsWith("📍 Location:");

/**
 * Bottom action sheet for a long-press on a chat bubble. Surfaces the
 * actions a viewer can take on a message without the affordances having
 * to live inline on every row: Copy (plain-text only), plus Report
 * (inbound) or Delete (own).
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
  onDelete,
}: MessageActionSheetProps) {
  if (!message) return null;

  const canCopy = isPlainText(message.content);

  const handleCopy = async () => {
    void hapticLight();
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && message.content) {
        await navigator.clipboard.writeText(message.content);
        toast.success("Message copied.");
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

  const handleDelete = () => {
    onDelete(message.id);
    // Close BEFORE the confirm dialog opens so the user doesn't see two
    // surfaces stacked on top of each other.
    onClose();
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl border-t-0 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
        {/* SheetHero is the canonical sheet header (the Sheet-side twin of
            DialogHero). This block used to compose the eyebrow → title parts
            inline because SheetHero did not exist yet; hand-copying the tokens
            is what let four sheets drift to four different title sizes. */}
        <SheetHero
          className="px-1 pb-2"
          eyebrow="Message actions"
          title="What next?"
        />
        <div className="grid grid-cols-1 gap-1.5">
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
            <ActionRow
              icon={<Flag className="w-5 h-5" strokeWidth={2} />}
              label="Report"
              onClick={handleReport}
              tone="danger"
            />
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
