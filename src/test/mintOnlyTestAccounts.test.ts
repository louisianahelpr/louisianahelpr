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
 * or a @mailinator.com fixture inbox (the throwaway journey and privacy specs
 * create them and mark them is_seed; until 20261025161836 a trigger also did,
 * for any sign-up). Measured before enforcing (2026-10-12, prod
 * auth.sessions, 5 days): every session from automation (node / headless user
 * agents) was on one of those addresses.
 *
 * @mutate scripts/lib/adminSession.mjs |   const refused = mintRefusal(email);\n  if (refused) throw new Error(refused); |   const refused = null;
 * @mutate scripts/lib/adminSession.mjs | const FIXTURE_INBOX = /^[a-z0-9._+-]+@mailinator\.com$/; | const FIXTURE_INBOX = /@/;
 * @mutate scripts/lib/adminSession.mjs |   "helpr-seed-admin-0912@louisianahelpr.com",\n]); |   "helpr-seed-admin-0912@louisianahelpr.com",\n  "admin@louisianahelpr.com",\n]);
 *
 * Q2398 (finding lh-authz-rls@2f4bc154e0#3): a @mailinator.com address alone is
 * no longer enough, since 20261025161836 dropped the trigger that made every
 * mailinator sign-up is_seed. A non-shared mailinator inbox is minted only when
 * its profile is is_seed or enrolled in public.test_accounts, checked before
 * generate_link, and the session must be for that user.
 * @mutate scripts/lib/adminSession.mjs |   const mustBeUserId = await mintEligibility({ email, serviceKey, base, timeoutMs }); |   const mustBeUserId = null;
 * @mutate scripts/lib/adminSession.mjs |   if (profiles[0].is_seed === true) return userId; |   return userId;
 * @mutate scripts/lib/adminSession.mjs |   if (enrolled.length === 1) return userId; |   return userId;
 * @mutate scripts/lib/adminSession.mjs |     if (mustBeUserId !== null && String(session.user.id) !== mustBeUserId) { |     if (false) {
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("a mailinator inbox is minted only when it is a test account (Q2398)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const STRANGER = "someone-real-123@mailinator.com";

  /** A fake GoTrue + PostgREST: `profile` is the profiles row for the address, `enrolled` its test_accounts rows. */
  function fake({ profile, enrolled = [] as unknown[], sessionUserId = "u-1" }: { profile: unknown[]; enrolled?: unknown[]; sessionUserId?: string }) {
    const calls: string[] = [];
    let linked = STRANGER;
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      const json = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status });
      if (url.includes("/rest/v1/profiles?")) return calls.push("profiles"), json(200, profile);
      if (url.includes("/rest/v1/test_accounts?")) return calls.push("test_accounts"), json(200, enrolled);
      if (url.endsWith("/auth/v1/admin/generate_link")) {
        calls.push("generate_link");
        linked = JSON.parse(init?.body ?? "{}").email;
        return json(200, { hashed_token: "h" });
      }
      if (url.endsWith("/auth/v1/verify")) {
        calls.push("verify");
        return json(200, { access_token: "a", refresh_token: "r", user: { id: sessionUserId, email: linked } });
      }
      return json(404, {});
    });
    return calls;
  }
  const mint = (email = STRANGER) =>
    mintAdminSession({ email, serviceKey: "service", supabaseUrl: "https://x.supabase.co", retries: 0, lockDir: mkdtempSync(join(tmpdir(), "mint-")) });

  it("refuses a mailinator stranger (not is_seed, not enrolled) before generate_link", async () => {
    const calls = fake({ profile: [{ user_id: "u-1", is_seed: false }] });
    await expect(mint()).rejects.toThrow(/refusing to mint.*Q2398/);
    expect(calls).toEqual(["profiles", "test_accounts"]);
  });

  it("refuses an address with no profile, and a lookup that fails, before generate_link", async () => {
    const calls = fake({ profile: [] });
    await expect(mint()).rejects.toThrow(/0 profiles have this address/);
    expect(calls).not.toContain("generate_link");
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    await expect(mint()).rejects.toThrow(/lookup answered HTTP 500/);
  });

  it("mints an is_seed fixture inbox, and an enrolled one", async () => {
    let calls = fake({ profile: [{ user_id: "u-1", is_seed: true }] });
    await expect(mint()).resolves.toMatchObject({ access_token: "a" });
    expect(calls).toEqual(["profiles", "generate_link", "verify"]);
    calls = fake({ profile: [{ user_id: "u-1", is_seed: false }], enrolled: [{ user_id: "u-1" }] });
    await expect(mint()).resolves.toMatchObject({ access_token: "a" });
    expect(calls).toEqual(["profiles", "test_accounts", "generate_link", "verify"]);
  });

  it("refuses a session that is for a different user than the one checked", async () => {
    fake({ profile: [{ user_id: "u-1", is_seed: true }], sessionUserId: "u-2" });
    await expect(mint()).rejects.toThrow(/not the checked test account u-1/);
  });

  it("a shared test account needs no lookup", async () => {
    const calls = fake({ profile: [] });
    await expect(mint(SHARED_TEST_EMAILS[0])).resolves.toMatchObject({ access_token: "a" });
    expect(calls).toEqual(["generate_link", "verify"]);
  });
});
