export interface RefColumn {
  table: string;
  column: string;
  array: boolean;
  bucket: string | null;
  writer: string;
}
export type StorageRef =
  | { kind: "object"; bucket: string; path: string; host: string | null }
  | { kind: "external"; value: string }
  | { kind: "inline"; value: string }
  | { kind: "unresolved"; value: unknown };
export interface Reference {
  table: string;
  column: string;
  id: string;
  value: unknown;
  ref: StorageRef;
}
export const STORAGE_REFERENCE_COLUMNS: RefColumn[];
export const NOT_STORAGE_COLUMNS: Record<string, string>;
export const CANDIDATE_COLUMN: RegExp;
export function resolveStorageRef(value: unknown, defaultBucket: string | null): StorageRef;
export function splitObjectPath(path: string): { dir: string; name: string };
export function referencesFromRows(col: RefColumn, rows: Record<string, unknown>[]): Reference[];
export function gradeReferences(
  refs: Reference[],
  listed: Map<string, Set<string>>,
  projectHost: string,
): {
  checked: number;
  present: number;
  missing: Reference[];
  foreign: Reference[];
  unresolved: Reference[];
  external: number;
  inline: number;
  unlisted: Reference[];
};
export function foldersToList(refs: Reference[], projectHost: string): { bucket: string; dir: string }[];
