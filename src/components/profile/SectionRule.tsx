/**
 * Quiet in-page section rule. Deliberately NOT a second header: the merged
 * tab has exactly one ProfileTabHeader (title + back button) at the top, and
 * three stacked panels each carrying its own header is precisely the shape
 * the owner rejected. The small-caps label that used to sit on this hairline
 * was removed at the owner's direction (2026-08-27) — the rule alone now
 * separates sections, so this takes no props.
 */
export function SectionRule() {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="flex-1 h-px" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
    </div>
  );
}
