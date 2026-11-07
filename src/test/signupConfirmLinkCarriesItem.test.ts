/**
 * 11-07 (owner posting free Declutter items in local Facebook groups; the Q2496 pattern for Declutter): a guest opens a
 * shared item link in Facebook's built-in browser, signs up there, and opens the confirmation email in Safari or
 * Chrome. The item they came for lived only in the first browser's storage (`?redirect=`), so they landed on /home.
 * Now the sign-up's redirect_to carries `?item=<uuid>`, the auth email hook copies a valid item id into the confirm
 * link (confirm page's own path only), and the Check your email page sends the confirmed member to
 * /declutter/item/<id> when this browser has no destination of its own.
 *
 * @mutate supabase/functions/_shared/confirmLink.ts |   if (itemId && JOB_ID.test(itemId)) url.searchParams.set("item", itemId);\n |
 * @mutate supabase/functions/_shared/confirmLink.ts |     return url.pathname === CONFIRM_LINK_PATH && JOB_ID.test(item) ? item.toLowerCase() : null; |     return item \|\| null;
 * @mutate supabase/functions/auth-email-hook/index.ts | confirmLinkJobFromRedirect(emailData.redirect_to),\n        confirmLinkItemFromRedirect(emailData.redirect_to)) | confirmLinkJobFromRedirect(emailData.redirect_to))
 * @mutate src/lib/jobIntent.ts |   return linkItemId && ITEM_UUID.test(linkItemId) ? `/declutter/item/${linkItemId.toLowerCase()}` : fallback; |   return fallback;
 * @mutate src/lib/jobIntent.ts |   return m && ITEM_UUID.test(m[1]) ? m[1].toLowerCase() : null; |   return m ? m[1] : null;
 * @mutate src/lib/authRedirects.ts |   if (itemId) q.set("item", itemId); |
 * @mutate src/pages/auth/Signup.tsx | emailRedirectTo: getSignupConfirmRedirect(peekJobIntent(), peekSignupRedirectItem()), | emailRedirectTo: getSignupConfirmRedirect(peekJobIntent()),
 * @mutate src/pages/auth/SignupPending.tsx | onConfirmed={() => navigate(postAuthDestination("/home", confirmLinkJob(location.search), confirmLinkItem(location.search)), { replace: true })} | onConfirmed={() => navigate(postAuthDestination("/home", confirmLinkJob(location.search)), { replace: true })}
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { confirmLinkItem, confirmLinkItemFromRedirect, confirmLinkUrl } from "../../supabase/functions/_shared/confirmLink";
import { getSignupConfirmRedirect } from "@/lib/authRedirects";
import { peekSignupRedirectItem, postAuthDestination, rememberJobIntent, rememberSignupRedirect } from "@/lib/jobIntent";
import { safeStorage } from "@/lib/safeStorage";

const ITEM = "7a5bad84-413f-4eeb-8c8d-0793310ff040";
const JOB = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const APP = "https://www.louisianahelpr.com";
const code = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("a sign-up finished in another browser keeps the shared Declutter item (11-07)", () => {
  beforeEach(() => {
    safeStorage.removeItem("helpr.jobIntent");
    safeStorage.removeItem("helpr.signupRedirect");
  });

  it("the sign-up's redirect_to carries the item, beside a job when there is one", () => {
    const only = new URL(getSignupConfirmRedirect(null, ITEM));
    expect(only.pathname).toBe("/signup-pending");
    expect(only.searchParams.get("item")).toBe(ITEM);
    expect(only.searchParams.has("job")).toBe(false);
    const both = new URL(getSignupConfirmRedirect(JOB, ITEM));
    expect([both.searchParams.get("job"), both.searchParams.get("item")]).toEqual([JOB, ITEM]);
    expect(new URL(getSignupConfirmRedirect()).search).toBe("");
    expect(new URL(getSignupConfirmRedirect(JOB)).searchParams.get("job")).toBe(JOB);
  });

  it("the hook reads an item id only from the confirm page's own redirect, a uuid only", () => {
    expect(confirmLinkItemFromRedirect(`${APP}/signup-pending?item=${ITEM}`)).toBe(ITEM);
    expect(confirmLinkItemFromRedirect(`${APP}/signup-pending?item=${ITEM.toUpperCase()}`)).toBe(ITEM);
    expect(confirmLinkItemFromRedirect(`${APP}/signup-pending?job=${JOB}&item=${ITEM}`)).toBe(ITEM);
    expect(confirmLinkItemFromRedirect(`${APP}/signup-pending`)).toBeNull();
    expect(confirmLinkItemFromRedirect(`${APP}/elsewhere?item=${ITEM}`)).toBeNull();
    expect(confirmLinkItemFromRedirect(`${APP}/signup-pending?item=../../admin`)).toBeNull();
    expect(confirmLinkItemFromRedirect(`${APP}/signup-pending?item=https://evil.example`)).toBeNull();
    expect(confirmLinkItemFromRedirect("not a url")).toBeNull();
    expect(confirmLinkItemFromRedirect(undefined)).toBeNull();
  });

  it("the confirm link carries a valid item id, and nothing else", () => {
    const url = new URL(confirmLinkUrl(APP, "abcDEF123_-xyz", "signup", null, ITEM));
    expect(url.pathname).toBe("/signup-pending");
    expect(url.searchParams.get("item")).toBe(ITEM);
    expect(url.searchParams.get("token_hash")).toBe("abcDEF123_-xyz");
    expect(url.searchParams.has("job")).toBe(false);
    expect(new URL(confirmLinkUrl(APP, "t", "signup", null, "evil")).searchParams.has("item")).toBe(false);
    expect(new URL(confirmLinkUrl(APP, "t", "signup")).searchParams.has("item")).toBe(false);
    expect(confirmLinkItem(`?token_hash=x&type=signup&item=${ITEM}`)).toBe(ITEM);
    expect(confirmLinkItem("?item=/declutter/item/x")).toBeNull();
  });

  it("this browser's pending redirect names the item it was for (and only an item page)", () => {
    expect(peekSignupRedirectItem()).toBeNull();
    rememberSignupRedirect(`/declutter/item/${ITEM}`);
    expect(peekSignupRedirectItem()).toBe(ITEM);
    // Not cleared: the destination still wins after confirming in this browser.
    expect(postAuthDestination("/home", null, null)).toBe(`/declutter/item/${ITEM}`);
    rememberSignupRedirect(`/declutter/item/not-a-uuid`);
    expect(peekSignupRedirectItem()).toBeNull();
    rememberSignupRedirect(`/jobs/${JOB}`);
    expect(peekSignupRedirectItem()).toBeNull();
  });

  it("after confirming: this browser's destination wins, then a job, then the link's item, else Home", () => {
    expect(postAuthDestination("/home", null, ITEM)).toBe(`/declutter/item/${ITEM}`);
    expect(postAuthDestination("/home", null, ITEM.toUpperCase())).toBe(`/declutter/item/${ITEM}`);
    expect(postAuthDestination("/home", null, "../admin")).toBe("/home");
    expect(postAuthDestination("/home", JOB, ITEM)).toBe(`/home?quickApply=${JOB}`);
    rememberJobIntent("other-job");
    expect(postAuthDestination("/home", null, ITEM)).toBe("/home?quickApply=other-job");
    rememberSignupRedirect("/declutter");
    expect(postAuthDestination("/home", null, ITEM)).toBe("/declutter");
    expect(postAuthDestination("/home", null, null)).toBe("/home");
  });

  it("the sign-up, the resend, both confirm paths and the hook all pass the item along", () => {
    expect(code("src/pages/auth/Signup.tsx")).toContain("emailRedirectTo: getSignupConfirmRedirect(peekJobIntent(), peekSignupRedirectItem()),");
    const pending = code("src/pages/auth/SignupPending.tsx");
    expect(pending).toMatch(/getSignupConfirmRedirect\(peekJobIntent\(\) \?\? confirmLinkJob\(location\.search\),\s*peekSignupRedirectItem\(\) \?\? confirmLinkItem\(location\.search\)\)/);
    expect(pending.match(/postAuthDestination\("\/home", confirmLinkJob\(location\.search\), confirmLinkItem\(location\.search\)\)/g)?.length).toBe(2);
    expect(code("supabase/functions/auth-email-hook/index.ts")).toMatch(
      /confirmLinkUrl\(getAppUrl\(\), emailData\.token_hash, 'signup', confirmLinkJobFromRedirect\(emailData\.redirect_to\),\s*confirmLinkItemFromRedirect\(emailData\.redirect_to\)\)/);
  });
});
