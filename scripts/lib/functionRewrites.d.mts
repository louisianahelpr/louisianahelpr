export interface RewriteTuple {
  file: string;
  ord: number;
  fn: string;
  pattern: string;
  replacement: string;
  flags: string;
  index: number;
}
export const REWRITE_TUPLE: RegExp;
export function parseRewriteTuples(sql: string, code?: string, file?: string): RewriteTuple[];
export function pgRegexpReplace(src: string, pattern: string, replacement: string, flags: string): string;
