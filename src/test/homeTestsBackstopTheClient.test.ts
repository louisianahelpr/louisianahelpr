/**
 * The Home and dock screen tests answer every unmocked read with "nothing", so Home's data code can move behind
 * dynamic imports (the /home bundle cut, AUD31-60/66) without a test reaching prod (B44, 10-31).
 *
 * Measured: vi.mock reaches a dynamic import made inside a source module (alias and relative paths). B84's cut leaked
 * because a read landed in a module these tests never mocked: with dashboardsShell's declutter/api mock removed and no
 * client backstop, prodNetworkGuard refuses rest/v1/declutter_items and rpc/declutter_my_cart (the B84 symptom); with
 * the backstop the same file is 27/27 green.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

// @mutate src/test/dashboardsShell.test.tsx | vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule()); |
// @mutate src/test/helpers/emptySupabaseClient.ts |       return chain();\n    }, |       return undefined;\n    },

const BACKSTOP = 'vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule());';
const FILES = ["src/test/dashboardsShell.test.tsx", "src/test/centerCreateNav.test.tsx", "src/test/badgeIsTodo.test.tsx"];

describe("Home's screen tests backstop the Supabase client", () => {
  it("each mocks the client with the empty fake", () => {
    expect(FILES.length).toBeGreaterThan(1);
    for (const f of FILES) expect(blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8")), f).toContain(BACKSTOP);
  });

  it("the fake answers any chain with nothing, and auth's nested calls exist", async () => {
    const { emptySupabaseModule } = await import("./helpers/emptySupabaseClient");
    const { supabase } = emptySupabaseModule() as { supabase: never };
    const s = supabase as unknown as Record<string, (...a: unknown[]) => unknown> & { auth: Record<string, (...a: unknown[]) => unknown> };
    expect(typeof s.auth.onAuthStateChange).toBe("function");
    const res = await (s.from("declutter_items") as unknown as { select: (c: string) => { eq: (a: string, b: string) => Promise<unknown> } }).select("id").eq("seller_id", "u");
    expect(res).toEqual({ data: [], error: null, count: 0 });
    expect(await (s.rpc("declutter_my_cart") as unknown as Promise<unknown>)).toEqual({ data: [], error: null, count: 0 });
  });
});
