/**
 * Types for scripts/back-control-inventory.mjs, so
 * src/test/backControlSameness.test.ts can import the scanner instead of
 * keeping a second copy of it. Same pattern as
 * scripts/check-migration-relation-grants.d.mts.
 */
export interface BackControl {
  file: string;
  line: number;
  /** `<button>`, `<Button>`, `<BackButton>`, `<DialogPrimitive.Close>`, … */
  what: string;
  /** aria-label / title, when the control has one. */
  label: string;
  /** "icon" = bare-glyph chrome; "labelled" = it draws a word. */
  kind: "icon" | "labelled";
  /** The visible text, empty for an icon-only control. */
  text: string;
  /** `variant="…"` when written as `<Button>`. */
  variant?: string;
  /** Shape tokens on the control: `rounded-*` plus `ctl-exit`. */
  radii: string[];
  /** `hover:`/`group-hover:` translate or scale, on the control or its glyph. */
  hoverMove: string[];
  /** Sanctioned tone classes, including any inherited from the variant. */
  tones: string[];
  /** Hover background written as a raw utility. */
  hoverBg: string[];
}

export interface BackControlInventory {
  controls: BackControl[];
  byShape: Record<string, string[]>;
  byMotion: Record<string, string[]>;
  byTone: Record<string, string[]>;
}

export function walk(dir: string, out?: string[]): string[];
export function stripComments(src: string): string;
export function openingTag(src: string, start: number): string;
export function elementBody(src: string, start: number, tag: string, name: string): string;
export function visibleText(body: string): string;
export function buttonVariantClasses(): Map<string, string>;
export function scan(files: string[]): BackControl[];
export function inventory(root?: string): BackControlInventory;
