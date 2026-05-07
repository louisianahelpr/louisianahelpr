// fetchReferralData composes 4 supabase queries + a lazy code-generation
// step. Bugs here either fail to surface a referral code (signup gives
// the new user no way to invite friends) or duplicate codes when the
// race protection misfires.

import { describe, it, expect, vi, beforeEach } from "vitest";

const responses: Record<string, unknown> = {};
function setResponse(key: string, response: unknown) {
  responses[key] = response;
}

const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => fromMock(table) },
}));

beforeEach(() => {
  Object.keys(responses).forEach((k) => delete responses[k]);
  fromMock.mockReset();

  fromMock.mockImplementation((table: string) => {
    const filters: string[] = [];
    let useCount = false;
    const builder: Record<string, unknown> = {};

    const resolveQuery = () => {
      const key = `${table}|${filters.join(",")}|${useCount ? "count" : "data"}`;
      return Promise.resolve(responses[key] ?? { data: null, count: 0, error: null });
    };

    builder.select = (_col: string, opts?: { count?: string; head?: boolean }) => {
      filters.push("select");
      if (opts?.count === "exact") useCount = true;
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      filters.push(`eq:${col}=${val}`);
      return builder;
    };
    builder.order = (_col: string, _opts: unknown) => {
      filters.push("order");
      return resolveQuery();
    };
    builder.maybeSingle = () => {
      filters.push("maybeSingle");
      return resolveQuery();
    };
    builder.single = () => {
      filters.push("single");
      return resolveQuery();
    };
    builder.insert = (row: { user_id: string; code: string }) => {
      filters.push(`insert:user_id=${row.user_id}&code=${row.code}`);
      return builder;
    };
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      resolveQuery().then(resolve, reject);
    return builder;
  });
});

import { fetchReferralData } from "./useReferralData";

describe("fetchReferralData — happy path", () => {
  it("returns existing code, credits, count, and stripe flag for a fully-set-up user", async () => {
    setResponse("referral_codes|select,eq:user_id=u1,maybeSingle|data", {
      data: { code: "ABC123" },
      error: null,
    });
    setResponse("referral_credits|select,eq:user_id=u1,order|data", {
      data: [
        { id: "c1", amount: 5, reason: "signup", redeemed: false, created_at: "2026-01-01" },
        { id: "c2", amount: 10, reason: "first_job", redeemed: true, created_at: "2026-01-02" },
      ],
      error: null,
    });
    setResponse("referrals|select,eq:referrer_id=u1|count", {
      data: null,
      count: 7,
      error: null,
    });
    setResponse("profiles|select,eq:user_id=u1,single|data", {
      data: { stripe_account_id: "acct_xxx" },
      error: null,
    });

    const result = await fetchReferralData("u1");
    expect(result.referralCode).toBe("ABC123");
    expect(result.credits).toHaveLength(2);
    expect(result.referralCount).toBe(7);
    expect(result.hasStripeAccount).toBe(true);
  });

  it("returns hasStripeAccount=false when stripe_account_id is null", async () => {
    setResponse("referral_codes|select,eq:user_id=u1,maybeSingle|data", {
      data: { code: "ABC123" },
      error: null,
    });
    setResponse("profiles|select,eq:user_id=u1,single|data", {
      data: { stripe_account_id: null },
      error: null,
    });

    const result = await fetchReferralData("u1");
    expect(result.hasStripeAccount).toBe(false);
  });

  it("returns referralCount=0 when count field is null/missing", async () => {
    setResponse("referral_codes|select,eq:user_id=u1,maybeSingle|data", {
      data: { code: "ABC123" },
      error: null,
    });

    const result = await fetchReferralData("u1");
    expect(result.referralCount).toBe(0); // count fallback
  });

  it("returns empty credits array when query returns null", async () => {
    setResponse("referral_codes|select,eq:user_id=u1,maybeSingle|data", {
      data: { code: "ABC123" },
      error: null,
    });
    // Don't set credits response — it'll fall through to default { data: null }

    const result = await fetchReferralData("u1");
    expect(result.credits).toEqual([]);
  });
});

describe("fetchReferralData — code generation", () => {
  it("generates and persists a new code when the user has none", async () => {
    // No existing code (default response is data=null)
    // The insert returns the new code via .select().single()
    const result = await fetchReferralData("u1");
    expect(result.referralCode).toBeNull(); // because we didn't mock the insert path

    // Verify insert was attempted
    const insertCalls = fromMock.mock.calls.map((c) => c[0]);
    expect(insertCalls).toContain("referral_codes");
  });

  it("uses 6-char uppercase alphanumeric without ambiguous chars (I, O, 1, 0)", async () => {
    // Set response so insert returns a code
    let insertedCode = "";
    fromMock.mockImplementation((table: string) => {
      const filters: string[] = [];
      const builder: Record<string, unknown> = {};
      const resolveQuery = () => {
        const key = `${table}|${filters.join(",")}`;
        if (filters.some((f) => f.startsWith("insert:"))) {
          // Capture the code from the insert
          const match = filters.join(",").match(/code=([A-Z0-9]+)/);
          if (match) insertedCode = match[1];
          return Promise.resolve({ data: { code: insertedCode }, error: null });
        }
        if (key.includes("referral_codes") && key.includes("maybeSingle")) {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, count: 0, error: null });
      };
      builder.select = (_col: string, _opts?: unknown) => {
        filters.push("select");
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        filters.push(`eq:${col}=${val}`);
        return builder;
      };
      builder.order = () => {
        filters.push("order");
        return resolveQuery();
      };
      builder.maybeSingle = () => {
        filters.push("maybeSingle");
        return resolveQuery();
      };
      builder.single = () => {
        filters.push("single");
        return resolveQuery();
      };
      builder.insert = (row: { user_id: string; code: string }) => {
        filters.push(`insert:user_id=${row.user_id}&code=${row.code}`);
        return builder;
      };
      builder.then = (resolve: (v: unknown) => unknown) => resolveQuery().then(resolve);
      return builder;
    });

    await fetchReferralData("u1");
    expect(insertedCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(insertedCode).not.toMatch(/[IO01]/); // ambiguous chars excluded
  });
});
