export const GUIDE_CONTENT: string[];
export const RIDE_ALONG: string[];
export const MAX_FAST_TESTS: number;
export const ALWAYS_RUN: RegExp;
export function globToRegExp(glob: string): RegExp;
export function isGuideContent(file: string): boolean;
export function isGuideOnly(changed: string[]): boolean;
export function pickGuideTests(changed: string[], testFiles: string[], read: (path: string) => string): string[];
