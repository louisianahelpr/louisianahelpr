import type { ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import { StarRow } from "./StarRow";

/**
 * THE review block (boards 35/36): one question, five stars, the one-tap tags
 * and an optional few words, on one card. Both review surfaces render it:
 * the Job done screen right after release (CompletionPrompts) and the
 * completed card's Review (ReviewForm), in both directions, so a poster rating
 * a Helpr and a Helpr rating a poster see the same layout with their own tags.
 *
 * Tags are toggled into the free text as "A, B" (the shape both writers have
 * always stored in `reviews.feedback`).
 */
export function ReviewQuestionCard({
  question,
  rating,
  onRating,
  tags,
  feedback,
  onFeedback,
  children,
}: {
  question: string;
  rating: number;
  onRating: (v: number) => void;
  tags: readonly string[];
  feedback: string;
  onFeedback: (next: string) => void;
  /** Extra inputs under the text box (ReviewForm's photo row). */
  children?: ReactNode;
}) {
  const selected = (tag: string) => feedback.split(", ").includes(tag);
  const toggle = (tag: string) => {
    const parts = feedback.split(", ").filter(Boolean);
    onFeedback(parts.includes(tag) ? parts.filter((p) => p !== tag).join(", ") : [...parts, tag].join(", "));
  };
  return (
    <div
      className="rounded-ds-lg p-4 space-y-3 min-w-0"
      style={{ background: "hsl(var(--card))", boxShadow: "0 4px 18px rgba(32,30,26,0.06)" }}
    >
      <p className="font-sans font-bold text-ds-15 text-center" style={{ color: "hsl(var(--ink-deep))" }}>
        {question}
      </p>
      <StarRow value={rating} onChange={onRating} label={question} />
      <div role="group" aria-label="Quick review tags" className="flex flex-wrap justify-center gap-2">
        {tags.map((tag) => {
          const on = selected(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag)}
              // SELECTED = GLOSSY (CLAUDE.md: primary and selected controls
              // wear btn-grad-primary); unselected is the plain outlined pill.
              className={`min-h-11 px-4 rounded-full font-sans font-semibold text-ds-13 transition-all active:scale-[0.97] ${on ? "btn-grad-primary" : ""}`}
              style={
                on
                  ? { color: "hsl(var(--parchment))" }
                  : { background: "hsl(var(--card))", color: "hsl(var(--ink-deep))", border: "1px solid hsl(var(--olivewood) / 0.22)" }
              }
            >
              {tag}
            </button>
          );
        })}
      </div>
      <Textarea
        aria-label="A few words (optional)"
        placeholder="Add a few words (optional)"
        value={feedback}
        onChange={(e) => onFeedback(e.target.value)}
        rows={2}
        className="rounded-ds-md font-sans text-ds-16"
      />
      {children}
    </div>
  );
}
