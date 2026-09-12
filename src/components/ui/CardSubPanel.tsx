import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * CardSubPanel — the app's titled sub-section INSIDE a card.
 *
 * The shape (a `rounded-ds-md` bordered box, a quiet tinted header strip with
 * an icon + 11px semibold title and an optional trailing action, then a padded
 * body) was drawn by hand in ~60 places and named nowhere. PhotoProofGroup
 * carried the only copy of the exact header string
 * (`px-3 py-2 bg-muted/30 border-b`), which is what made it read as a bespoke
 * card competing with the tracker beside it rather than a section of the same
 * card.
 *
 * This is deliberately the SMALLEST honest extraction: it owns the sub-panel
 * chrome and nothing else. Call sites keep owning their own body. Only the
 * files in the helper active-job card are moved onto it here — retrofitting
 * the other ~59 look-alikes is a separate, reported job, not a drive-by change
 * to a shared class (see CLAUDE.md, the `.squircle` incident).
 */
export function CardSubPanel({
  icon: Icon,
  title,
  action,
  tone = "muted",
  children,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  /** Optional trailing control in the header strip (e.g. "View All"). */
  action?: ReactNode;
  /**
   * `muted` is the neutral section. `primary` is the one that is currently
   * ASKING the helper for something — the same primary tint the completion
   * notice already used, so an open ask and a finished one are visibly
   * different states of one component rather than two components.
   */
  tone?: "muted" | "primary";
  children: ReactNode;
  className?: string;
}) {
  const shell =
    tone === "primary"
      ? "border-primary/20 bg-primary/5"
      : "border-border bg-muted/20";
  const header = tone === "primary" ? "bg-primary/10 border-primary/20" : "bg-muted/30 border-border/40";
  const titleColor = tone === "primary" ? "text-primary" : "text-foreground";
  const iconColor = tone === "primary" ? "text-primary" : "text-muted-foreground";

  return (
    <div className={`rounded-ds-md border overflow-hidden ${shell}${className ? ` ${className}` : ""}`}>
      <div className={`px-3 py-2 border-b flex items-center justify-between gap-2 ${header}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {Icon && <Icon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />}
          <span className={`text-ds-11 font-semibold ${titleColor}`}>{title}</span>
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}
