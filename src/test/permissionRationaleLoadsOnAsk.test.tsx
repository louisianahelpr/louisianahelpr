/**
 * The permission rationale dialog's chunk loads on the first ask (or once the page settles), not with the app
 * shell (B86, 11-01). App.tsx mounts PermissionRationaleMount for every visitor; mounting the dialog itself
 * there preloaded the Dialog primitives' chunk (guest /browse's code) and its closure, ~90 KB gz, on every
 * signed-in cold load in the same window as the dock (lab, /home on Slow 4G).
 *
 * @mutate src/components/PermissionRationaleMount.tsx |   useEffect(() => whenPageSettled(dialog.start), []); |   dialog.start();
 * @mutate src/components/PermissionRationaleMount.tsx |     if (state.open) dialog.start(); |     if (state.open) void 0;
 * @mutate src/App.tsx | <PermissionRationaleMount /> | <PermissionRationaleMount /><PermissionRationaleDialogDirect />
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const probe = vi.hoisted(() => ({ dialogLoads: 0, settle: null as null | (() => void) }));
vi.mock("@/components/PermissionRationaleDialog", () => {
  probe.dialogLoads++;
  return { PermissionRationaleDialog: () => <p>rationale dialog</p> };
});
vi.mock("@/lib/routePrefetch", () => ({
  whenPageSettled: (cb: () => void) => {
    probe.settle = cb;
    return () => {};
  },
}));

import { PermissionRationaleMount } from "@/components/PermissionRationaleMount";
import { explainPermission, __resolveRationale } from "@/hooks/usePermissionRationale";

describe("PermissionRationaleMount", () => {
  it("loads no dialog code until a rationale opens, then shows it", async () => {
    render(<PermissionRationaleMount />);
    await act(async () => {});
    expect(probe.dialogLoads).toBe(0);
    expect(screen.queryByText("rationale dialog")).toBeNull();

    act(() => {
      void explainPermission("location", () => {});
    });
    expect(await screen.findByText("rationale dialog")).toBeTruthy();
    expect(probe.dialogLoads).toBe(1);
    act(() => __resolveRationale(false));
  });

  it("warms the dialog once the page settles", () => {
    expect(probe.settle).toBeTypeOf("function");
  });
});

describe("App mounts only the thin host", () => {
  const app = blankComments(readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8"));
  it("imports the host, never the dialog", () => {
    expect(app).toMatch(/import\("@\/components\/PermissionRationaleMount"\)/);
    expect(app).toMatch(/<PermissionRationaleMount \/>/);
    expect(app).not.toMatch(/PermissionRationaleDialog/);
  });
});
