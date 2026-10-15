export interface TouchedObject {
  kind: "function" | "view" | "trigger";
  base: string;
  args: string | null;
  via: "create" | "drop";
  label: string;
}
export interface MigrationText {
  file: string;
  sql: string;
}
export interface RestatementConflict {
  older: string;
  newer: string;
  object: string;
}
export function blankSqlStrings(sql: string): string;
export function argIdentityType(arg: string): string | null;
export function identitySignature(argList: string): string;
export function touchedObjects(sqlText: string): TouchedObject[];
export function sameObject(a: TouchedObject, b: TouchedObject): boolean;
export function outOfOrderRestatements(input: { added: MigrationText[]; base: MigrationText[] }): RestatementConflict[];
export function describeConflicts(conflicts: RestatementConflict[], baseRef?: string): string[];
