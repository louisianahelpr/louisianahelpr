export const PINNED_DENO: string;
export function denoCacheDir(env?: Record<string, string | undefined>, home?: string): string;
export function resolveDeno(opts?: {
  env?: Record<string, string | undefined>;
  home?: string;
  runs?: (bin: string) => boolean;
  install?: (dir: string) => boolean;
  exists?: (p: string) => boolean;
  log?: (m: string) => void;
}): { bin: string; source: "path" | "npm" } | null;
