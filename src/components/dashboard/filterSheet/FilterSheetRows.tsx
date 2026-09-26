/**
 * The "Show only" rows of FilterSheet's stacked job filters (buildJobFilterSections):
 * the switch row, its signed-out signup counterpart, and the availability row.
 * Pure presentation, extracted verbatim from FilterSheet.tsx (OPEN.md Q184).
 */
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, ChevronRight, Clock, type LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { hapticLight } from "@/lib/haptics";

/**
 * Full-width label + Switch row — the "Show only" group's single control
 * shape. Both narrowing booleans (Boosted, my-hours) render through this so
 * they read as one settings group instead of one stray gold pill under its
 * own heading plus one switch buried in the When section.
 */
/**
 * The signed-out counterpart to ToggleRow: same height, same icon lane, same
 * label + hint stack — but it goes to signup instead of flipping a switch.
 * Deliberately NOT a disabled Switch, which would look like a control that is
 * broken rather than one that needs an account.
 */
export function SignupRow({
  icon: Icon,
  iconClassName,
  label,
  hint,
  href,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  hint: string;
  href: string;
}) {
  return (
    <Link
      to={href}
      className="w-full flex items-center gap-2 min-h-11 py-2 px-3 rounded-ds-md squircle border border-border/60 bg-white/70 dark:bg-card/60 backdrop-blur text-left btn-press transition-all duration-200 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90"
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${iconClassName ?? "text-primary"}`} strokeWidth={2.25} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-ds-12 font-semibold text-foreground">{label}</span>
        <span className="block text-ds-11 text-muted-foreground leading-snug">{hint}</span>
      </span>
      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export function ToggleRow({
  icon: Icon,
  iconClassName,
  label,
  hint,
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 w-full">
      {/* `items-start` + `mt-0.5` on the icon, not `items-center`: this row
          can carry a 2-line hint (AvailabilityRow's "Add your weekly hours
          first — set hours ↗"), and centering the icon against that full
          block rode it up above the label's own optical center. Aligning to
          the label's cap-height instead reads right whether the hint is one
          line or two. */}
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <Icon
          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${iconClassName ?? "text-primary"}`}
          strokeWidth={2.25}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-ds-12 font-semibold text-foreground leading-snug">{label}</p>
          {hint}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={(v) => { hapticLight(); onChange(v); }}
        disabled={disabled}
        // COMPOSED, not substituted. This rendered `ariaLabel` alone, so the
        // switch's accessible name replaced its visible text — a voice-control
        // user saying the words they can see ("Boosted Jobs") hits nothing,
        // WCAG 2.5.3. Today's four call sites happen to contain their label;
        // nothing made the fifth. Prefixing the visible label guarantees it,
        // and the pass-through keeps a caller that already leads with it from
        // saying it twice.
        aria-label={
          ariaLabel.toLowerCase().startsWith(label.toLowerCase())
            ? ariaLabel
            : `${label} — ${ariaLabel}`
        }
        // Sienna, not the global olivewood: on THIS surface the accent color
        // already means "narrowing is on" (Clear All, the Filtered eyebrow,
        // the Boosted/Urgent icons), so the lit switch joins that family.
        className="shrink-0 data-[state=checked]:bg-[hsl(var(--burnt-sienna))]"
      />
    </div>
  );
}

/**
 * "Jobs during my hours" — the third row of SHOW ONLY, wearing the SAME shape
 * as the two above it.
 *
 * It used to break the group two different ways depending on state. With no
 * saved hours its hint was a bold `text-primary` "Set Hours ↗" button, so the
 * one row whose switch is INERT was also the loudest thing in the section,
 * while its working siblings sat in quiet grey. With hours saved the hint was
 * `undefined`, so the row lost its second line entirely and stood shorter than
 * the other two — the rhythm broke in one direction or the other, always.
 *
 * Now every row is icon + label + one grey `text-ds-11` line. The line says
 * what the filter does once it can work, and what is missing when it cannot;
 * the shortcut rides inside that sentence as an underlined link rather than
 * standing in for the description. Disabled reads as disabled.
 */
export function AvailabilityRow({
  matchAvailability,
  setMatchAvailability,
  hasAvailability,
}: {
  matchAvailability: boolean;
  setMatchAvailability: (v: boolean) => void;
  hasAvailability: boolean;
}) {
  const navigate = useNavigate();
  return (
    <ToggleRow
      icon={Clock}
      label="Jobs During My Hours"
      hint={
        hasAvailability ? (
          <p className="text-ds-11 text-muted-foreground leading-snug">
            Only jobs inside your saved hours
          </p>
        ) : (
          // Same grey line as the siblings, with the remedy inside the
          // sentence — not replacing it.
          <p className="text-ds-11 text-muted-foreground leading-snug">
            Add your weekly hours first —{" "}
            <button
              type="button"
              onClick={() => navigate("/profile?tab=availability")}
              className="inline-flex items-center gap-0.5 font-semibold text-primary underline underline-offset-2 hover:text-primary/80 transition-colors btn-press"
            >
              set hours
              <ArrowUpRight className="w-2.5 h-2.5" aria-hidden />
            </button>
          </p>
        )
      }
      checked={matchAvailability}
      onChange={setMatchAvailability}
      disabled={!hasAvailability}
      ariaLabel="Match my availability"
    />
  );
}
