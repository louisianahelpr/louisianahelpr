/**
 * AUD31-69 (Guests on Declutter): a guest on a Declutter item reads "It's free. You come back to this item after." and
 * presses Sign up (DeclutterGuestJoin: /signup?redirect=<the item>), but Signup said nothing of the item. Its step-1
 * line now says they come straight back to it, in the member's language; the notify line keeps its place.
 * (The Log in side: a guest bounced to /login with an item redirect reads AUD31-16's item notice, loginNotice.test.ts.)
 *
 * @mutate src/lib/jobIntent.ts |   if (safe && new URL(safe, "https://x.invalid").pathname.startsWith("/declutter/item/")) return t("signup.itemSubtitle"); |
 * @mutate src/lib/jobIntent.ts |   const safe = safeInternalRedirect(redirect);\n  if (safe && | const safe = redirect;\n  if (safe &&
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ITEM_SIGNUP_SUBTITLE, NOTIFY_SIGNUP_SUBTITLE, signupSubtitle } from "@/lib/jobIntent";
import { es } from "@/lib/i18n/es";
import { loginNotice } from "@/pages/auth/loginNotice";

describe("AUD31-69: Sign up from a Declutter item says the guest comes back to it", () => {
  it("an item redirect gets the come-back line; other pages and unsafe redirects get none; notify keeps its line", () => {
    expect(ITEM_SIGNUP_SUBTITLE).toMatch(/back to this item/);
    expect(signupSubtitle(null, "/declutter/item/00000000-0000-4000-8000-000000000001")).toBe(ITEM_SIGNUP_SUBTITLE);
    expect(signupSubtitle(null, "/declutter")).toBeUndefined();
    expect(signupSubtitle(null, "/jobs")).toBeUndefined();
    expect(signupSubtitle(null, null)).toBeUndefined();
    expect(signupSubtitle(null, "https://evil.example/declutter/item/x")).toBeUndefined();
    expect(signupSubtitle(null, "//evil.example/declutter/item/x")).toBeUndefined();
    expect(signupSubtitle("notify", "/declutter/item/x")).toBe(NOTIFY_SIGNUP_SUBTITLE);
  });

  it("the Spanish line exists", () => {
    expect(es["signup.itemSubtitle"]).toMatch(/artículo/);
  });

  it("Signup step 1 reads it from the URL", () => {
    const src = readFileSync(resolve(__dirname, "../pages/auth/Signup.tsx"), "utf8");
    expect(src).toMatch(/subtitle: signupSubtitle\(searchParams\.get\("reason"\), searchParams\.get\("redirect"\)\)/);
  });

  it("Log in from an item names the item, never the bare 'That page needs an account'", () => {
    const { notice } = loginNotice({ oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false,
      bouncedFromGatedRoute: true, redirect: "/declutter/item/00000000-0000-4000-8000-000000000001" });
    expect(notice).toMatch(/item for sale on Declutter/);
    expect(notice).not.toMatch(/That page needs an account/);
  });
});
