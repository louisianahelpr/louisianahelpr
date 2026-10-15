export const TURNSTILE_LOADER: string;
export function referencedChunks(text: string): string[];
export function siteKeysIn(chunkText: string): string[];
export function captchaVerdict(config: unknown, siteKeys: string[]): { ok: boolean; detail: string };
export function refusalVerdict(rows: unknown, minAddresses: number): { fire: boolean; refusals: number; addresses: number };
