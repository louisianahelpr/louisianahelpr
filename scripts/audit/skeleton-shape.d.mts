// Types for the skeleton-vs-page measurement (e2e/prod-audit/skeleton-shape.spec.ts, Q201).
export interface Box { kind: string; x: number; y: number; w: number; h: number; tag: string; text: string }
export interface Frame { texts?: Box[]; title: Box | null; blocks?: Box[]; block?: Box | null }
export interface RouteSkeleton { path: string; page: string; chunk: string; skeleton: string }
export declare const TOL_PX: number;
export declare function routeSkeletonRoutes(stripped: string): RouteSkeleton[];
export declare function chunkPattern(chunk: string): RegExp;
export declare const FRAME_BOXES: (placeholderSel: string) => Frame;
export declare function firstBlock(frame: Frame, title: Box | null): Box | null;
export declare function compareFrames(skel: Frame, loaded: Frame, tol?: number): string[];
export interface ShapeResult { held: number; ms?: { goto: number; skel?: number; loaded?: number }; skel?: Frame; loaded?: Frame | null; diff?: string[]; landedOn?: string; skelPng?: Buffer; loadedPng?: Buffer; error?: string }
export declare function measureSkeletonShape(
  ctx: unknown,
  page: unknown,
  fullUrl: string,
  chunk: string,
  placeholderSel: string,
  opts?: { quietMs?: number; maxMs?: number; shots?: boolean },
): Promise<ShapeResult>;
