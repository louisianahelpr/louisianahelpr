// resolveNativeLaunchRoute decides where to land a user when iOS/Android
// cold-launches the app at "/". Bugs here either yank deep-links to the
// dashboard (breaks push-tap navigation) or land guests on /dashboard
// where ProtectedRoute kicks them to /login (jarring flash). Tests cover:
//   - web no-ops (returns null so deep links + SEO work)
//   - non-"/" paths return null (deep links preserved)
//   - guests → /browse
//   - signed-in → /dashboard
//   - getSession failure → /browse (fail-safe to public surface)

import { describe, it, expect, vi, beforeEach } from "vitest";

const isNativePlatformMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return isNativePlatformMock();
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: () => getSessionMock() },
  },
}));

import { resolveNativeLaunchRoute } from "./nativeLaunchRoute";

beforeEach(() => {
  isNativePlatformMock.mockReset();
  getSessionMock.mockReset();
});

describe("resolveNativeLaunchRoute", () => {
  describe("web no-op contract", () => {
    it("returns null when not on a native platform (web → no override)", async () => {
      isNativePlatformMock.mockReturnValue(false);
      expect(await resolveNativeLaunchRoute("/")).toBeNull();
      expect(getSessionMock).not.toHaveBeenCalled();
    });
  });

  describe("path preservation", () => {
    beforeEach(() => {
      isNativePlatformMock.mockReturnValue(true);
    });

    it("returns null for non-root paths (deep links preserved)", async () => {
      expect(await resolveNativeLaunchRoute("/messages")).toBeNull();
      expect(await resolveNativeLaunchRoute("/profile")).toBeNull();
      expect(await resolveNativeLaunchRoute("/dashboard")).toBeNull();
      expect(await resolveNativeLaunchRoute("/user/abc-123")).toBeNull();
      // No session lookup happened — fast-path bail
      expect(getSessionMock).not.toHaveBeenCalled();
    });

    it("returns null for /messages?jobId=... deep link (push-tap target)", async () => {
      expect(await resolveNativeLaunchRoute("/messages?jobId=abc")).toBeNull();
    });

    it("returns null for nested admin path", async () => {
      expect(await resolveNativeLaunchRoute("/admin/users")).toBeNull();
    });
  });

  describe("auth-aware default routing for / on native", () => {
    beforeEach(() => {
      isNativePlatformMock.mockReturnValue(true);
    });

    it("signed-in user → /dashboard", async () => {
      getSessionMock.mockResolvedValue({
        data: { session: { user: { id: "u1" } } },
      });
      expect(await resolveNativeLaunchRoute("/")).toBe("/dashboard");
    });

    it("guest (no session) → /browse", async () => {
      getSessionMock.mockResolvedValue({ data: { session: null } });
      expect(await resolveNativeLaunchRoute("/")).toBe("/browse");
    });

    it("guest at empty path '' → /browse", async () => {
      getSessionMock.mockResolvedValue({ data: { session: null } });
      expect(await resolveNativeLaunchRoute("")).toBe("/browse");
    });

    it("getSession throw → fail-safe to /browse", async () => {
      getSessionMock.mockRejectedValue(new Error("auth subsystem down"));
      expect(await resolveNativeLaunchRoute("/")).toBe("/browse");
    });

    it("getSession returns malformed shape → fail-safe to /browse", async () => {
      // No data field at all — defensive null-coalescing should send guest path
      getSessionMock.mockResolvedValue({ data: { session: undefined } });
      expect(await resolveNativeLaunchRoute("/")).toBe("/browse");
    });
  });
});
