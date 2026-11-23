/**
 * "One number, small label" (owner pop-up, 2026-11-22 ~10:25 AM): a Helpr sees
 * only what they get, with this small grey "after fees" note under (or beside)
 * the figure, the same on every screen. The job's posted price shows only to
 * the person who posted it.
 *
 * THE one copy of the words and the look. Every Helpr-facing take-home renders
 * this component; src/test/helprPayAfterFeesNote.test.ts holds every take-home
 * surface to it.
 */
export const AFTER_FEES_WORDS = "after fees";

export function AfterFeesNote({ inline = false, className = "" }: { inline?: boolean; className?: string }) {
  const note = (
    <span
      data-after-fees=""
      className={`${inline ? "inline" : "mt-0.5 block"} font-sans text-ds-11 font-normal leading-tight text-muted-foreground ${className}`}
    >
      {AFTER_FEES_WORDS}
    </span>
  );
  // Inline, a real space before it, so the line reads (and is spoken) "$75 after fees", never "$75after fees".
  return inline ? <>{" "}{note}</> : note;
}
