export function refuseKey(k: string): string | null;
export function form(obj: Record<string, unknown>, prefix?: string, acc?: URLSearchParams): URLSearchParams;
export function taxIds(o: unknown, found?: Set<string>): Set<string>;
export function csvFields(line: string): string[];
export function cellSeconds(v: string): number;
export function rowsInWindow(csv: string, from: number, to: number): string[];
