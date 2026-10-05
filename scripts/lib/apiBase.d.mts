export function isLoopbackBase(value: string): boolean;
export function supabaseBase<T extends string | undefined | null>(value: T): T;
export function apiBase(override: string | undefined | null, defaultBase: string): string;
