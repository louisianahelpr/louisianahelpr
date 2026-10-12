export const SCHEMAS: string[];
export const COUNT_SQL: string;
export const MUST_HAVE_ROWS: string[];
export const EXCLUDED_TABLES: Record<string, string>;
export function dumpedTables(dataSql: string): Set<string>;
export function countsFrom(rows: unknown): Map<string, number>;
export function checkCoverage(io: {
  before: Map<string, number>;
  after: Map<string, number>;
  dumped: Set<string>;
  excluded?: Record<string, string>;
  mustHaveRows?: string[];
}): { problems: string[]; notes: string[]; lines: string[]; covered: number; withRows: number };
