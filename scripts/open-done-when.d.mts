/**
 * Types for scripts/open-done-when.mjs, so
 * src/test/openPartlyDoneItemsSayDoneWhen.test.ts can import its parser.
 * Same pattern as scripts/db-saturation-check.d.mts.
 */
export type DoneWhenMarker =
  | { kind: "sql"; query: string; expected: string }
  | { kind: "test"; path: string }
  | { kind: "issue" | "pr"; number: number };
export interface PartlyDoneItem {
  id: string;
  line: number;
  text: string;
  markers: DoneWhenMarker[];
  malformed: string[];
}
/** Every `- [~]` item in an OPEN.md body with its parsed done-when markers. */
export function partlyDoneItems(md: string): PartlyDoneItem[];
/** First result row as text, columns joined with "|". */
export function rowText(rows: unknown): string;
