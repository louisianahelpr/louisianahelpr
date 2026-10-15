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
export declare const MEASUREMENT_SETTINGS: string[];
export interface MeasurementDoc {
  base?: string;
  viewport?: unknown;
  capture?: string;
  settleMs?: number;
  chunkDelay?: number;
  at?: string;
  results: Array<{ url: string; persona: string; [k: string]: unknown }>;
  merged?: Array<{ at?: string; base?: string; surfaces: string[]; replaced: string[] }>;
  [k: string]: unknown;
}
export declare function mergeMeasurements(prev: MeasurementDoc, partial: MeasurementDoc): MeasurementDoc & { merged: NonNullable<MeasurementDoc["merged"]> };
export declare function mergeFile(partialPath: string, intoPath: string): { total: number; merged: number; replaced: number };
