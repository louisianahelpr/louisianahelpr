/**
 * Web push (owner approved 2026-10-29): every job action (post or apply) tells
 * the website's push ask (useWebPushAskAfterJobAction, mounted in
 * SessionManager) that now is a good time to explain notifications. Every
 * call, not just the first: the ask keeps its own 14-day cooldown, and a
 * member who said Not now once is asked again after a later job action.
 *
 * @mutate src/hooks/useNotificationPermissionPrompt.ts |   else if (typeof window !== "undefined") {\n    window.dispatchEvent(new Event(JOB_ACTION_EVENT)); |   else if (typeof window !== "undefined") {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  recordJobActionForPermissionPrompt,
  offerPushAskAfterPostReturn,
  JOB_ACTION_EVENT,
  ASK_AFTER_POST_KEY,
  ASK_AFTER_POST_MAX_AGE_MS,
} from "./useNotificationPermissionPrompt";
import { blankComments } from "@/test/helpers/blankNonCode";

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

// Q2003 (lead 11-04): a post leaves Post a Job for Stripe Checkout (or /payment-success) at once, so its ask is
// offered on the page the poster comes back to, not on the page that is leaving.
// @mutate src/hooks/useNotificationPermissionPrompt.ts |   if (opts?.askOnReturn) safeStorage.setItem(ASK_AFTER_POST_KEY, String(Date.now()));\n  else if | if
// @mutate src/hooks/useNotificationPermissionPrompt.ts |   window.dispatchEvent(new Event(JOB_ACTION_EVENT));\n  return true; |   return true;
// @mutate src/pages/post-job/useJobSubmit.ts | recordJobActionForPermissionPrompt({ askOnReturn: true }); | recordJobActionForPermissionPrompt();
// @mutate src/pages/post-job/PaymentSuccess.tsx |     offerPushAskAfterPostReturn(); |
describe("Q2003: a post's notifications ask waits for the page it returns to", () => {
  const count = (fn: () => void) => {
    let n = 0;
    const on = () => { n++; };
    window.addEventListener(JOB_ACTION_EVENT, on);
    try { fn(); } finally { window.removeEventListener(JOB_ACTION_EVENT, on); }
    return n;
  };

  it("a post records the ask without firing it on the leaving page", () => {
    expect(count(() => recordJobActionForPermissionPrompt({ askOnReturn: true }))).toBe(0);
    expect(localStorage.getItem(ASK_AFTER_POST_KEY)).not.toBeNull();
  });

  it("the return page offers it once", () => {
    recordJobActionForPermissionPrompt({ askOnReturn: true });
    expect(count(() => offerPushAskAfterPostReturn())).toBe(1);
    expect(count(() => offerPushAskAfterPostReturn())).toBe(0);
    expect(localStorage.getItem(ASK_AFTER_POST_KEY)).toBeNull();
  });

  it("no pending post, or one older than the limit (an abandoned checkout): nothing", () => {
    expect(count(() => offerPushAskAfterPostReturn())).toBe(0);
    const now = Date.now();
    localStorage.setItem(ASK_AFTER_POST_KEY, String(now - ASK_AFTER_POST_MAX_AGE_MS - 1));
    expect(count(() => offerPushAskAfterPostReturn(now))).toBe(0);
    expect(localStorage.getItem(ASK_AFTER_POST_KEY)).toBeNull();
  });

  it("an application (stays on the page) still fires at once", () => {
    expect(count(() => recordJobActionForPermissionPrompt())).toBe(1);
    expect(localStorage.getItem(ASK_AFTER_POST_KEY)).toBeNull();
  });

  it("Post a Job defers its ask and PaymentSuccess offers it", () => {
    const submit = blankComments(readFileSync("src/pages/post-job/useJobSubmit.ts", "utf8"));
    expect(submit).toMatch(/recordJobActionForPermissionPrompt\(\{ askOnReturn: true \}\);/);
    expect(submit).not.toMatch(/recordJobActionForPermissionPrompt\(\);/);
    const success = blankComments(readFileSync("src/pages/post-job/PaymentSuccess.tsx", "utf8"));
    expect(success).toMatch(/useEffect\(\(\) => \{\s*offerPushAskAfterPostReturn\(\);\s*\}, \[\]\);/);
  });
});
