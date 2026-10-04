export const NIGHTLY_RED: string;
export interface ClosingRef {
  repo: string | null;
  number: number;
}
export function closingReferences(message: string): ClosingRef[];
export function judgeClosers(
  commits: { sha: string; message: string }[],
  labelsOf: (ref: ClosingRef) => string[],
): {
  blocked: { sha: string; ref: ClosingRef }[];
  unanswered: { sha: string; ref: ClosingRef; why: string }[];
};
export function refText(ref: ClosingRef): string;
