/**
 * Every map screen but the job card calls useMapKitJs() with no options, so the
 * default has to load MapKit. In its own file because the loader is module-level
 * and once-per-page: only a fresh module can show that this call is what started it.
 *
 * @mutate src/hooks/useMapKitJs.ts | useMapKitJs({ enabled = true }: { enabled?: boolean } = {}) | useMapKitJs({ enabled = false }: { enabled?: boolean } = {})
 */
import { afterAll, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMapKitJs } from "./useMapKitJs";

afterAll(() => {
  vi.unstubAllGlobals();
  document.getElementById("apple-mapkit-js")?.remove();
});

it("useMapKitJs() with no options starts the script", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "t" }), { status: 200 })));
  expect(document.getElementById("apple-mapkit-js")).toBeNull();
  const { result, unmount } = renderHook(() => useMapKitJs());
  expect(document.getElementById("apple-mapkit-js")).not.toBeNull();
  expect(result.current).toBe("loading");
  unmount();
});
