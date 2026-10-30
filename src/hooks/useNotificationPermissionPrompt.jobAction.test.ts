/**
 * Web push (owner approved 2026-10-29): every job action (post or apply) tells
 * the website's push ask (useWebPushAskAfterJobAction, mounted in
 * SessionManager) that now is a good time to explain notifications. Every
 * call, not just the first: the ask keeps its own 14-day cooldown, and a
 * member who said Not Now once is asked again after a later job action.
 *
 * @mutate src/hooks/useNotificationPermissionPrompt.ts |     window.dispatchEvent(new Event(JOB_ACTION_EVENT)); |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { recordJobActionForPermissionPrompt, JOB_ACTION_EVENT } from "./useNotificationPermissionPrompt";

beforeEach(() => localStorage.clear());

describe("recordJobActionForPermissionPrompt", () => {
  it("dispatches helpr:job-action on every call", () => {
    let n = 0;
    const on = () => {
      n++;
    };
    window.addEventListener(JOB_ACTION_EVENT, on);
    try {
      recordJobActionForPermissionPrompt();
      recordJobActionForPermissionPrompt();
    } finally {
      window.removeEventListener(JOB_ACTION_EVENT, on);
    }
    expect(JOB_ACTION_EVENT).toBe("helpr:job-action");
    expect(n).toBe(2);
  });
});
