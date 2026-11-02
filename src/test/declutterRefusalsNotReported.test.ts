/**
 * Q1882: a Declutter designed refusal (a code the app has plain words for: wanted_rate_limited,
 * wanted_open_limit, offer_rate_limited, ...) is shown to the member and is NOT logged by the
 * QueryCache/MutationCache hooks as a defect. An error with no words (a real failure) still is.
 *
 * @mutate src/lib/queryClient.ts |   if ((error as { designedRefusal?: unknown } \| null)?.designedRefusal === true) return; |   void 0;
 * @mutate src/lib/declutter/api.ts | Object.assign(e, { userMessage: msg, designedRefusal: true }); | Object.assign(e, { userMessage: msg });
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));

beforeEach(() => report.mockClear());

async function thrownBy(code: string, words: string | null): Promise<unknown> {
  const { rpcData } = await import("@/lib/declutter/api");
  try {
    rpcData({ data: null, error: { message: code } }, () => words);
  } catch (e) {
    return e;
  }
  throw new Error("rpcData did not throw");
}

describe("designed Declutter refusals are not reported as defects (Q1882)", () => {
  it("a refusal with words is skipped by both cache hooks", async () => {
    const { reportCacheError } = await import("@/lib/queryClient");
    const e = await thrownBy("wanted_rate_limited", "You can post up to 5 wanted items a day. Try again tomorrow.");
    expect((e as { userMessage?: string }).userMessage).toBe("You can post up to 5 wanted items a day. Try again tomorrow.");
    reportCacheError("MutationCache", e, ["declutterWanted"]);
    reportCacheError("QueryCache", e, ["declutterWanted"]);
    expect(report).not.toHaveBeenCalled();
  });

  it("an error with no words is still reported at error severity", async () => {
    const { reportCacheError } = await import("@/lib/queryClient");
    const e = await thrownBy("relation \"x\" does not exist", null);
    reportCacheError("MutationCache", e, ["declutterWanted"]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toMatchObject({ severity: "error" });
  });
});
