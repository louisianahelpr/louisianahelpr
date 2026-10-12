export const POSTER: { email: string; userId: string };
export const HELPER: { email: string; userId: string };
export const CREW_MATE: { email: string; userId: string };
export const INCOMPLETE_EMAIL: string;
export const FIXTURE_ADDRESS: string;
export const FIXTURE_POINT: { lat: number; lng: number };
export interface JobFixture { key: string; title: string; category: string; budget: number; items: string[] }
export const JOB_FIXTURES: JobFixture[];
export const WIPE_KEY: string;
export const ALL_KEYS: string[];
export function fixtureId(key: string): string;
export function stateFixtureJobIds(): string[];
export function centralDate(ms: number): string;
export function centralInstant(date: string, time?: string): number;
export function jobStartMs(job: { date_needed?: string | null; start_time?: string | null } | null | undefined): number;
export function plannedStart(key: string, now: number): { date_needed: string; start_time: string };
export function fixtureJobRow(fixture: JobFixture, now?: number): Record<string, unknown>;
export function confirmWindowOpensMs(job: { date_needed?: string | null; start_time?: string | null }): number;
export function fixtureProblem(
  key: string,
  job: Record<string, unknown> | null | undefined,
  extra?: { disputes?: Array<Record<string, unknown>>; roster?: Array<Record<string, unknown>> },
  now?: number,
): string | null;
export function runStateFixtures(o: {
  mode: "--apply" | "--verify" | "--teardown";
  only?: string[];
  supabaseUrl?: string;
  serviceKey: string;
  log?: (s: string) => void;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<{ report: Array<Record<string, unknown>>; gaps: number }>;
