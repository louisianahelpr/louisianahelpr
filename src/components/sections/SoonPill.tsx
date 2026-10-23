/**
 * THE one "not open yet" mark for a switched-off section (audit #3, 2026-10-21):
 * the same muted bordered pill everywhere a section is listed (sidebar, Explore
 * switcher, Create sheet, Settings, Customize). Sentences that name the
 * unopened sections (Home, You) keep openingSoonLine's quiet line.
 *  - "full":  "Opening soon" (mock-up 20), where a row has room;
 *  - "short": "Soon", where the row is narrow (the 248px rail) or already says
 *             "Opening soon" beneath the name (Settings, board 52);
 *  - "caption": "Coming soon" under a section's name inside its Explore header chip
 *               (owner, 2026-10-22): the chip is already the border, so no pill. It
 *               replaced "badge", the 14px "Soon" the old switcher hung off an icon.
 */
export function SoonPill({ variant = "full", className = "", ...rest }: { variant?: "full" | "short" | "caption"; className?: string } & Record<`data-${string}`, string>) {
  if (variant === "caption") {
    return (
      <span {...rest} className={`text-ds-9 font-medium text-muted-foreground ${className}`}>
        Coming soon
      </span>
    );
  }
  return (
    <span {...rest} className={`inline-flex items-center rounded-full border border-border bg-card font-semibold text-muted-foreground shrink-0 px-2 py-0.5 text-ds-11 ${className}`}>
      {variant === "full" ? "Opening soon" : "Soon"}
    </span>
  );
}
