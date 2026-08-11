import { formatPrice } from "@/lib/format";
import type { GiftCardDesign } from "./giftCardDesigns";

/**
 * The gift card as the recipient will see it.
 *
 * Shown live while composing, so the sender is choosing an artifact rather
 * than filling in a form. Same component renders the received card, so what
 * you picked is literally what they get.
 */
export function GiftCardPreview({
  design,
  amount,
  note,
  senderName,
  compact = false,
}: {
  design: GiftCardDesign;
  /** Dollars. Null/0 renders the placeholder rather than "$0". */
  amount: number | null;
  note?: string;
  senderName?: string | null;
  /** Smaller variant for lists. */
  compact?: boolean;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl ${compact ? "p-3" : "p-5"}`}
      style={{
        background: design.background,
        // 1.586:1 is the ISO 7810 ID-1 ratio — a physical gift card. Holding
        // it means the preview can't jump around as the note grows.
        aspectRatio: "1.586 / 1",
        border: "0.5px solid hsl(var(--olivewood) / 0.18)",
        boxShadow: "0 1px 2px hsl(var(--ink-deep) / 0.10), 0 8px 24px hsl(var(--ink-deep) / 0.08)",
      }}
    >
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <span
            className={`font-display font-bold italic leading-none ${compact ? "text-ds-13" : "text-ds-18"}`}
            style={{ color: design.ink, letterSpacing: "-0.02em" }}
          >
            Helpr
          </span>
          <span className={compact ? "text-ds-16" : "text-ds-24"} aria-hidden>
            {design.motif}
          </span>
        </div>

        {/* The note is the point of a gift card, so it gets the middle. Clamped
            rather than scrolled — the card is a fixed physical shape, and a
            note long enough to overflow it is already too long to read here.
            MAX_NOTE_LENGTH keeps that from happening in practice. */}
        {note?.trim() ? (
          <p
            className={`font-serif italic leading-snug line-clamp-3 ${compact ? "text-ds-10" : "text-ds-13"}`}
            style={{ color: design.ink, opacity: 0.92 }}
          >
            “{note.trim()}”
          </p>
        ) : (
          <span aria-hidden />
        )}

        <div className="flex items-end justify-between gap-2">
          <span
            className={`font-display font-bold tabular-nums leading-none ${compact ? "text-ds-18" : "text-ds-28"}`}
            style={{ color: design.ink, letterSpacing: "-0.03em" }}
          >
            {amount && amount > 0 ? `$${formatPrice(amount)}` : "$—"}
          </span>
          {senderName && (
            <span
              className={`font-sans truncate ${compact ? "text-ds-9" : "text-ds-11"}`}
              style={{ color: design.ink, opacity: 0.85 }}
            >
              from {senderName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
