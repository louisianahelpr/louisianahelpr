export interface FnArg {
  name: string;
  type: string;
}
export interface ExtractedFn {
  name: string;
  args: FnArg[];
  secdef: boolean;
  returnsTrigger: boolean;
  body: string;
  index: number;
}
export interface NewestFn extends ExtractedFn {
  file: string;
  grantees: string[];
  clientCallable: boolean;
}
export interface MigrationFile {
  name: string;
  sql: string;
}

export function sqlArrayLiteral(src: string, varName: string): string[] | null;
export function parseArgs(argList: string | undefined): FnArg[];
export function extractFunctions(sql: string): ExtractedFn[];
export function newestFunctions(files: MigrationFile[]): Map<string, NewestFn>;
export function jobsTriggers(files: MigrationFile[]): Map<string, string>;
export function dynamicJobsWriterReasons(fn: { name: string; args: FnArg[]; body: string }): string[];
export function aclIsClientCallable(acl: string | null | undefined): boolean;
export const REVIEWED_JOBS_WRITERS: Map<string, RegExp>;
export function isReviewedJobsWriter(name: string, body: string | null | undefined): boolean;
