/** Types for scripts/inline-shell-css.mjs, imported by src/test/shellCriticalCss.test.ts. */
export const SHELL_START: string;
export const SHELL_END: string;
export const STYLE_ID: string;
export const SHOW_RULE: string;
export const MAX_INLINE_BYTES: number;
export function shellVocabulary(shellHtml: string): { classes: Set<string>; ids: Set<string>; tags: Set<string> };
export function shellDocuments(shellHtml: string): Document[];
export function selectorNeeded(sel: string, docs: Document[]): boolean;
export function shellCriticalCss(shellHtml: string, css: string): string;
export function inlineShellCss(html: string, css: string): { html: string; bytes: number };
