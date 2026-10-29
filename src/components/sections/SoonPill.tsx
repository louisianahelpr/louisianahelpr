/**
 * THE one "not open yet" mark for a switched-off section (audit #3, 2026-10-21):
 * the same muted bordered pill everywhere a section is listed (sidebar, Explore
 * switcher, Create sheet, Settings, Customize). Sentences that name the
 * unopened sections (Home, You) keep openingSoonLine's quiet line.
 *  - "full":  "Coming soon" (mock-up 20), where a row has room (was "Opening soon" until audit P5-4, 2026-10-28: one word for a closed section);
 *  - "short": "Soon", where the row is narrow (the 248px rail) or already says
 *             "Coming soon" beneath the name (Settings, board 52);
 *  - "caption": "Soon" under a section's name inside its Explore header chip: the chip
 *               is already the border, so no pill. It was "Coming soon" at 9px (owner,
 *               2026-10-22); three of those at 375 sat under the app's 11px floor (audit
 *               A2-L11), so it is "Soon" at 11px (owner yes, 2026-10-29). The chip's
 *               accessible name still says "Declutter, coming soon".
 *  - "rail":    "Coming soon" UNDER the section's name on the desktop rail, as on the
 *               phone's chips. Audit #42 (2026-10-28): a member's phone chip said "Coming
 *               soon" and the same member's rail said "Soon"; the lead's rule: members see
 *               "Coming soon", a tester who can open the section sees it too, in olive (PreviewPill, A2-L17). As a pill
 *               beside the name it did not fit: "Declutter" plus the pill ran 21px past the
 *               nested row's 131px (WebKit, 1440), so it is a muted line under the name.
 */
export function SoonPill({ variant = "full", className = "", ...rest }: { variant?: "full" | "short" | "caption" | "rail"; className?: string } & Record<`data-${string}`, string>) {
  if (variant === "caption") {
    return (
      <span {...rest} className={`text-ds-11 font-medium text-muted-foreground ${className}`}>
        Soon
      </span>
    );
  }
  if (variant === "rail") {
    return (
      <span {...rest} className={`block text-ds-11 font-medium leading-tight text-muted-foreground ${className}`}>
        Coming soon
      </span>
    );
  }
  return (
    <span {...rest} className={`inline-flex items-center rounded-full border border-border bg-card font-semibold text-muted-foreground shrink-0 px-2 py-0.5 text-ds-11 ${className}`}>
      {variant === "full" ? "Coming soon" : "Soon"}
    </span>
  );
}
