export type MintTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: unknown; timeoutMs: number },
) => Promise<{ status: number; text: string }>;

export type MintedSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user: { id: string; email?: string; [k: string]: unknown };
};

export const PUBLIC_ANON_KEY: string;
export const DEFAULT_SUPABASE_URL: string;
export function resolveServiceKey(opts?: { env?: Record<string, string | undefined>; cwd?: string }): string | null;
export function fetchTransport(...args: Parameters<MintTransport>): ReturnType<MintTransport>;
export function playwrightTransport(api: {
  fetch(url: string, options: { method: string; headers: Record<string, string>; data?: unknown; timeout: number }): Promise<{
    status(): number;
    text(): Promise<string>;
  }>;
}): MintTransport;
export function mintAdminSession(opts: {
  email: string;
  serviceKey: string | null | undefined;
  supabaseUrl?: string;
  anonKey?: string;
  transport?: MintTransport;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  /** Default true: bring the account up to the current Terms (scripts/lib/acceptCurrentTerms.mjs). */
  acceptTerms?: boolean;
}): Promise<MintedSession>;
