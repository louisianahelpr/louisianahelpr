// The one way this page says "we have not measured that".
//
// It exists so the phrasing cannot drift panel to panel, and so the reader is
// always told the SAME two things: that the number is missing because the
// sample is short (not because the answer is zero), and exactly how much more
// history unlocks it. This app has shipped "No disputes on record" on every
// profile regardless of truth, six admin queues rendering an outage as an
// all-clear, and a tile reading "3 jobs completed" that opened onto "No
// completed jobs yet". A rate printed as 0% off two rows is the same bug.

interface NotEnoughYetProps {
  /** What the metric would have been, e.g. "your win rate". */
  what: string;
  /** How many qualifying rows exist today. */
  have: number;
  /** How many are needed. */
  need: number;
  /** Plural noun for the sample, e.g. "decided applications". */
  unit: string;
}

export function NotEnoughYet({ what, have, need, unit }: NotEnoughYetProps) {
  const remaining = Math.max(0, need - have);
  return (
    <p
      className="text-ds-11 leading-snug"
      style={{ color: "hsl(var(--olivewood) / 0.62)" }}
      data-testid="not-enough-yet"
    >
      Not enough history to show {what} yet — {have} of {need} {unit}.
      {remaining > 0 && ` ${remaining} more and this fills in.`}
    </p>
  );
}
