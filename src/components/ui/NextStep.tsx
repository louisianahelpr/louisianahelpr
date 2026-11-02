/**
 * THE NEXT-STEP LINE (owner 2026-11-01 12:05 PM: "people aren't told what to do next"). One sentence that says either
 * what the viewer does next ("Next: confirm the job's still on · by Sat 9:00 AM") or who we are waiting on
 * ("Waiting on Yusef to mark it done"), with the deadline when there is one. The page pairs it with the ONE button
 * that does the step. Shared: any page with a step to take can draw it (the job page first).
 * Guard: src/components/ui/NextStep.test.tsx.
 */
// The words live in src/lib/nextStepWords.ts (pure, no component), so app-shared code (continueDayWords) can build
// them without importing a component (libImportsNoPages).
import { lowerFirst, type NextStepValue } from "@/lib/nextStepWords";
export { nextStepWords, type NextStepValue } from "@/lib/nextStepWords";

export function NextStep({ value, className = "" }: { value: NextStepValue | null; className?: string }) {
  if (!value || !value.text.trim()) return null;
  // Q2590 (Jobs audit 1102b row 4): a line that starts with a name keeps its capital ("Next: Lexi offered you this job").
  const lead = value.who === "you" ? `Next: ${value.keepCase ? value.text : lowerFirst(value.text)}` : value.text;
  return (
    <p data-next-step={value.who} className={`text-ds-16 leading-snug ${className}`}>
      <span className="font-semibold text-foreground">{lead}</span>
      {value.by && <span className="text-muted-foreground"> · {value.by}</span>}
      {value.body && <span data-next-step-body="" className="mt-1 block text-muted-foreground">{value.body}</span>}
    </p>
  );
}
