/**
 * B51 (11-03, Q1158): Home's activity derivations load beside the data, not with the first draw.
 *
 * The to-do list, the live job and the waiting line come from the activity cores, which answer after Home's first
 * draw. Their code (needsYouTodos' derivation, nextUpStates, jobStatusLine, jobProgressState, jobNextStep and the
 * face actions) rode /home's boot download. It now loads on its own chunk (homeDerive.ts), started when
 * useNeedsYouTodos.ts evaluates. bootReach names homeDerive.ts as a Home root (else the chunk pulled other screens'
 * code), and the boot icons are pinned to main.tsx's own (icons-boot; lucide's merge otherwise folded a category set
 * into every page's boot). critical-path, real-key build: boot 198 -> 194 KB gz, /home 289 -> 267, /posts 199 -> 194,
 * /profile 391 -> 376, no route worse. Lab 375 median of 3: /home LCP 3860 -> 3768 ms (~/.lh-shots/b51-perf).
 */
// @mutate src/pages/home/homeDashboard/useHomeSummary.ts | import { useHomeDerive, useNeedsYouTodos } from "./useNeedsYouTodos";\n | import { useHomeDerive, useNeedsYouTodos } from "./useNeedsYouTodos";\nimport { deriveLiveNow as _eagerLiveNow } from "./nextUpStates";\nvoid _eagerLiveNow;\n
// @mutate src/components/tracker/JobProgress.tsx | import { JOB_PROGRESS_DRAWN, JOB_PROGRESS_SHORT, JOB_PROGRESS_STEPS } from "@/components/tracker/jobProgressSteps"; | import { JOB_PROGRESS_DRAWN, JOB_PROGRESS_SHORT, JOB_PROGRESS_STEPS } from "@/components/tracker/jobProgressState";
// @mutate src/pages/home/HomeDashboard.tsx | import { todoTarget } from "./homeDashboard/useNeedsYouTodos"; | import { todoTarget } from "./homeDashboard/needsYouTodos";
// @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts | const homeDeriveApi = () => loadModule(() => import("./homeDerive")); | import * as eagerDerive from "./homeDerive";\nconst homeDeriveApi = () => Promise.resolve(eagerDerive);
// @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts | void loadHomeDerive();\n | 
// @mutate scripts/perf/bootReach.mjs | toPosix(path.join(root, HOME_DERIVE_ROOT)), ...EVERY_PAGE_ROOTS.map((r) => toPosix(path.join(root, r))), ...DECLUTTER_ROOTS | ...EVERY_PAGE_ROOTS.map((r) => toPosix(path.join(root, r))), ...DECLUTTER_ROOTS
// @mutate scripts/perf/bootReach.mjs | ...roots, path.join(root, HOME_DERIVE_ROOT), ...EVERY_PAGE_ROOTS | ...roots, ...EVERY_PAGE_ROOTS
// @mutate vite.config.ts | && bootIcons.has(id.split | && homeIcons.has(id.split
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOME_DERIVE_ROOT, bootIconFiles, firstScreenRoots, homeFirstScreenRoots, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const rel = (p: string) => p.slice(ROOT.length + 1).replace(/\\/g, "/");
const code = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

/** The modules the derivations bring; none may be on Home's static (first-draw) reach. */
const DERIVE_ONLY = [
  "src/pages/home/homeDashboard/needsYouTodos.ts",
  "src/pages/home/homeDashboard/nextUpStates.ts",
  "src/pages/home/homeDashboard/homeDerive.ts",
  "src/components/job-card/jobStatusLine.ts",
  "src/components/tracker/jobProgressState.ts",
  "src/components/tracker/jobNextStep.ts",
  "src/pages/posts/postedJobCard/posterFaceAction.ts",
  "src/pages/jobs/appliedJobCard/helperFaceAction.ts",
];

describe("Home's derivations load beside the data", () => {
  it("none of the derivation modules is on Home's or main.tsx's static reach", () => {
    const reach = [...staticReach(ROOT, [join(ROOT, "src/main.tsx"), join(ROOT, "src/pages/home/HomeDashboard.tsx")])].map(rel);
    // Inventory floor: the walk really read Home's graph (main + Home reached 255 files on 2026-11-03).
    expect(reach.length).toBeGreaterThan(150);
    expect(reach).toContain("src/pages/home/homeDashboard/useNeedsYouTodos.ts");
    expect(reach).toContain("src/components/tracker/JobProgress.tsx");
    expect(reach.filter((f) => DERIVE_ONLY.includes(f))).toEqual([]);
  });

  it("useNeedsYouTodos starts the derivations' chunk when it evaluates, through loadModule", () => {
    const src = code("src/pages/home/homeDashboard/useNeedsYouTodos.ts");
    expect(src).toMatch(/const homeDeriveApi = \(\) => loadModule\(\(\) => import\("\.\/homeDerive"\)\);/);
    expect(src).toMatch(/^void loadHomeDerive\(\);$/m);
    // A type import is erased; a value import would put the derivations back on the first draw.
    expect(src).not.toMatch(/^import (?!type\b)[^;]*from "\.\/(needsYouTodos|nextUpStates|homeDerive)";$/m);
  });

  it("the derivations resolve with the three functions Home calls, and the hook module re-exports stay", async () => {
    const m = await import("@/pages/home/homeDashboard/useNeedsYouTodos");
    await m.loadHomeDerive();
    const d = await import("@/pages/home/homeDashboard/homeDerive");
    expect(typeof d.deriveNeedsYouTodos).toBe("function");
    expect(typeof d.deriveLiveNow).toBe("function");
    expect(typeof d.deriveWaiting).toBe("function");
    const legacy = await import("@/pages/home/homeDashboard/needsYouTodos");
    expect(legacy.useNeedsYouTodos).toBe(m.useNeedsYouTodos);
    expect(legacy.todoTarget).toBe(m.todoTarget);
  });

  it("bootReach names homeDerive.ts as a Home root, so its shared code keeps Home's chunk groups", () => {
    // Left out, the lazy chunk pulled signed-in-deep, browse-first-screen and other screens' chunks (lab js 367 -> 524 KB).
    const derive = join(ROOT, HOME_DERIVE_ROOT).replace(/\\/g, "/");
    expect(homeFirstScreenRoots(ROOT).map((r) => r.replace(/\\/g, "/"))).toContain(derive);
    expect(firstScreenRoots(ROOT).map((r) => r.replace(/\\/g, "/"))).toContain(derive);
  });

  it("the boot icons chunk is pinned to the icons main.tsx's graph draws (icons-boot), above every other icon group", () => {
    const icons = bootIconFiles(ROOT);
    expect(icons.size).toBeGreaterThan(0);
    expect(icons.has("refresh-cw")).toBe(true);
    const cfg = code("vite.config.ts");
    const group = cfg.match(/name: "icons-boot",\s*test: \(id: string\) => ([^\n]+),\s*priority: (\d+),/);
    expect(group?.[1]).toContain("bootIcons.has(");
    const others = [...cfg.matchAll(/name: "icons(?:-home|-rest)?",[\s\S]*?priority: (\d+),/g)].map((m) => Number(m[1]));
    expect(others.length).toBe(3);
    expect(Math.min(Number(group?.[2]), 999)).toBeGreaterThan(Math.max(...others));
    expect(cfg).toMatch(/const bootIcons = bootIconFiles\(process\.cwd\(\)\);/);
  });
});
