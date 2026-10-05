/**
 * One tappable row inside a NavQuickMenu. Its own file so MobileNav can render
 * the rows without importing NavQuickMenu, which carries framer-motion
 * (useDockMotion.ts loads that after the dock has painted).
 */
export function NavQuickMenuItem({
  icon: Icon,
  label,
  sub,
  onSelect,
}: {
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  sub?: string;
  onSelect: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors active:bg-[hsl(var(--bark)/0.08)]"
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
          {label}
        </span>
        {sub && (
          <span className="block truncate text-ds-11" style={{ color: "hsl(48 9% 47%)" }}>
            {sub}
          </span>
        )}
      </span>
    </button>
  );
}
