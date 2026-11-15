/**
 * Critical-path trim (Builder 2, 11-14): two things nobody sees on the You landing's first screen sat on its critical
 * path. Measured on a local build (scripts/perf/critical-path.mjs and the Profile chunk's static closure):
 *  - the photo crop dialog (react-easy-crop and the dialog primitives, 8.0 KB gz plus their closure), imported
 *    statically by useAvatarCrop although it draws only once a photo is picked;
 *  - pull-to-refresh (usePullToRefresh, PullToRefreshWrapper), which lived in the browse-first-screen chunk group, so
 *    /profile also fetched that whole 20.3 KB gz guest-browse chunk and the parish tables under it.
 * /profile's critical path 400 -> 359 KB gz; cwv-lab (poster, 375x812, Slow 4G + 4x CPU, 3 cold runs) LCP median
 * 4724 -> 4420 ms (~/.lh-shots/b2-perf2-1114/step1b-prefetch.json, step3-trim.json).
 *
 * This holds the source that produces that graph: the hook file reaches the dialog only through a lazy import, and the
 * two pull-to-refresh modules are kept out of browse-first-screen and in their own group (vite.config.ts). The bundle
 * itself is checked by land.sh's critical-path budget.
 */
// @mutate src/components/profile/AvatarCropDialog.tsx | import type { Area } from "react-easy-crop"; | import type { Area } from "react-easy-crop";\nimport "./AvatarCropDialogView";
// @mutate src/components/profile/AvatarCropDialog.tsx | const loadView = () => import("./AvatarCropDialogView"); | import * as viewModule from "./AvatarCropDialogView";\nconst loadView = async () => viewModule;
// @mutate src/components/profile/AvatarCropDialog.tsx |   const dialog = src ? ( |   const dialog = true ? (
// @mutate vite.config.ts | hooks[\\/](useMembershipsOn\|useArrivalGate\|usePullToRefresh)\.ts | hooks[\\/](useMembershipsOn\|useArrivalGate)\.ts
// @mutate vite.config.ts |               test: PULL_TO_REFRESH, |               test: /^$/,
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const staticImports = (src: string) => [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm)].map((m) => m[1] ?? m[2]);

describe("the You landing does not download what it does not draw", () => {
  it("useAvatarCrop reaches the crop dialog only through a lazy import, drawn only once a photo is picked", () => {
    const hook = code("src/components/profile/AvatarCropDialog.tsx");
    const imports = staticImports(hook);
    expect(imports.length).toBeGreaterThan(2);
    expect(imports).not.toContain("./AvatarCropDialogView");
    expect(imports).not.toContain("react-easy-crop");
    expect(imports).not.toContain("@/components/ui/dialog");
    expect(hook).toMatch(/const loadView = \(\) => import\("\.\/AvatarCropDialogView"\);/);
    expect(hook).toMatch(/lazy\(loadView\)/);
    expect(hook).toMatch(/const dialog = src \? \(/);
    // The view owns the heavy parts.
    const view = staticImports(code("src/components/profile/AvatarCropDialogView.tsx"));
    expect(view).toEqual(expect.arrayContaining(["react-easy-crop", "@/components/ui/dialog"]));
  });

  it("every caller takes the light hook file, never the view", () => {
    for (const f of ["src/pages/profile/Profile.tsx", "src/pages/auth/completeProfile/CompleteProfileAvatar.tsx"]) {
      const imports = staticImports(code(f));
      expect(imports, f).toContain("@/components/profile/AvatarCropDialog");
      expect(imports, f).not.toContain("@/components/profile/AvatarCropDialogView");
    }
  });

  it("pull-to-refresh stays out of the guest-browse chunk group, in its own", () => {
    const vite = code("vite.config.ts");
    const skips = /const BROWSE_GROUP_SKIPS = (\/.*\/);/.exec(vite)?.[1];
    const ptr = /const PULL_TO_REFRESH = (\/.*\/);/.exec(vite)?.[1];
    expect(skips && ptr).toBeTruthy();
    const skip = new Function(`return ${skips}`)() as RegExp;
    const own = new Function(`return ${ptr}`)() as RegExp;
    for (const id of ["/r/src/hooks/usePullToRefresh.ts", "/r/src/components/PullToRefreshWrapper.tsx"]) {
      expect(skip.test(id), id).toBe(true);
      expect(own.test(id), id).toBe(true);
    }
    expect(own.test("/r/src/hooks/useArrivalGate.ts")).toBe(false);
    expect(vite).toMatch(/name: "pull-to-refresh",\s*test: PULL_TO_REFRESH,/);
  });
});
