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
/** The app functions (from `appFns`, lower case) a sql marker's query calls. */
export function appFunctionsCalled(query: string, appFns: Set<string>): string[];
/** First result row as text, columns joined with "|". */
export function rowText(rows: unknown): string;
/** Which test files passed, from vitest's JSON report (paths relative to `root`). */
export function testFileResults(report: { testResults?: { name: string; status: string }[] }, root: string): Map<string, boolean>;
/** The outstanding look or manual step an item's text names, or null (a later `look: done <date>` releases it). */
export function owedLook(text: string): string | null;
/** READY items held because their text still owes a look: [id, the words that owe it]. */
export function heldForOwedLook(md: string, readyIds: Iterable<string>): [string, string][];
export const OWED_LOOK_PATTERNS: RegExp[];
