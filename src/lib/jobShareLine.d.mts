/** Types for src/lib/jobShareLine.mjs (api/share.ts and src/pages/jobs/JobDetail.tsx). */
import type { ShellJobRow } from "./browseShellCards.mjs";

export interface ShareJobRow extends ShellJobRow {
  parish?: string | null;
  date_needed?: string | null;
  date_window_end?: string | null;
}

export function jobShareDay(dateNeeded: string | null | undefined, dateWindowEnd?: string | null): string;
export function jobShareDescription(job: ShareJobRow): string;
