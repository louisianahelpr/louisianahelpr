/**
 * THE "Preview" mark (lead, 2026-10-21): a live section the viewer can open
 * ONLY because they are a tester (admin or test account), its switch not yet
 * open to everyone. SoonPill's shape in a muted olive, sentence case, wherever
 * a live section is listed (rail, Explore switcher, Settings › Your sections,
 * Create sheet). Shown only when useSectionTabs says `preview`, which is never
 * true for a member and never while the answer is loading or failed.
 *  - "pill":    a row with room (Settings, Create);
 *  - "compact": the 248px rail, where "Declutter" plus the full pill ran 4px
 *               past the row's padding (measured 179px in a 175px box);
 *  - "badge":   the 14px mark the Explore switcher hangs over an icon at 320.
 */
export function PreviewPill({ variant = "pill", className = "", ...rest }: { variant?: "pill" | "compact" | "badge"; className?: string } & Record<`data-${string}`, string>) {
  const size = variant === "badge" ? "px-1 text-ds-9 leading-[14px]" : variant === "compact" ? "px-1.5 text-ds-10 leading-[18px]" : "px-2 py-0.5 text-ds-11";
  return (
    <span
      {...rest}
      data-preview-pill=""
      className={`inline-flex items-center rounded-full border font-semibold shrink-0 ${size} ${className}`}
      // An olive tint over an OPAQUE card base (SoonPill is bg-card too), so a border it rides on never shows through.
      style={{
        color: "hsl(var(--bark))",
        borderColor: "hsl(var(--bark) / 0.35)",
        backgroundColor: "hsl(var(--card))",
        backgroundImage: "linear-gradient(hsl(var(--bark) / 0.08), hsl(var(--bark) / 0.08))",
      }}
    >
      Preview
    </span>
  );
}
