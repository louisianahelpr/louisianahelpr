/**
 * The app asks for notifications the way the website does: the in-app
 * notifications sheet right after the member's first post or application,
 * never a floating "Get notified?" toast (Q2003, owner answer 2026-11-03 via
 * the lead: "the app uses the website's sheet, right after the first post or
 * application; no floating 'Get notified?' pop-up").
 *
 *  - native, permission undecided: a job action opens explainPermission
 *    ("notifications"), and its button raises the OS prompt
 *    (nativePush.requestPushPermission);
 *  - native, already granted or already refused: no sheet;
 *  - the old toast path is gone: pushPermissionNudge.ts has no toast and no
 *    usePushPermissionNudge, and nothing in src/ triggers it.
 *
 * @mutate src/hooks/useWebPush.ts |     if (isNativePlatform) await askNativeOnce(context); |     if (false) await askNativeOnce(context);
 * @mutate src/hooks/useWebPush.ts |   if ((await readPushPermission()) !== "prompt") return; |
 * @mutate src/hooks/useWebPush.ts |     const granted = await requestPushPermission(); |     const granted = false;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const env = vi.hoisted(() => ({ native: true, ios: true, permission: "prompt" as string }));
const explain = vi.fn();
const requestPush = vi.fn(async () => true);

vi.mock("@/lib/nativeInit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nativeInit")>()),
  get isNativePlatform() { return env.native; },
  get isNativeIos() { return env.native && env.ios; },
}));
vi.mock("@/lib/nativePush", () => ({ requestPushPermission: () => requestPush() }));
type Opts = { onShown?: () => void; continueOnly?: boolean } | undefined;
vi.mock("@/hooks/usePermissionRationale", () => ({
  explainPermission: (kind: string, run: () => unknown, opts?: Opts) => explain(kind, run, opts),
}));
vi.mock("@/lib/pushPermissionNudge", () => ({
  waitForNoModal: async () => true,
  readPushPermission: async () => env.permission,
}));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));

import { offerWebPushAfterJobAction, WEB_PUSH_ASKED_KEY } from "@/hooks/useWebPush";

beforeEach(() => {
  localStorage.clear();
  explain.mockReset();
  requestPush.mockClear();
  env.native = true;
  env.ios = true;
  env.permission = "prompt";
});

describe("the app asks with the sheet after a job action (Q2003)", () => {
  it("native, undecided: the notifications sheet opens and its button raises the OS prompt", async () => {
    explain.mockImplementation(async (_k: string, run: () => Promise<void>, opts: Opts) => { opts?.onShown?.(); await run(); return true; });
    await offerWebPushAfterJobAction();
    expect(explain).toHaveBeenCalledTimes(1);
    expect(explain.mock.calls[0][0]).toBe("notifications");
    expect(requestPush).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(WEB_PUSH_ASKED_KEY)).not.toBeNull();
  });

  it("native, already granted or refused: no sheet", async () => {
    for (const p of ["granted", "denied", "unsupported"]) {
      env.permission = p;
      await offerWebPushAfterJobAction();
    }
    expect(explain).not.toHaveBeenCalled();
  });

  it("native: one ask per cooldown, like the website", async () => {
    explain.mockImplementation(async (_k: string, _r: () => unknown, opts: Opts) => { opts?.onShown?.(); return false; });
    await offerWebPushAfterJobAction();
    await offerWebPushAfterJobAction();
    expect(explain).toHaveBeenCalledTimes(1);
  });

  // @mutate src/hooks/useWebPush.ts |     { onShown: () => markAskShown("native"), ...(words ? { words } : {}), ...(isNativeIos ? { continueOnly: true } : {}) }, |     { onShown: () => {}, ...(words ? { words } : {}), ...(isNativeIos ? { continueOnly: true } : {}) }, markAskShown("native"),
  it("native: a sheet that never rendered does not spend the cooldown (Q2003, lead 11-04)", async () => {
    explain.mockImplementation(async () => false); // dismissed before it ever rendered: onShown never ran
    await offerWebPushAfterJobAction();
    expect(localStorage.getItem(WEB_PUSH_ASKED_KEY)).toBeNull();
    await offerWebPushAfterJobAction();
    expect(explain).toHaveBeenCalledTimes(2);
  });

  // Apple 5.1.1(iv) (iOS pre-build check, 11-20): on iPhone the sheet has one Continue (no decline on our screen);
  // Android keeps both buttons. The dialog half is src/test/iosPushAskContinueOnly.test.tsx.
  // @mutate src/hooks/useWebPush.ts | ...(isNativeIos ? { continueOnly: true } : {}) | ...({})
  it("native iOS asks for the Continue-only sheet; Android does not", async () => {
    explain.mockImplementation(async (_k: string, _r: () => unknown, opts: Opts) => { opts?.onShown?.(); return true; });
    await offerWebPushAfterJobAction("posted");
    expect(explain.mock.calls[0][2]?.continueOnly).toBe(true);
    localStorage.clear();
    env.ios = false;
    await offerWebPushAfterJobAction("posted");
    expect(explain).toHaveBeenCalledTimes(2);
    expect(explain.mock.calls[1][2]?.continueOnly).toBeUndefined();
  });

  it("the floating toast path is gone", () => {
    const nudge = blankComments(readFileSync("src/lib/pushPermissionNudge.ts", "utf8"));
    expect(nudge).not.toMatch(/\btoast\s*\(/);
    expect(nudge).not.toMatch(/usePushPermissionNudge/);
    expect(nudge).not.toMatch(/Get notified\?/);
    const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|^src\/test\//.test(f));
    expect(files.length).toBeGreaterThan(500);
    const callers = files.filter((f) => /usePushPermissionNudge|triggerPushNudge/.test(blankComments(readFileSync(f, "utf8"))));
    expect(callers).toEqual([]);
  });
});
