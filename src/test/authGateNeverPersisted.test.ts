/**
 * 2026-10-08, e2e journeys-webkit (ban-enforcement): a just-banned account was
 * let into /post-job. The signed-in user's own row (useCurrentUser: ban_status,
 * approval, tier) was saved to the device by the query persister, and a
 * pre-ban copy under 30s old rehydrated as FRESH, so ProtectedRoute never
 * re-read the ban.
 *
 * The class: the current user's gate row is never persisted, by the query's
 * own meta AND by the persister refusing the key (so a query that forgets the
 * meta cannot persist it). Ordinary data queries still persist.
 *
 * @mutate src/lib/queryPersister.ts |       if (query.queryKey[0] === queryKeys.currentUser.all[0]) return false; |
 * @mutate src/hooks/useCurrentUser.ts |     meta: { persist: false }, |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, type Query } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { persistOptions } from "@/lib/queryPersister";
import { queryKeys } from "@/lib/queryKeys";

function successfulQuery(queryKey: readonly unknown[], meta?: Record<string, unknown>): Query {
  const qc = new QueryClient();
  qc.setQueryData(queryKey, { ban_status: "active" });
  const query = qc.getQueryCache().find({ queryKey })!;
  if (meta) (query as unknown as { meta: unknown }).meta = meta;
  return query;
}

const shouldPersist = (q: Query) => persistOptions.dehydrateOptions.shouldDehydrateQuery(q);

describe("the signed-in user's gate row is never saved to the device", () => {
  it("the persister refuses the currentUser key even without the meta", () => {
    expect(shouldPersist(successfulQuery(queryKeys.currentUser.byId("u1")))).toBe(false);
  });

  it("ordinary data queries still persist (the refusal is scoped, not global)", () => {
    expect(shouldPersist(successfulQuery(["guestDashboardJobs"]))).toBe(true);
  });

  it("useCurrentUser's query opts out itself too", () => {
    const src = readFileSync(join(process.cwd(), "src/hooks/useCurrentUser.ts"), "utf8");
    const call = src.slice(src.indexOf("queryKey: queryKeys.currentUser.byId(user?.id)"), src.indexOf("refetchOnWindowFocus: true"));
    expect(call).toMatch(/meta: \{ persist: false \}/);
  });
});
