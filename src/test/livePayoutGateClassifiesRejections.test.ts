/**
 * Lead 2026-10-23: Stripe rejected the platform account. Its two refusals
 * (measured in function_logs 2026-10-23) mean different things:
 *   "You cannot create new accounts because your account has been rejected."
 *     -> OUR platform: "cannot verify" this Helpr's account, nothing closed;
 *   "An account link cannot be created for this account because the account
 *    has been rejected."
 *     -> THIS connected account: closes its cached gate.
 * Every caller asks isPlatformRejectedError first, so the account classifier
 * must still never claim the platform's wording on its own.
 *
 * @mutate supabase/functions/_shared/livePayoutGate.ts |   return /\bhas been rejected\b/i.test(message) && !isPlatformRejectedError(err); |   return /\bhas been rejected\b/i.test(message);
 * @mutate supabase/functions/_shared/livePayoutGate.ts |   return /\byour account has been rejected\b/i.test(messageOf(err)); |   return false;
 */
import { describe, it, expect } from "vitest";
import {
  holdClosesCache,
  isPlatformRejectedError,
  isRejectedAccount,
  isRejectedAccountError,
} from "../../supabase/functions/_shared/livePayoutGate";

const PLATFORM = new Error("You cannot create new accounts because your account has been rejected.");
const ACCOUNT = new Error("An account link cannot be created for this account because the account has been rejected. Check the status of the account in your Stripe dashboard.");

describe("livePayoutGate tells a rejected platform from a rejected account", () => {
  it("the platform's refusal is the platform's, never the account's", () => {
    expect(isPlatformRejectedError(PLATFORM)).toBe(true);
    expect(isRejectedAccountError(PLATFORM)).toBe(false);
  });

  it("the account's refusal is the account's, never the platform's", () => {
    expect(isRejectedAccountError(ACCOUNT)).toBe(true);
    expect(isPlatformRejectedError(ACCOUNT)).toBe(false);
  });

  it("other errors are neither", () => {
    for (const e of [new Error("stripe 503"), null, undefined, "has been rejected", { message: 42 }]) {
      expect(isPlatformRejectedError(e)).toBe(false);
      expect(isRejectedAccountError(e)).toBe(false);
    }
  });

  it("an account is rejected only by a rejected.* disabled_reason", () => {
    expect(isRejectedAccount({ requirements: { disabled_reason: "rejected.fraud" } } as never)).toBe(true);
    expect(isRejectedAccount({ requirements: { disabled_reason: "requirements.past_due" } } as never)).toBe(false);
    expect(isRejectedAccount(null)).toBe(false);
  });

  it("only rejected and unusable holds close the cached gate", () => {
    expect(holdClosesCache({ ok: false, kind: "rejected", reason: "" })).toBe(true);
    expect(holdClosesCache({ ok: false, kind: "unusable", reason: "" })).toBe(true);
    for (const kind of ["not_payable", "platform_rejected", "cannot_verify"] as const) {
      expect(holdClosesCache({ ok: false, kind, reason: "" })).toBe(false);
    }
  });
});
