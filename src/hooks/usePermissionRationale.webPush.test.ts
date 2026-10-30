/**
 * Web push (owner approved 2026-10-29). Two rationale pieces the website ask uses
 * (src/hooks/useWebPush.ts):
 *  - notifications_home_screen: on iPhone Safari in a normal tab Apple offers no web
 *    push at all; only a site added to the Home Screen can ask. The sheet says how.
 *  - explainPermission(kind, run): ALWAYS shows the sheet (even when the kind was
 *    confirmed before), because the ask after a job action IS the moment to explain;
 *    the browser prompt is raised only from the sheet's own button (a tap).
 *
 * @mutate src/hooks/usePermissionRationale.ts | export function explainPermission(kind: PermissionKind, run: () => Promise<void> \| void): Promise<boolean> {\n  return explainThenRun(kind, run); | export function explainPermission(kind: PermissionKind, run: () => Promise<void> \| void): Promise<boolean> {\n  return Promise.resolve(run()).then(() => true);
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));

import {
  explainPermission,
  markRationaleConfirmed,
  usePermissionRationaleState,
  __resolveRationale,
} from "./usePermissionRationale";
import { renderHook } from "@testing-library/react";

beforeEach(() => {
  localStorage.clear();
  __resolveRationale(false);
});

const openKind = () => renderHook(() => usePermissionRationaleState()).result.current;

describe("explainPermission", () => {
  it("shows the sheet even for a kind confirmed before, and runs only on a yes", async () => {
    markRationaleConfirmed("notifications");
    const run = vi.fn();
    const p = explainPermission("notifications", run);
    expect(openKind().state.open).toBe(true);
    expect(openKind().state.kind).toBe("notifications");
    expect(run).not.toHaveBeenCalled();
    __resolveRationale(true);
    expect(await p).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("Not Now runs nothing", async () => {
    const run = vi.fn();
    const p = explainPermission("notifications", run);
    __resolveRationale(false);
    expect(await p).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("notifications_home_screen", () => {
  it("tells an iPhone member to add Helpr to the Home Screen", () => {
    void explainPermission("notifications_home_screen", () => {});
    const { copy } = openKind();
    expect(copy?.title).toBe("Notifications");
    expect(copy?.body).toMatch(/Add to Home Screen/);
    expect(copy?.body).toMatch(/Share/);
  });
});
