/**
 * GUARD (Q1422, lh-authz-rls review 2026-10-06, finding lh-authz-rls@6f19180fc#2):
 * scripts/lib/adminSession.mjs mints a session with the SERVICE ROLE, so no
 * password stands between a caller and any account it names. It used to mint
 * for ANY email: had a CI secret (PLAYWRIGHT_ADMIN_EMAIL) ever named the
 * owner's real account, automation would have signed in as the owner (on
 * 2026-10-07 prod auth.sessions showed 113 sessions in 24 h on
 * admin@louisianahelpr.com from CI-shaped user agents).
 *
 * Now mintAdminSession refuses, before any network call, every address that is
 * not a shared test account (the six in scripts/test-signin-link.mjs ACCOUNTS)
 * or a @mailinator.com fixture inbox (every such account is is_seed from its
 * first row, trg_profiles_seed_from_fixture_email; the throwaway journey and
 * privacy specs create them). Measured before enforcing (2026-10-12, prod
 * auth.sessions, 5 days): every session from automation (node / headless user
 * agents) was on one of those addresses.
 *
 * @mutate scripts/lib/adminSession.mjs |   const refused = mintRefusal(email);\n  if (refused) throw new Error(refused); |   const refused = null;
 * @mutate scripts/lib/adminSession.mjs | const FIXTURE_INBOX = /^[a-z0-9._+-]+@mailinator\.com$/; | const FIXTURE_INBOX = /@/;
 * @mutate scripts/lib/adminSession.mjs |   "helpr-seed-admin-0912@louisianahelpr.com",\n]); |   "helpr-seed-admin-0912@louisianahelpr.com",\n  "admin@louisianahelpr.com",\n]);
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mintAdminSession, mintRefusal, SHARED_TEST_EMAILS } from "../../scripts/lib/adminSession.mjs";
import { ACCOUNTS } from "../../scripts/test-signin-link.mjs";

describe("the service-role mint signs in test accounts only (Q1422)", () => {
  it("allows exactly the shared test accounts (two-way with test-signin-link's ACCOUNTS)", () => {
    const accounts = Object.values(ACCOUNTS as Record<string, { email: string }>).map((a) => a.email.toLowerCase()).sort();
    expect(accounts.length).toBeGreaterThanOrEqual(6);
    expect([...SHARED_TEST_EMAILS].sort()).toEqual(accounts);
    for (const e of accounts) expect(mintRefusal(e), e).toBeNull();
  });

  it("allows a @mailinator.com fixture inbox (throwaway and privacy specs)", () => {
    expect(mintRefusal("helpr-journey-throwaway-abc123@mailinator.com")).toBeNull();
    expect(mintRefusal("  Helpr-E2E-Poster-0902@Mailinator.com ")).toBeNull();
  });

  it("refuses a real account, a lookalike, and an empty name", () => {
    for (const e of [
      "admin@louisianahelpr.com",
      "someone@gmail.com",
      "helpr-e2e-poster-0902@mailinator.com.evil.com",
      "x@mailinator.co",
      "a@b@mailinator.com",
      "",
    ]) {
      expect(mintRefusal(e), e).toMatch(/refusing to mint/);
    }
  });

  afterEach(() => vi.unstubAllGlobals());

  it("refuses before any network call (generate_link goes through the global fetch)", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    let transportCalls = 0;
    const transport = async () => {
      transportCalls++;
      return { status: 500, text: "{}" };
    };
    await expect(
      mintAdminSession({ email: "admin@louisianahelpr.com", serviceKey: "service", supabaseUrl: "https://x.supabase.co", transport, retries: 0 }),
    ).rejects.toThrow(/refusing to mint/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transportCalls).toBe(0);
  });
});
