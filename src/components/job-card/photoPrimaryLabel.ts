/**
 * The photo capture control's label when it is the job row's primary: "Take before photo", "Take after
 * photo". Sentence case (F21, app audit 2026-10-28: it read "Take Before photo"). One function so the
 * row (PhotoProof) and the tests that stand in for it say the same words.
 */
export function photoPrimaryLabel(label: string): string {
  return `Take ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}
