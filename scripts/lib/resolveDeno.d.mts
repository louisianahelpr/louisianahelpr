import type { execFileSync } from "node:child_process";

export declare const PINNED_NPM_DENO: string;

export declare function resolveDeno(deps?: {
  exec?: typeof execFileSync | ((cmd: string, args: string[], opts?: unknown) => unknown);
  platform?: string;
}): { cmd: string; pre: string[]; via: "path" | "npm" } | null;
