import { describe, it, expect } from "vitest";
import { isProfileGateAllowed } from "./ProtectedRoute";

// This predicate decides whether a user with an INCOMPLETE profile ("Big 7"
// verification gate) is let through or bounced to /complete-profile. On
// 2026-08-18 it gained an exemption for `/profile?tab=legal`, so the GDPR
// data export that used to live at /data-rights stays reachable mid-onboarding.
//
// It is the only place in the app that widens an auth gate off a QUERY
// PARAM, so the contract is pinned here rather than left to inspection.

describe("isProfileGateAllowed", () => {
  it("allows the standalone routes a half-onboarded user always could reach", () => {
    for (const p of ["/complete-profile", "/support", "/terms", "/privacy", "/rules"]) {
      expect(isProfileGateAllowed(p, "")).toBe(true);
    }
  });

  it("allows the Legal tab, where the data export now lives", () => {
    expect(isProfileGateAllowed("/profile", "?tab=legal")).toBe(true);
  });

  it("still gates bare /profile", () => {
    expect(isProfileGateAllowed("/profile", "")).toBe(false);
  });

  it("does not let the exemption leak to sibling Profile tabs", () => {
    for (const tab of ["payment", "security", "subscription", "earnings", "profile"]) {
      expect(isProfileGateAllowed("/profile", `?tab=${tab}`)).toBe(false);
    }
  });

  it("does not leak to other routes carrying ?tab=legal", () => {
    expect(isProfileGateAllowed("/dashboard", "?tab=legal")).toBe(false);
    expect(isProfileGateAllowed("/admin", "?tab=legal")).toBe(false);
  });

  // Multi-value params are the classic way a gate and a page disagree: if the
  // gate read the LAST `tab` and the page read the FIRST, `?tab=payment&tab=legal`
  // would open Payment behind a legal-tab exemption. Both sides call
  // `new URLSearchParams(...).get("tab")`, which returns the FIRST value —
  // these cases lock that agreement in place.
  it("reads the same `tab` value the page will render when the param repeats", () => {
    expect(isProfileGateAllowed("/profile", "?tab=legal&tab=payment")).toBe(true);
    expect(isProfileGateAllowed("/profile", "?tab=payment&tab=legal")).toBe(false);
  });

  it("requires an exact match, so near-misses fail closed", () => {
    expect(isProfileGateAllowed("/profile", "?tab=Legal")).toBe(false);
    expect(isProfileGateAllowed("/profile", "?tab=legal%20")).toBe(false);
    expect(isProfileGateAllowed("/profile", "?tab=legalese")).toBe(false);
    expect(isProfileGateAllowed("/profile", "?TAB=legal")).toBe(false);
    expect(isProfileGateAllowed("/profile/", "?tab=legal")).toBe(false);
    expect(isProfileGateAllowed("/profile", "?tab=")).toBe(false);
  });

  it("tolerates unrelated params alongside the tab", () => {
    expect(isProfileGateAllowed("/profile", "?tab=legal&ref=policy")).toBe(true);
  });
});
