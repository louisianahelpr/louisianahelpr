// Types for the lab Core Web Vitals harness (scripts/perf/cwv-lab.mjs), used by
// e2e/prod-audit/web-vitals.spec.ts.
export interface LabProfile {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  network: { latency: number; downloadThroughput: number; uploadThroughput: number };
  cpu: number;
}
export declare const PROFILES: { mobile: LabProfile; desktop: LabProfile };
export declare const GOOD: { ttfb: number; fcp: number; lcp: number; cls: number };
export declare const REFERENCE_BENCH_MS: number;
export declare const CWV_INIT: () => void;
export interface Shift { t: number; v: number; input: boolean; srcs: string[] }
export declare function clsOf(shifts: Shift[]): { cls: number; window: Shift[] };
export interface CwvReading {
  supported: string[];
  ttfb: number | null;
  fcp: number | null;
  lcp: number | null;
  lcpEl: string | null;
  lcpUrl: string | null;
  lcpSize: number | null;
  lcpCandidates: string[];
  breakdown: { ttfb: number; loadDelay: number; loadTime: number; renderDelay: number } | null;
  cls: number;
  clsWindow: { t: number; v: number; srcs: string[] }[];
  shiftsAll: { t: number; v: number; input: boolean; srcs: string[] }[];
  marks: {
    dcl: number | null;
    appDrawn: number | null;
    jsBeforeLcp: { name: string; start: number; end: number; kb: number }[];
    jsDone: number | null;
    jsKBbeforeLcp: number;
    jsCountBeforeLcp: number;
    data: { name: string; start: number; end: number }[];
  };
}
export declare function readCwv(page: unknown): Promise<CwvReading>;
export declare function settle(page: unknown, opts?: { quietMs?: number; maxMs?: number }): Promise<number>;
export declare function sessionInit(s: { key: string; value: string; expired?: boolean }): [(arg: { k: string; v: string }) => void, { k: string; v: string }];
export declare function cpuBenchmarkMs(browser: unknown): Promise<number>;
export declare function calibratedCpuRate(target: number, benchMs: number | null): number;
export declare function applyThrottle(ctx: unknown, page: unknown, profile: LabProfile, browserName: string, cpuRate?: number): Promise<boolean>;
export declare function localCert(): { key: Buffer; cert: Buffer; spki: string };
export declare function startDistServer(distDir: string, port: number, tls?: { key: Buffer; cert: Buffer; spki: string }): Promise<{ close: () => void }>;
