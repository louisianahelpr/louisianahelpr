/**
 * Q2705 / Q1158 (2026-11-17): guest /browse loads the job preview dialog when a guest first opens a job, not before
 * the first card.
 *
 * DashboardGuest imported GuestJobPreview statically, and GuestJobPreview imports the shared Dialog. DashboardGuest's
 * modules ride in the browse-first-screen chunk (vite.config.ts), which signed-in /jobs also loads for JobCard, so that
 * one import put dialog.tsx, Radix Dialog, react-remove-scroll and the focus scope on the critical path of every
 * phone's /jobs and guest /browse. Measured on `npx vite build` of main 07de1aaf62 vs this change
 * (scripts/perf/critical-path.mjs, prod .env): /jobs 378 -> 358 KB gz, /browse 298 -> 278 KB gz. The preview chunk is
 * warmed once the page settles (whenPageSettled), so a tap does not wait on the network.
 */
// @mutate src/pages/home/DashboardGuest.tsx | import { whenPageSettled } from "@/lib/pageSettled"; | import { whenPageSettled } from "@/lib/pageSettled";\nimport "@/components/dashboard/GuestJobPreview";
// @mutate src/lib/jobIntent.ts | export const guestLogInUrl = (jobId: string) => | import "@/components/ui/dialog";\nexport const guestLogInUrl = (jobId: string) =>
// @mutate src/pages/home/DashboardGuest.tsx |   useEffect(() => whenPageSettled(() => void loadGuestJobPreview() | useEffect(() => (() => void loadGuestJobPreview()
// @mutate src/pages/home/DashboardGuest.tsx | const loadGuestJobPreview = () => import("@/components/dashboard/GuestJobPreview"); | const loadGuestJobPreview = () => import("@/components/dashboard/GuestJobPage");
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const posix = (f: string) => f.replace(/\\/g, "/");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** Never on guest /browse's static graph: the preview and the dialog it opens. */
const OFF_FIRST_SCREEN = ["src/components/dashboard/GuestJobPreview.tsx", "src/components/ui/dialog.tsx"] as const;

describe("guest /browse loads the job preview on open (Q2705)", () => {
  const reach = [...staticReach(ROOT, [join(ROOT, "src/pages/home/DashboardGuest.tsx")])].map(posix);

  it("DashboardGuest does not statically reach GuestJobPreview or the Dialog", () => {
    // Inventory floor: the walk read the guest feed's graph (its cards, toolbar and the shared job intent).
    expect(reach.length).toBeGreaterThan(100);
    for (const f of ["src/components/dashboard/JobCard.tsx", "src/components/dashboard/BrowseTasksToolbar.tsx", "src/lib/jobIntent.ts"]) {
      expect(reach.some((r) => r.endsWith(`/${f}`)), f).toBe(true);
    }
    for (const f of OFF_FIRST_SCREEN) expect(reach.filter((r) => r.endsWith(`/${f}`)), f).toEqual([]);
  });

  it("the preview is still opened from the tap, and its code is warmed once the page settles", () => {
    const page = code("src/pages/home/DashboardGuest.tsx");
    expect(page).toContain('const loadGuestJobPreview = () => import("@/components/dashboard/GuestJobPreview");');
    expect(page).toMatch(/const GuestJobPreview = lazy\(\(\) => loadGuestJobPreview\(\)\.then\(\(m\) => \(\{ default: m\.GuestJobPreview \}\)\)\);/);
    expect(page).toMatch(/useEffect\(\(\) => whenPageSettled\(\(\) => void loadGuestJobPreview\(\)/);
    expect(page).toMatch(/<Suspense fallback=\{null\}>\s*<GuestJobPreview job=\{detailJob\}/);
    // Log in still comes back to the job, from the dialog-free module.
    expect(code("src/lib/jobIntent.ts")).toMatch(/export const guestLogInUrl = \(jobId: string\) => `\/login\?redirect=\$\{encodeURIComponent\(`\/jobs\/\$\{jobId\}`\)\}`;/);
  });
});
