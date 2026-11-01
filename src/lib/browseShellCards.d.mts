/** Types for src/lib/browseShellCards.mjs (api/share.ts, scripts/perf/cwv-lab.mjs and its test). */
export interface ShellJobRow {
  title?: string | null;
  category?: string | null;
  budget?: number | string | null;
  location?: string | null;
  status?: string | null;
  expires_at?: string | null;
  boost_expires_at?: string | null;
  boosted_at?: string | null;
  created_at?: string | null;
  is_urgent?: boolean | null;
  urgent_fee?: number | null;
  is_group_job?: boolean | null;
  helpers_needed?: number | null;
  helper_fee_flat_cents?: number | string | null;
  helper_fee_percent?: number | string | null;
  is_seed?: boolean | null;
}

export const SHELL_GUEST_FEE_PERCENT: number;
export const SHELL_CARD_COUNT: number;
export const SHELL_CATEGORY_LABELS: Readonly<Record<string, string>>;
export const SHELL_JOB_COLUMNS: string;
export const SHELL_CARD_CLASSES: Readonly<Record<
  "root" | "inner" | "catRow" | "catLabel" | "body" | "titleRow" | "title" | "chip" | "amount" | "metaWrap" | "metaRow",
  string
>>;
export const BROWSE_SHELL_ID: string;
export function browseShellRowsUrl(supabaseUrl: string): string;
export function shellIsGiveaway(job: ShellJobRow): boolean;
export function shellTakeHomeDollars(job: ShellJobRow): number | null;
export function shellTown(location: string | null | undefined): string;
export function shellTitleProblem(title: string | null | undefined): string | null;
export function selectShellJobs(rows: unknown, now?: number): ShellJobRow[];
export function escapeShellText(value: unknown): string;
export function browseShellHtml(rows: unknown, now?: number): string;
export function withBrowseShell(html: string, rows: unknown, now?: number): string;
