import { ChevronRight, Sofa } from "lucide-react";

/** The row's box, shared by the live row (a Link) and the skeleton's inert copy (a div). */
export const DECLUTTER_ROW_CLASS =
  "flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The row's contents, shared by both, so the two can never differ in height. */
export function DeclutterRowBody() {
  return (
    <>
      <Sofa className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm">Declutter</span>
        <span className="block text-xs text-muted-foreground">Buy and sell used household items near you</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );
}

/**
 * The skeleton's copy of the row: same box, nothing to tap or tab to, hidden
 * from screen readers (the loaded row is the one they read). Drawn only when
 * this device's last settled answer was "on" (declutterRowHint.ts).
 */
export function DeclutterEntryRowShape() {
  return (
    <div className={DECLUTTER_ROW_CLASS} aria-hidden data-testid="declutter-row-shape">
      <DeclutterRowBody />
    </div>
  );
}
