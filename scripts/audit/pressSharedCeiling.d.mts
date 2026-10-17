// Types for the press leg's shared request ceiling, so guards in src/test can
// import it under `tsc -b --noEmit`.
export declare const LOCK_STALE_MS: number;
export declare function withLegLock<T>(dir: string, fn: () => T, opts?: { staleMs?: number; spinMs?: number }): T;
export declare function siblingsUsed(dir: string, shard: string, minute: number): number;
export type SharedCeilingOpts = {
  dir: string;
  shard: string;
  used: (minute: number) => number;
  ceiling: number;
  burst: number;
  now?: () => number;
  minuteMs?: number;
};
export declare function sharedCeilingDecision(opts: SharedCeilingOpts): { waitMs: number; minute: number };
export declare function sharedCeilingWaitMs(opts: SharedCeilingOpts): number;
