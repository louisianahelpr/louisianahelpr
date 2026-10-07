export function latestConsentVersions(src?: string): { terms: string; privacy: string };
export function versionRank(v: unknown): number | null;
export function acceptCurrentTerms(supabaseUrl: string, anonKey: string, accessToken: string, userId: string): Promise<void>;
