// The marketing routes decide whether to download the Supabase chunk (and
// whether to hold the first paint) off this one predicate, so its exact
// contract is pinned here rather than left to inspection. Getting `false`
// wrong costs a signed-in user their redirect; getting `true` wrong costs
// every guest ~53 KiB gzipped on the landing page's LCP path.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hasPersistedAuthToken } from "./persistedAuthToken";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("hasPersistedAuthToken", () => {
  it("is false on an empty store (a first-time guest)", () => {
    expect(hasPersistedAuthToken()).toBe(false);
  });

  it("is true when a supabase v2 auth token is persisted", () => {
    localStorage.setItem("sb-fncmgoasalhdgfwzhsqa-auth-token", '{"access_token":"x"}');
    expect(hasPersistedAuthToken()).toBe(true);
  });

  it("matches the key SHAPE, not a hardcoded project ref", () => {
    localStorage.setItem("sb-someotherproject-auth-token", "{}");
    expect(hasPersistedAuthToken()).toBe(true);
  });

  it("ignores unrelated app keys (guests carry plenty of these)", () => {
    localStorage.setItem("helpr_cpp_variant", "poster");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("activity:dismissed:posted", "[]");
    expect(hasPersistedAuthToken()).toBe(false);
  });

  it("ignores near-miss keys — sb- prefix without the -auth-token suffix", () => {
    localStorage.setItem("sb-fncmgoasalhdgfwzhsqa-something-else", "{}");
    expect(hasPersistedAuthToken()).toBe(false);
  });

  it("ignores near-miss keys — -auth-token suffix without the sb- prefix", () => {
    localStorage.setItem("legacy-auth-token", "{}");
    expect(hasPersistedAuthToken()).toBe(false);
  });

  it("finds the token even when other keys are stored around it", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("sb-fncmgoasalhdgfwzhsqa-auth-token", "{}");
    localStorage.setItem("helpr_cpp_variant", "helper");
    expect(hasPersistedAuthToken()).toBe(true);
  });

  it("returns false (never throws) when storage access is blocked", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage is disabled");
      },
    });
    try {
      expect(hasPersistedAuthToken()).toBe(false);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});
