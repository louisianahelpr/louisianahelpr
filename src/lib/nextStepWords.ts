/**
 * The next-step line's WORDS (owner 2026-11-01 12:05 PM: "people aren't told what to do next"), without the
 * component: src/components/ui/NextStep.tsx draws them and re-exports these. Guard: src/components/ui/NextStep.test.tsx.
 */
import { t } from "@/lib/i18n/language";
export type NextStepValue = {
  /** "you": the viewer's move; "them": waiting on someone else; "info": where things stand, nobody owes a move. */
  who: "you" | "them" | "info";
  /** The step, in plain words, without the "Next:" prefix ("confirm the job's still on"). */
  text: string;
  /** The deadline, already in words ("Sat 9:00 AM", "2 days left"); omitted when there is none. */
  by?: string | null;
  /** Plain text under the bold line, when the line needs explaining (Q2600: a dispute's who decides and when). */
  body?: string | null;
  /** The text starts with a person's name ("Lexi offered you this job"): "Next:" keeps its capital (Q2590). */
  keepCase?: boolean;
};

/** "confirm it" from "Confirm it": the line reads "Next: confirm it", one sentence. Names stay capitalised. */
export function lowerFirst(s: string): string {
  const [first, ...rest] = s.split(" ");
  // "I'm on my way" keeps its capital I; a one-letter word or a proper name (two capitals) is left alone.
  if (!first || first === "I" || first.startsWith("I'") || /^[A-Z][a-z]*[A-Z]/.test(first)) return s;
  return [first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(" ");
}

/** The words the line prints, for a test or a screen reader label. */
export function nextStepWords(v: NextStepValue): string {
  const lead = v.who === "you" ? t("next.lead", { step: v.keepCase ? v.text : lowerFirst(v.text) }) : v.text;
  const line = v.by ? `${lead} · ${v.by}` : lead;
  return v.body ? `${line}. ${v.body}` : line;
}

