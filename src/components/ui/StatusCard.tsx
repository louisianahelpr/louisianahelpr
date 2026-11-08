/**
 * THE order card (design audit 11-08 B §4.5 StatusCard; owner pick 3, 11-08): one card for every order, offer, cart
 * and request row, in Declutter first and in the Jobs tracker next (the same card, a job icon in the photo's place).
 *
 *   [photo 56]  Title (one line)                 [message]
 *               $42.70 paid
 *   ━━━━━━━━ ━━━━━━━━ ──────── ────────   (the section's own step bar, short words)
 *   Next: set it out · 2 h left           (ONE status line: the next step bold, the time muted)
 *   [ One main button ]   Details
 *
 * Everything else a stage needs (rules, addresses, tips) lives behind Details, never on the card. Slots, not props
 * per stage: the section decides the words from its real state; this card only lays them out.
 */
import type { ReactNode } from "react";
import { ItemThumb } from "./ItemThumb";
import { PRICE_PAID, SPACE, TYPE } from "./designScale";

export function StatusCard({ thumb, thumbPlaceholder, title, money, progress, next, when, action, details, corner, children, ...rest }: {
  /** The photo element (fills a 56 px ItemThumb), or nothing. */
  thumb?: ReactNode;
  /** Under the photo, and alone when there is none (a category icon on its tint). */
  thumbPlaceholder?: ReactNode;
  title: ReactNode;
  /** The money line: what was paid (or offered), once. */
  money?: ReactNode;
  /**
   * The step bar, or nothing for a card with no steps (an offer). A slot, not step words: Declutter passes its OrderSteps
   * (StepTracker), Jobs its JobStepBar (owner 10-21 "one job tracker", src/test/oneJobTracker.test.ts).
   */
  progress?: ReactNode;
  /** The status line's bold part ("Next: set it out"). */
  next?: ReactNode;
  /** The status line's muted part ("2 h left"). */
  when?: ReactNode;
  /** The ONE main button (filled), or nothing. */
  action?: ReactNode;
  /** The Details control (tertiary text button), or nothing. */
  details?: ReactNode;
  /** Top-right of the card: the message icon. */
  corner?: ReactNode;
  /** What Details opens, under the card's own lines. */
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <article {...rest} data-status-card="" className={`rounded-2xl border border-border bg-card ${SPACE.cardPad}`}>
      <div className="flex items-start gap-3">
        <ItemThumb placeholder={thumbPlaceholder}>{thumb}</ItemThumb>
        <div className="min-w-0 flex-1">
          <div data-status-card-title="" className={`truncate ${TYPE.sm} font-semibold leading-snug`}>{title}</div>
          {money != null && <div data-status-card-money="" className={`mt-0.5 ${TYPE.md} ${PRICE_PAID}`}>{money}</div>}
        </div>
        {corner != null && <div className="-mr-2 -mt-2 shrink-0">{corner}</div>}
      </div>
      {progress != null && <div className="mt-3">{progress}</div>}
      {(next != null || when != null) && (
        <p data-status-card-line="" className="mt-2 text-ds-13 leading-snug">
          {next != null && <span className="font-semibold text-foreground">{next}</span>}
          {next != null && when != null && <span className="text-muted-foreground"> · </span>}
          {when != null && <span className="text-muted-foreground">{when}</span>}
        </p>
      )}
      {(action != null || details != null) && (
        <div data-status-card-actions="" className="mt-3 flex items-center gap-3 [&>*:first-child]:min-w-0">
          {action != null && <div className="min-w-0 flex-1">{action}</div>}
          {details}
        </div>
      )}
      {children}
    </article>
  );
}
