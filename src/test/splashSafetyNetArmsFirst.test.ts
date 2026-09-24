/**
 * NB-009: the splash safety net must arm before any module with a top-level
 * await evaluates. ES modules evaluate in import order, dependencies first, so
 * it has to be main.tsx's FIRST import and must not itself reach the Supabase
 * client (whose top-level `await hydratePromise` can take HYDRATE_TIMEOUT_MS).
 *
 * @mutate src/main.tsx | import "./lib/splashSafetyNet"; | import "./lib/errorLogger";
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("splash safety net arms first (NB-009)", () => {
  it("is main.tsx's first import", () => {
    const first = read("main.tsx").match(/^import\s[^;]*;/m);
    expect(first?.[0]).toBe('import "./lib/splashSafetyNet";');
  });

  it("imports only @capacitor/* (nothing that can reach a top-level await)", () => {
    const imports = [...read("lib/splashSafetyNet.ts").matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThanOrEqual(1);
    for (const i of imports) expect(i).toMatch(/^@capacitor\//);
  });

  it("arms the 1.5s timer, and nativeInit no longer carries a late copy", () => {
    expect(read("lib/splashSafetyNet.ts")).toMatch(/setTimeout\([\s\S]*SplashScreen\.hide[\s\S]*1500\)/);
    expect(read("lib/nativeInit.ts")).not.toMatch(/setTimeout\([\s\S]{0,120}SplashScreen\.hide/);
  });
});
