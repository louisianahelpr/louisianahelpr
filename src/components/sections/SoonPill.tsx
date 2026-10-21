/**
 * THE one "not open yet" mark for a switched-off section (audit #3, 2026-10-21):
 * the same muted bordered pill everywhere a section is listed (sidebar, Explore
 * switcher, Create sheet, Settings, Customize). Sentences that name the
 * unopened sections (Home, You) keep openingSoonLine's quiet line.
 *  - "full":  "Opening soon" (mock-up 20), where a row has room;
 *  - "short": "Soon", where the row is narrow (the 248px rail) or already says
 *             "Opening soon" beneath the name (Settings, board 52);
 *  - "badge": the 14px "Soon" the Explore switcher hangs off an icon at 320.
 */
export function SoonPill({ variant = "full", className = "", ...rest }: { variant?: "full" | "short" | "badge"; className?: string } & Record<`data-${string}`, string>) {
  const size = variant === "badge" ? "px-1 text-ds-9 leading-[14px]" : "px-2 py-0.5 text-ds-11";
  return (
    <span {...rest} className={`inline-flex items-center rounded-full border border-border bg-card font-semibold text-muted-foreground shrink-0 ${size} ${className}`}>
      {variant === "full" ? "Opening soon" : "Soon"}
    </span>
  );
}
