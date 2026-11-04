/**
 * Q2705/Q2706 boot cut (Builder 3, 11-04): the web boot path (main.tsx's static closure, so every page's first
 * download) no longer carries src/lib/nativePush.ts, a no-op on the web, or src/lib/signupLead.ts (the sign-up
 * page's email capture). SessionManager mounts the native push setup from its own chunk, only in the native app;
 * sign-out loads nativePush.ts for its push cleanup; the first-touch report reads the source rule from a
 * dependency-free module. Production build, bundle-size.yml env, same session: boot 195 -> 193 KB gz
 * (app-shared raw 212398 -> 205441 B), / 246 -> 243, /home 269 -> 267, /login 247 -> 245.
 *
 * @mutate src/components/SessionManager.tsx | import { isNativePlatform } from "@/lib/nativeInit"; | import { isNativePlatform } from "@/lib/nativeInit"; import "@/lib/nativePush";
 * @mutate src/lib/signupSource.ts | import { signupLeadSource } from "@/lib/signupLeadSource"; | import { signupLeadSource } from "@/lib/signupLead";
 * @mutate src/lib/authSignOut.ts | import { clearRememberedRoute } from "@/lib/lastRoute"; | import { clearRememberedRoute } from "@/lib/lastRoute"; import "@/lib/nativePush";
 * @mutate src/components/NativePushSetup.tsx |   useNativePushSetup(); |   void useNativePushSetup;
 * @mutate src/components/SessionManager.tsx | return isNativePlatform ? <Suspense fallback={null}><NativePushSetup /></Suspense> : null; | return null;
 * @mutate src/lib/authSignOut.ts | if (userId && push) await push.unregisterPushOnSignOut(userId); | void push;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootModules } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("the web boot path skips native push and the sign-up capture (Q2705/Q2706)", () => {
  const boot = bootModules(ROOT);
  const has = (f: string) => boot.has(resolve(ROOT, f).split("\\").join("/"));

  it("main.tsx's static closure does not reach nativePush.ts or signupLead.ts", () => {
    // Floor: the walk really covers boot.
    expect(boot.size).toBeGreaterThan(80);
    expect(has("src/components/SessionManager.tsx")).toBe(true);
    expect(has("src/lib/signupSource.ts")).toBe(true);
    expect(has("src/lib/signupLeadSource.ts")).toBe(true);
    expect(has("src/lib/nativePush.ts")).toBe(false);
    expect(has("src/components/NativePushSetup.tsx")).toBe(false);
    expect(has("src/lib/signupLead.ts")).toBe(false);
  });

  it("the native app still mounts the push setup, and sign-out still removes this device's push rows", () => {
    expect(read("src/components/NativePushSetup.tsx")).toMatch(/^\s*useNativePushSetup\(\);/m);
    const sm = read("src/components/SessionManager.tsx");
    expect(sm).toMatch(/lazy\(async \(\) => \(await loadModule\(\(\) => import\("@\/components\/NativePushSetup"\)\)\) \?\? untilReload\(\)\)/);
    expect(sm).toContain("return isNativePlatform ? <Suspense fallback={null}><NativePushSetup /></Suspense> : null;");
    const out = read("src/lib/authSignOut.ts");
    expect(out).toMatch(/loadModule\(\(\) => import\("@\/lib\/nativePush"\)\)/);
    expect(out).toContain("if (userId && push) await push.unregisterPushOnSignOut(userId);");
  });
});
