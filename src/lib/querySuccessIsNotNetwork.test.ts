/**
 * slow-network 41599676917 (2026-11-03, measured live 11-04 on www as a guest at 375): cold
 * /browse, connection dropped before the list landed. "You're offline." showed at +0.9 s and was
 * gone by +1.4 s; navigator.onLine stayed false, every Supabase request failed, and the list
 * query kept re-fetching (onlineManager said online), so six job-card skeletons waited for
 * nothing. The one path left that flips the app online with no answered request was the query
 * cache's onSuccess -> noteReachable: a query that succeeds from a fallback, with no network.
 * A query success is not proof of a connection; only an answered request is.
 *
 * @mutate src/lib/queryClient.ts |   queryCache: new QueryCache({ |   queryCache: new QueryCache({\n    onSuccess: () => { void import("./connectivity").then((c) => c.noteReachable()); },
 * @mutate src/lib/queryClient.ts |   queryCache: new QueryCache({ |   queryCache: new QueryCache({\n    onSuccess: () => onlineManager.setOnline(true),
 */
import { describe, it, expect, beforeEach } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { getConnectivity, resetConnectivityForTests, setConnectivity } from "./connectivity";
import { queryClient } from "./queryClient";

describe("a query that succeeds without the network does not flip the app online", () => {
  beforeEach(() => {
    resetConnectivityForTests(async () => false);
    setConnectivity(false);
    queryClient.clear();
  });

  it("starts confirmed offline (floor)", () => {
    expect(getConnectivity().online).toBe(false);
    expect(onlineManager.isOnline()).toBe(false);
  });

  it("a fallback answer (failed read caught in the queryFn) leaves it offline", async () => {
    const value = await queryClient.fetchQuery({
      queryKey: ["querySuccessIsNotNetwork", "fallback"],
      networkMode: "always",
      queryFn: async () => {
        try {
          throw new TypeError("Failed to fetch");
        } catch {
          return null;
        }
      },
    });
    expect(value).toBeNull();
    expect(queryClient.getQueryState(["querySuccessIsNotNetwork", "fallback"])?.status).toBe("success");
    await new Promise((r) => setTimeout(r, 50));
    expect(getConnectivity().online).toBe(false);
    // TanStack's online state is what resumed the list query on /browse.
    expect(onlineManager.isOnline()).toBe(false);
  });
});
