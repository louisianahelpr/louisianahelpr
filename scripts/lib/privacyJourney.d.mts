/** Types for scripts/lib/privacyJourney.mjs (e2e/privacy, src/test/privacyJourneyCoversPurge.test.ts). */
export const DISPOSABLE_EMAIL_RE: RegExp;
export function disposableEmail(runTag: string): string;
export const SHARED_TEST_EMAILS: string[];
export function assertDisposable(subject: {
  runTag: string;
  runStartedAt: number;
  email?: string | null;
  isSeed?: boolean | null;
  authCreatedAt?: string | null;
}): true;
export const EXPECTED_PURGE_STEPS: string[];
export const CONDITIONAL_PURGE_STEPS: string[];
export const IDENTITY_BUCKETS: string[];
export const EXPORT_SECTIONS: string[];
export const KNOWN_NOT_EXPORTED: string[];
export const EXPECTED_DB_COUNTS: Record<string, number>;
