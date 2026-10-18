/**
 * The "or" rule between the two sign-in methods on the auth card: vertical at
 * lg+ (its own grid column between the credentials form and the social
 * buttons), horizontal below lg where the two methods stack.
 *
 * --accent-ink at 0.9 alpha, not --burnt-sienna and not 0.7: 0.7 over
 * --parchment is 3.28:1 for 11px text (AA wants 4.5; 0.9 measures 4.86:1), and
 * in dark mode --burnt-sienna at 0.9 measured 4.27:1 where --accent-ink
 * measures 6.27:1 (light mode byte-identical). The vertical twin is
 * aria-hidden, which axe skips, but a sighted reader still needs the contrast.
 * Extracted from Login.tsx unchanged (2026-10-06).
 */
export function OrRule({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const vertical = orientation === "vertical";
  const line = vertical ? "w-px flex-1" : "h-px flex-1";
  return (
    <div className={vertical ? "hidden lg:flex flex-col items-center gap-3" : "flex items-center gap-3 lg:hidden"} aria-hidden={vertical || undefined}>
      <span className={line} style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
      <span className="text-ds-11 tracking-[0.2em] uppercase font-sans" style={{ color: "hsl(var(--accent-ink) / 0.9)" }}>
        or
      </span>
      <span className={line} style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
    </div>
  );
}
