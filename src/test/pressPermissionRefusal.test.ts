/**
 * press-every-control must not score a CORRECT refusal as a failure — and must
 * still score every other error toast.
 *
 * Run 35660182220 (2026-09-21) failed two presses on every route carrying the
 * bell, for three of four personas:
 *
 *   "Notifications › Turn on push notifications › Not Now"                → error toast
 *   "Notifications › Turn on push notifications › Turn On Notifications"  → error toast
 *   → "Notifications are off. Turn them on in your browser settings."
 *
 * A Playwright context grants no notification permission, so the toast is TRUE.
 * The allow is therefore conditional on the environment, not on the string: the
 * toast must be the exact permission-off copy, the press must be inside the
 * push-permission prompt, and `Notification.permission` must really be
 * "denied". These cases hold that narrowness — a blanket "ignore error toasts"
 * would retire the check that finds real ones.
 *
 * ANTI-VACUITY: the two copy strings are not hand-typed here. They are read out
 * of src/components/NotificationPanel.tsx, so rewording the toast in the app
 * breaks this guard instead of silently widening the allow.
 *
 * @mutate scripts/audit/press-every-control.mjs | if (permission !== "denied") return false; | if (permission === "never") return false;
 * @mutate scripts/audit/press-every-control.mjs | return chain.some((label) => PUSH_PROMPT_LABEL_RX.test(String(label ?? "").trim())); | return true;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const isTruthfulPermissionRefusal = harness.isTruthfulPermissionRefusal as (a: {
  toast: string;
  chain?: string[];
  permission?: string;
}) => boolean;
const PERMISSION_OFF_TOAST_RX = harness.PERMISSION_OFF_TOAST_RX as RegExp;

const repoRoot = resolve(__dirname, "../..");
const panelSrc = readFileSync(resolve(repoRoot, "src/components/NotificationPanel.tsx"), "utf8");

/** The app's OWN copy, read from the file that prints it. */
const appCopy = [...panelSrc.matchAll(/"(Notifications are off\.[^"]*)"/g)].map((m) => m[1]);

/** The chain press-every-control builds for the two buttons inside the prompt. */
const NOT_NOW_CHAIN = ["Notifications", "Turn on push notifications", "Not Now"];
const TURN_ON_CHAIN = ["Notifications", "Turn on push notifications", "Turn On Notifications"];
const ROW_CHAIN = ["Notifications", "Turn on push notifications"];

describe("press-every-control: a truthful permission refusal is not a failed press", () => {
  it("matches every permission-off string the app actually prints", () => {
    // Floor: NotificationPanel prints one for native and one for web. If this
    // drops to zero the regex below is being checked against nothing.
    expect(appCopy.length).toBe(2);
    for (const copy of appCopy) expect(PERMISSION_OFF_TOAST_RX.test(copy)).toBe(true);
  });

  it("excuses both prompt buttons when the browser really has notifications denied", () => {
    for (const copy of appCopy) {
      for (const chain of [NOT_NOW_CHAIN, TURN_ON_CHAIN, ROW_CHAIN]) {
        expect(isTruthfulPermissionRefusal({ toast: copy, chain, permission: "denied" })).toBe(true);
      }
    }
  });

  it("still FAILS the same toast when the permission is not denied — that toast would be a lie", () => {
    for (const permission of ["granted", "default", "prompt", "unsupported", "unknown", undefined]) {
      expect(isTruthfulPermissionRefusal({ toast: appCopy[1], chain: NOT_NOW_CHAIN, permission })).toBe(false);
    }
  });

  it("still FAILS any OTHER error toast raised inside the same prompt", () => {
    for (const other of [
      "Couldn't save your notification settings.",
      "Something went wrong. Please try again.",
      "Notifications are off.",
      "Notifications are off. Turn them on in your browser settings. Then reload.",
      "",
    ]) {
      expect(isTruthfulPermissionRefusal({ toast: other, chain: NOT_NOW_CHAIN, permission: "denied" })).toBe(false);
    }
  });

  it("still FAILS the permission-off toast when it appears away from the push prompt", () => {
    for (const chain of [["Save Changes"], ["Notifications"], ["Profile", "Notification Preferences", "Save"], []]) {
      expect(isTruthfulPermissionRefusal({ toast: appCopy[1], chain, permission: "denied" })).toBe(false);
    }
  });
});
