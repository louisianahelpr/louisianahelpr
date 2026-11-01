/**
 * THE NEXT-STEP LINE (owner 2026-11-01 12:05 PM: "people aren't told what to do next"). One sentence that says either
 * what the viewer does next ("Next: confirm the job's still on · by Sat 9:00 AM") or who we are waiting on
 * ("Waiting on Yusef to mark it done"), with the deadline when there is one. The page pairs it with the ONE button
 * that does the step. Shared: any page with a step to take can draw it (the job page first).
 * Guard: src/components/ui/NextStep.test.tsx.
 */
export type NextStepValue = {
  /** "you": the viewer's move; "them": waiting on someone else; "info": where things stand, nobody owes a move. */
  who: "you" | "them" | "info";
  /** The step, in plain words, without the "Next:" prefix ("confirm the job's still on"). */
  text: string;
  /** The deadline, already in words ("Sat 9:00 AM", "2 days left"); omitted when there is none. */
  by?: string | null;
};

/** "confirm it" from "Confirm it": the line reads "Next: confirm it", one sentence. Names stay capitalised. */
function lowerFirst(s: string): string {
  const [first, ...rest] = s.split(" ");
  // "I'm on my way" keeps its capital I; a one-letter word or a proper name (two capitals) is left alone.
  if (!first || first === "I" || first.startsWith("I'") || /^[A-Z][a-z]*[A-Z]/.test(first)) return s;
  return [first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(" ");
}

/** The words the line prints, for a test or a screen reader label. */
export function nextStepWords(v: NextStepValue): string {
  const lead = v.who === "you" ? `Next: ${lowerFirst(v.text)}` : v.text;
  return v.by ? `${lead} · ${v.by}` : lead;
}

export function NextStep({ value, className = "" }: { value: NextStepValue | null; className?: string }) {
  if (!value || !value.text.trim()) return null;
  const lead = value.who === "you" ? `Next: ${lowerFirst(value.text)}` : value.text;
  return (
    <p data-next-step={value.who} className={`text-ds-16 leading-snug ${className}`}>
      <span className="font-semibold text-foreground">{lead}</span>
      {value.by && <span className="text-muted-foreground"> · {value.by}</span>}
    </p>
  );
}
