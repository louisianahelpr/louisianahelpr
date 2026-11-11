/** Types for src/lib/homeGreetingShell.mjs (HomeDashboard, sign-out, scripts/inline-shell-css.mjs). */
export const GREETING_NAME_KEY: string;
export const GREETING_TITLE_CLASS: string;
export const GREETING_SHELL_MARKUP: string;
export function greetingFor(d?: Date, lang?: string): string;
export function greetingDate(d?: Date, lang?: string): string;
export function readGreetingName(userId: string | null | undefined): string;
export function saveGreetingName(userId: string | null | undefined, first: string | null | undefined): void;
export function clearGreetingName(keepUserId?: string | null): void;
