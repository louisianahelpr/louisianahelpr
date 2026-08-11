import type { QuickActionRowProps } from "./types";

/**
 * Quick-action row used inside the long-press action sheet. Generic
 * icon + label + tap target — kept here (rather than promoted to a
 * shared component) because no other surface in the app currently
 * needs this exact shape.
 */
export const QuickActionRow = ({ icon: Icon, label, onClick }: QuickActionRowProps) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 rounded-ds-md px-4 py-3 text-left transition-colors min-h-[48px] hover:bg-[hsl(var(--olivewood)/0.06)] active:bg-[hsl(var(--olivewood)/0.10)]"
    style={{ color: "hsl(var(--ink-deep))" }}
  >
    <Icon className="w-5 h-5" strokeWidth={1.8} />
    <span className="font-display italic font-semibold text-ds-15">{label}</span>
  </button>
);
