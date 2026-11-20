/** Types for src/lib/homeGreetingShell.mjs (HomeDashboard, sign-out). */
export const GREETING_NAME_KEY: string;
export const OWN_HANDLE_KEY: string;
export function greetingFor(d?: Date, lang?: string): string;
export function greetingDate(d?: Date, lang?: string): string;
export function readGreetingName(userId: string | null | undefined): string;
export function saveGreetingName(userId: string | null | undefined, first: string | null | undefined): void;
export function clearGreetingName(keepUserId?: string | null): void;
