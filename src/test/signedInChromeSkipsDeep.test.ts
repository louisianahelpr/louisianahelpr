/**
 * The chrome App.tsx mounts beside EVERY signed-in page (the desktop top bar, its online-for-deliveries pill, the
 * terms re-consent dialog) must not pull the whole `signed-in-deep` chunk (B79, 11-01, Builder 77's measured
 * proposal). Their few signed-in-deep modules ride in their own small `signed-in-chrome` chunk, ranked above
 * signed-in-deep so it wins them. Before (production build, bundle-size.yml env): DesktopTopNav's closure past boot
 * 238 KB gz, TermsReconsentDialog's 236, /admin's 264; after 53, 101 and 152. Lab, Slow 4G, mocked admin: /admin
 * ready 4.47-4.53 s -> 4.14-4.17 s, 669 -> 622 KB on the wire.
 *
 * This reads the same source walk vite.config.ts splits by (scripts/perf/bootReach.mjs): every signed-in-deep
 * module those roots reach must match the signed-in-chrome group's test.
 *
 * @mutate vite.config.ts |               priority: 16.5, |               priority: 15.9,
 * @mutate vite.config.ts | (capturedPayment\|consent\|helprTasks[\\/]online) | (capturedPayment\|helprTasks[\\/]online)
 * @mutate vite.config.ts | (capturedPayment\|consent\|helprTasks[\\/]online) | (capturedPayment\|consent)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const rel = (abs: string) => abs.slice(ROOT.length + 1).split("\\").join("/");
/** App.tsx mounts these lazily beside every signed-in page. */
const CHROME = ["src/components/DesktopTopNav.tsx", "src/components/declutter/DeliveryOnlinePill.tsx", "src/components/TermsReconsentMount.tsx"];

const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
const groupOf = (name: string) => config.match(new RegExp(`name:\\s*"${name}",[\\s\\S]*?\\}`))?.[0] ?? "";
const priorityOf = (name: string) => Number(groupOf(name).match(/priority:\s*([\d.]+)/)?.[1]);

describe("every-page signed-in chrome does not pull signed-in-deep (B79)", () => {
  it("App.tsx still mounts each root lazily", () => {
    const app = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
    for (const f of CHROME) expect(app, f).toContain(f.replace(/^src\//, "").replace(/\.tsx$/, ""));
  });

  it("each signed-in-deep module they reach is caught by the signed-in-chrome group, which outranks signed-in-deep", () => {
    const { deep } = signedInSplit(ROOT);
    const reached = [...staticReach(ROOT, CHROME.map((f) => resolve(ROOT, f)))].filter((f) => deep.has(f)).map(rel);
    // Floor: the walk really reaches the deep modules (consent.ts, helprTasks/online.ts at the time of writing).
    expect(reached.length).toBeGreaterThan(1);
    const src = groupOf("signed-in-chrome").match(/test:\s*\/(.+)\/,\s*$/m)?.[1];
    expect(src, "signed-in-chrome group with a regex test").toBeTruthy();
    const test = new RegExp(src as string);
    expect(reached.filter((f) => !test.test("/" + f))).toEqual([]);
    expect(priorityOf("signed-in-chrome")).toBeGreaterThan(priorityOf("signed-in-deep"));
    expect(priorityOf("signed-in-chrome")).toBeLessThan(priorityOf("declutter-first-screen"));
  });
});
