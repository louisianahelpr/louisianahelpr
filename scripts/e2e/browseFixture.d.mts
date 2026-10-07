export const BROWSE_FIXTURE_PURPOSE: string;
export const BROWSE_FIXTURE_TITLE: string;
export function fixtureHealthy(job: Record<string, unknown> | null | undefined, posterId: string): boolean;
export function fixtureRow(posterId: string, now?: number): Record<string, unknown>;
export function ensureBrowseFixture(o: {
  supabaseUrl: string;
  serviceKey: string;
  posterId: string;
  helperId: string;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<{ jobId: string; action: "kept" | "created" }>;
