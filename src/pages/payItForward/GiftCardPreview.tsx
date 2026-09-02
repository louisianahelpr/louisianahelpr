import { formatPrice } from "@/lib/format";
import type { GiftCardDesign } from "./giftCardDesigns";

/**
 * The gift card as the recipient will see it.
 *
 * Shown live while composing, so the sender is choosing an artifact rather
 * than filling in a form. Same component renders the received card, so what
 * you picked is literally what they get.
 *
 * ── Why the face carries four things, not one ──────────────────────────
 * The first version painted the gradient, put the wordmark top-left and the
 * motif top-right, and left everything else to `justify-between` — which on a
 * card with no note meant a wordmark, an emoji, and a large empty middle
 * (owner, 2026-08-30: "a large, almost entirely empty gradient block"). A
 * preview whose job is "show what lands in their inbox" has to actually show
 * it, so the face now states the four facts a gift card is made of:
 *   1. WHO it is from — the Helpr wordmark plus "from {sender}".
 *   2. WHY — the occasion, as a quiet eyebrow beside the motif. It already
 *      drives the art and the note placeholder; naming it is free.
 *   3. HOW MUCH — the amount, given the middle band and the largest type on
 *      the card. It is the one fact the recipient most needs, and every
 *      physical gift card leads with its denomination.
 *   4. WHAT THEY WROTE — the note, clamped to two lines at the foot, where a
 *      signature sits. With no note the slot states what the credit is good
 *      for instead of collapsing, so the card never has a hole in it.
 *
 * ── Why the ISO ratio is a FLOOR, not a fixed height ───────────────────
 * 1.586:1 is ISO 7810 ID-1 — a physical gift card — and holding it stops the
 * preview jumping as the note grows. But a FIXED aspect-ratio box with
 * `overflow: hidden` clips whatever doesn't fit, and that is exactly how the
 * old layout lost half a glyph: the amount span could shrink under a long
 * "from {name}", `$—` wrapped between the dollar sign and the em dash, and the
 * second line fell off the bottom edge as a sliced-in-half `$`. So the ratio
 * is established by a zero-width spacer sharing one grid cell with the
 * content: the row is as tall as the TALLER of the two, so the card keeps its
 * card shape at every width and still grows rather than clipping if a font
 * metric or a translation ever needs one more pixel. The amount itself is
 * additionally `whitespace-nowrap` + `shrink-0` so it can never break again.
 */
export function GiftCardPreview({
  design,
  amount,
  note,
  senderName,
  occasionLabel,
  compact = false,
}: {
  design: GiftCardDesign;
  /** Dollars. Null/0 renders the placeholder rather than "$0". */
  amount: number | null;
  note?: string;
  senderName?: string | null;
  /** Occasion name, shown as the eyebrow beside the motif. */
  occasionLabel?: string;
  /** Smaller variant for lists. */
  compact?: boolean;
}) {
  const trimmedNote = note?.trim();
  const hasAmount = !!amount && amount > 0;

  return (
    <div
      data-testid="gift-card-preview"
      className="relative w-full overflow-hidden rounded-2xl"
      style={{
        background: design.background,
        border: "0.5px solid hsl(var(--olivewood) / 0.18)",
        boxShadow: "0 1px 2px hsl(var(--ink-deep) / 0.10), 0 8px 24px hsl(var(--ink-deep) / 0.08)",
      }}
    >
      <div className="grid">
        {/* ISO 7810 ID-1 floor. 63.05% = 1 / 1.586, measured against the card's
            full width because this spacer sits OUTSIDE the padded content. */}
        <div aria-hidden className="w-0" style={{ gridArea: "1 / 1", paddingTop: "63.05%" }} />

        {/* `min-w-0` is load-bearing. A grid item's automatic minimum size is
            min-CONTENT, so without it this column widened to fit the
            `whitespace-nowrap` amount and the un-shrunk "from {name}" line,
            spilled past the card's right edge, and `overflow: hidden` sliced
            both — the horizontal twin of the bottom-edge clipping this card
            was rebuilt to end. With it the column is exactly the track's
            width, so `truncate` can do its job. */}
        <div
          className={`min-w-0 flex flex-col justify-between gap-1.5 ${compact ? "p-3" : "p-4"}`}
          style={{ gridArea: "1 / 1" }}
        >
          {/* ── Who it's from + why ─────────────────────────────────────── */}
          <div className="min-w-0 flex items-start justify-between gap-2">
            <span
              className={`shrink-0 font-display font-bold italic leading-none ${compact ? "text-ds-13" : "text-ds-16"}`}
              style={{ color: design.ink, letterSpacing: "-0.02em" }}
            >
              Helpr
            </span>
            <div className="flex items-center gap-1.5 min-w-0">
              {occasionLabel && (
                <span
                  className="font-sans font-semibold uppercase truncate text-ds-9"
                  style={{ color: design.ink, opacity: 0.7, letterSpacing: "0.08em" }}
                >
                  {occasionLabel}
                </span>
              )}
              <span className={`shrink-0 ${compact ? "text-ds-16" : "text-ds-20"}`} aria-hidden>
                {design.motif}
              </span>
            </div>
          </div>

          {/* ── How much ─────────────────────────────────────────────────
              The hero. `whitespace-nowrap` + `shrink-0` are load-bearing:
              this span used to sit in a shrinkable row beside the sender
              name and broke mid-token. */}
          <span
            className={`font-display font-bold tabular-nums leading-none whitespace-nowrap shrink-0 ${
              compact ? "text-ds-20" : "text-ds-28"
            }`}
            style={{
              color: design.ink,
              letterSpacing: "-0.03em",
              // Not chosen yet — a placeholder slot, dimmed so it reads as
              // "pending" rather than as a real $0 balance.
              opacity: hasAmount ? 1 : 0.5,
            }}
          >
            {hasAmount ? `$${formatPrice(amount!)}` : "$—"}
          </span>

          {/* ── What they wrote, and who signed it ──────────────────────── */}
          <div className="min-w-0">
            {trimmedNote ? (
              <p
                className={`font-serif italic leading-snug line-clamp-2 ${compact ? "text-ds-10" : "text-ds-11"}`}
                style={{ color: design.ink, opacity: 0.92 }}
              >
                “{trimmedNote}”
              </p>
            ) : (
              // No note yet — say what the credit is good for rather than
              // leaving a hole. Same claim the page's "What is this?" panel
              // makes, so the two can't drift.
              <p
                className={`font-sans leading-snug ${compact ? "text-ds-9" : "text-ds-10"}`}
                style={{ color: design.ink, opacity: 0.7 }}
              >
                Good toward any job on Helpr.
              </p>
            )}
            {senderName && (
              <p
                className={`font-sans truncate mt-0.5 ${compact ? "text-ds-9" : "text-ds-10"}`}
                style={{ color: design.ink, opacity: 0.85 }}
              >
                from {senderName}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
