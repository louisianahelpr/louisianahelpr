import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/** The card's look: one row, 104px tall, an olive-circle icon, a bold title and one muted line, a chevron. */
const CARD =
  "flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-card text-left transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface Props {
  /** The olive-circle icon (an emoji span or a lucide icon at h-5 w-5). */
  icon: ReactNode;
  title: string;
  /** The one line under the title (none on a `slim` row). */
  line?: string;
  /** A link (react-router path) or a button (onClick): exactly one. */
  to?: string;
  onClick?: () => void;
  /** Anything under the line (a note, a warning). */
  extra?: ReactNode;
  /** A smaller row (60px, smaller icon) for options under an "Other ways" heading (POST-H17: all of Sell's choices reach
   *  a 375x812 screen). */
  compact?: boolean;
  /** The slimmest row (48px, title only), for a shortcut above a flow's choices (the Sell chooser's one "Continue
   *  where you left off", 10-31: kept work must not push Sell's choices off a 375x812 screen). */
  slim?: boolean;
  /** data-* hooks, passed through to the card. */
  [attr: `data-${string}`]: string | undefined;
}

/**
 * A big "pick one" card for the first step of a flow: Post a job's "How do you want to start?" (board
 * helpr-postjob-flow-mockup.png, owner 2026-10-21) and Declutter's "What do you want to sell?" (owner 2026-10-30).
 * One shared look so the two first steps match; a flow never hand-rolls its own option card.
 * Guard: src/components/declutter/declutterSellChooser.test.tsx.
 */
export function ChoiceCard({ icon, title, line, to, onClick, extra, compact: compactProp, slim, ...rest }: Props) {
  const compact = compactProp || slim;
  const cls = slim ? `${CARD} !gap-3 !py-1.5` : compact ? `${CARD} !gap-3 !py-2.5` : CARD;
  const style = { minHeight: slim ? "48px" : compact ? "60px" : "104px" };
  const body = (
    <>
      <span className={`inline-flex ${slim ? "h-8 w-8" : compact ? "h-9 w-9" : "h-11 w-11"} shrink-0 items-center justify-center rounded-full bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block font-sans ${compact ? "text-ds-15" : "text-ds-17"} font-bold text-foreground`}>{title}</span>
        {line && <span className="mt-0.5 block font-sans text-ds-13 text-muted-foreground">{line}</span>}
        {extra}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );
  if (to) {
    return (
      <Link to={to} onClick={onClick} className={cls} style={style} data-compact={compact ? "" : undefined} {...rest}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} style={style} data-compact={compact ? "" : undefined} {...rest}>
      {body}
    </button>
  );
}
