// Types for the loading-state measurement's shared selector.
export declare const PLACEHOLDER_SEL: string;
export declare const SETTLE_MS: number;
export type StageStep = "wait" | "capture" | "release" | "empty";
export declare function nextStage(s: {
  placeholders: number;
  held: number;
  moving: number;
  quietFor: number;
  /** The app has rendered visible text in #root (not the blank boot frame). */
  booted: boolean;
  settleMs?: number;
}): StageStep;
